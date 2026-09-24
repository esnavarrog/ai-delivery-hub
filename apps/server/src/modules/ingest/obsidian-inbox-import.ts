import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { ObsidianImportSummary } from '@ai-delivery-hub/contracts';
import { z } from 'zod';
import { InboxFrontmatter, parseNote } from '../../adapters/obsidian/note.js';
import { assertRealpathInsideVault, ensureDir, insideVault, listMarkdownFiles } from '../../adapters/obsidian/vault-fs.js';
import type { ManualKeySequence, ManualTicketInput } from './manual-ticket.js';

export interface ObsidianImportDeps {
  vaultDir: string;
  /** Relative to `vaultDir`. */
  inboxDir: string;
  /** Relative to `vaultDir`. */
  ticketsDir: string;
  keys: ManualKeySequence;
  createTicket: { execute(input: ManualTicketInput, presetKey?: string): Promise<{ ticketId: string; key: string }> };
}

/**
 * Imports `hub/inbox/*.md` notes as manual tickets. A valid note is moved to
 * `<ticketsDir>/<key>.md` *before* the ticket is created, so that once the mirror writer (T5)
 * exists, the `ticket_received` event's after-append hook finds the note already at its mirror
 * path and preserves its body as the mirror's initial user content instead of starting empty. An
 * invalid note is reported in the summary and left in place, untouched.
 */
export class ImportObsidianInbox {
  constructor(private readonly deps: ObsidianImportDeps) {}

  async importInbox(): Promise<ObsidianImportSummary> {
    const inboxAbs = insideVault(this.deps.vaultDir, this.deps.inboxDir);
    const files = await listMarkdownFiles(inboxAbs);
    let imported = 0;
    let skipped = 0;
    const errors: ObsidianImportSummary['errors'] = [];

    for (const file of files) {
      const notePath = join(inboxAbs, file);
      try {
        await this.importOne(notePath);
        imported += 1;
      } catch (err) {
        skipped += 1;
        errors.push({ file, message: err instanceof Error ? err.message : String(err) });
      }
    }
    return { imported, skipped, errors };
  }

  private async importOne(notePath: string): Promise<void> {
    await assertRealpathInsideVault(this.deps.vaultDir, notePath);
    const raw = await readFile(notePath, 'utf8');
    const { frontmatter, body } = parseNote(raw);
    const parsed = InboxFrontmatter.safeParse(frontmatter);
    if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
    const { title, repo, priority, tags } = parsed.data;
    // The note body (and the repo hint) is untrusted external text: it becomes the ticket
    // description, which only ever reaches the model through ticketUntrustedContext's
    // wrapUntrusted call (run-triage.ts) — never the system prompt.
    const description = repo ? `Repo hint: ${repo}\n\n${body.trim()}` : body.trim();

    const key = await this.deps.keys.next();
    const ticketsAbs = insideVault(this.deps.vaultDir, this.deps.ticketsDir);
    await ensureDir(ticketsAbs);
    const destPath = join(ticketsAbs, `${key}.md`);
    await rename(notePath, destPath);
    try {
      const input: ManualTicketInput = { title, description };
      if (priority) input.priority = priority;
      if (tags && tags.length > 0) input.tags = tags;
      await this.deps.createTicket.execute(input, key);
    } catch (err) {
      // Best-effort rollback so a DB/event-store failure does not silently lose the note.
      await rename(destPath, notePath).catch(() => {});
      throw err;
    }
  }
}
