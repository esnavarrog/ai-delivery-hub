import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TicketSnapshot } from '@ai-delivery-hub/domain';
import type { AfterAppendHook } from '../../adapters/db/ticket-projection.js';
import { extractUserContent, renderMirrorNote, type MirrorFrontmatter } from '../../adapters/obsidian/mirror-note.js';
import { ensureDir, insideVault, writeFileAtomic } from '../../adapters/obsidian/vault-fs.js';

export interface MirrorWriterDeps {
  vaultDir: string;
  /** Relative to `vaultDir`. */
  ticketsDir: string;
  hubPublicUrl: string;
}

interface MirrorLogger {
  warn(msg: string, meta?: Record<string, unknown>): void;
}

function frontmatterFor(snapshot: TicketSnapshot, hubPublicUrl: string): MirrorFrontmatter {
  const frontmatter: MirrorFrontmatter = {
    key: snapshot.displayKey,
    source: snapshot.source.kind,
    title: snapshot.subject,
    state: snapshot.state,
    updatedAt: snapshot.updatedAt,
    hubUrl: `${hubPublicUrl}/tickets/${snapshot.id}`,
  };
  if (snapshot.riskTier !== undefined) frontmatter.riskTier = snapshot.riskTier;
  if (snapshot.targetRepo !== undefined) frontmatter.targetRepo = snapshot.targetRepo;
  return frontmatter;
}

async function readExisting(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

/**
 * Writes or updates `<ticketsDir>/<displayKey>.md` after every appended event: hub-owned
 * frontmatter (key, source, title, state, riskTier, targetRepo, updatedAt, hub URL) above the
 * marker, the caller's own notes preserved byte-for-byte below it (`extractUserContent`). Atomic
 * write (temp file + rename). A mirror failure is logged and never rethrown — it must never break
 * the event append it runs after.
 */
export function createMirrorAfterAppend(deps: MirrorWriterDeps, log: MirrorLogger): AfterAppendHook {
  return async (_appended, snapshot) => {
    try {
      const ticketsAbs = insideVault(deps.vaultDir, deps.ticketsDir);
      await ensureDir(ticketsAbs);
      const destPath = join(ticketsAbs, `${snapshot.displayKey}.md`);
      const existing = await readExisting(destPath);
      const userBody = extractUserContent(existing);
      const content = renderMirrorNote(frontmatterFor(snapshot, deps.hubPublicUrl), userBody);
      await writeFileAtomic(destPath, content);
    } catch (err) {
      log.warn('obsidian mirror write failed', { ticketId: snapshot.id, displayKey: snapshot.displayKey, error: err instanceof Error ? err.message : String(err) });
    }
  };
}
