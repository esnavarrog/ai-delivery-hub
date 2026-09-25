import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EventStore, TicketEvent } from '@ai-delivery-hub/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AfterAppendHook } from '../../src/adapters/db/ticket-projection.js';
import { CreateManualTicket, type ManualKeySequence } from '../../src/modules/ingest/manual-ticket.js';
import { ImportObsidianInbox } from '../../src/modules/ingest/obsidian-inbox-import.js';
import { createMirrorAfterAppend } from '../../src/modules/sync/mirror.js';
import { projectTicket } from '../../src/modules/ingest/ticket-received.js';
import { FixedClock, MemoryEventStore, SequentialIds } from '../helpers/memory.js';

/** Mimics ProjectingEventStore's after-append hook contract without needing Postgres. */
class HookedEventStore implements EventStore {
  constructor(
    private readonly inner: MemoryEventStore,
    private readonly hooks: readonly AfterAppendHook[],
  ) {}
  async append(ticketId: string, expectedSeq: number, events: readonly TicketEvent[]): Promise<void> {
    await this.inner.append(ticketId, expectedSeq, events);
    const { snapshot } = projectTicket(await this.inner.load(ticketId));
    for (const hook of this.hooks) await hook(events, snapshot);
  }
  load(ticketId: string): Promise<TicketEvent[]> {
    return this.inner.load(ticketId);
  }
}

class SequentialManualKeys implements ManualKeySequence {
  private n = 0;
  async next(): Promise<string> {
    this.n += 1;
    return `M-${String(this.n).padStart(4, '0')}`;
  }
}

let vaultDir: string;

beforeEach(async () => {
  vaultDir = await mkdtemp(join(tmpdir(), 'hub-vault-'));
  await mkdir(join(vaultDir, 'hub/inbox'), { recursive: true });
});

afterEach(async () => {
  await rm(vaultDir, { recursive: true, force: true });
});

describe('Obsidian import + mirror, end to end', () => {
  it('an inbox note becomes its own mirror: moved before the ticket exists, then hub frontmatter lands on top with the original text preserved below the marker', async () => {
    await writeFile(join(vaultDir, 'hub/inbox/coffee.md'), '---\ntitle: Fix the coffee machine\npriority: low\ntags: [facilities]\n---\n\nIt leaks from the side.\n');

    const memoryStore = new MemoryEventStore();
    const warnings: unknown[] = [];
    const mirrorHook = createMirrorAfterAppend({ vaultDir, ticketsDir: 'hub/tickets', hubPublicUrl: 'http://localhost:5173' }, { warn: (...args) => warnings.push(args) });
    const eventStore = new HookedEventStore(memoryStore, [mirrorHook]);

    const keys = new SequentialManualKeys();
    const triaged: string[] = [];
    const createTicket = new CreateManualTicket({ eventStore, keys, triage: { enqueueTriage: async (id) => void triaged.push(id) }, ids: new SequentialIds(), clock: new FixedClock('2026-09-24T09:00:00.000Z') });
    const importer = new ImportObsidianInbox({ vaultDir, inboxDir: 'hub/inbox', ticketsDir: 'hub/tickets', keys, createTicket });

    const summary = await importer.importInbox();
    expect(summary).toEqual({ imported: 1, skipped: 0, errors: [] });
    expect(warnings).toEqual([]);
    expect(await readdir(join(vaultDir, 'hub/inbox'))).toEqual([]);

    const mirrored = await readFile(join(vaultDir, 'hub/tickets/M-0001.md'), 'utf8');
    expect(mirrored).toContain('key: M-0001');
    expect(mirrored).toContain('source: manual');
    expect(mirrored).toContain('title: Fix the coffee machine');
    expect(mirrored).toContain('state: received');
    // the original note text survives as the mirror's initial user content
    expect(mirrored).toContain('It leaks from the side.\n');
    // the raw note's own (now superseded) frontmatter is gone
    expect(mirrored).not.toContain('priority: low');
    expect(triaged).toEqual(['00000000-0000-4000-8000-000000000001']);

    // A later event (e.g. triage completing) refreshes the frontmatter and still preserves the body.
    await eventStore.append('00000000-0000-4000-8000-000000000001', 1, [
      {
        id: '00000000-0000-4000-8000-000000000002',
        ticketId: '00000000-0000-4000-8000-000000000001',
        seq: 2,
        type: 'triage_started',
        actor: { kind: 'system', id: 'triage-scheduler' },
        artifacts: [],
        payload: {},
        createdAt: '2026-09-24T09:05:00.000Z',
      } as TicketEvent,
    ]);
    const afterTriageStarted = await readFile(join(vaultDir, 'hub/tickets/M-0001.md'), 'utf8');
    expect(afterTriageStarted).toContain('state: triaging');
    expect(afterTriageStarted).toContain('It leaks from the side.\n');
  });
});
