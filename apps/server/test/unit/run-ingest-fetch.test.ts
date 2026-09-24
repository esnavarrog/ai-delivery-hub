import type { WorkPackage } from '@ai-delivery-hub/domain';
import { describe, expect, it, vi } from 'vitest';
import { IngestWorkPackage } from '../../src/modules/ingest/ingest-work-package.js';
import { RunIngestFetch, type ObsidianInboxImporter } from '../../src/modules/ingest/fetch.js';
import type { WatermarkStore } from '../../src/modules/ingest/poll.js';
import { FixedClock, MemoryEventStore, MemoryTicketIndex, SequentialIds } from '../helpers/memory.js';

class MemoryWatermarks implements WatermarkStore {
  readonly marks = new Map<number, string>();
  async get(projectId: number) {
    return this.marks.get(projectId);
  }
  async set(projectId: number, sinceIso: string) {
    this.marks.set(projectId, sinceIso);
  }
}

const wp = (id: number, projectId: number, subject = '[AI] x'): WorkPackage => ({
  id,
  subject,
  description: { raw: '' },
  status: 'New',
  type: 'Bug',
  project: { id: projectId, name: 'P' },
  lockVersion: 1,
  updatedAt: '2026-09-14T09:00:00Z',
});

function harness(overrides: { op?: { listUpdatedSince: (projectId: number, since: string) => Promise<WorkPackage[]> }; obsidian?: ObsidianInboxImporter } = {}) {
  const store = new MemoryEventStore();
  const clock = new FixedClock('2026-09-14T12:00:00.000Z');
  const ingest = new IngestWorkPackage({
    eventStore: store,
    ticketIndex: new MemoryTicketIndex(store),
    triage: { enqueueTriage: async () => {} },
    ids: new SequentialIds(),
    clock,
    trigger: { kind: 'prefix', subjectPrefix: '[AI]' },
  });
  const watermarks = new MemoryWatermarks();
  const op = overrides.op ?? {
    listUpdatedSince: async (projectId: number) => (projectId === 15 ? [wp(1, 15), wp(2, 15, 'plain')] : [wp(3, 6)]),
  };
  const deps: ConstructorParameters<typeof RunIngestFetch>[0] = { op, watermarks, ingest, projectIds: [15, 6], clock };
  if (overrides.obsidian) deps.obsidian = overrides.obsidian;
  return { fetch: new RunIngestFetch(deps), store };
}

describe('RunIngestFetch', () => {
  it('aggregates fetched/created/updated across every configured project and reports obsidian:null without an importer', async () => {
    const { fetch, store } = harness();
    const summary = await fetch.execute();
    expect(summary).toEqual({ openproject: { fetched: 3, created: 2, updated: 0 }, obsidian: null });
    expect(store.all()).toHaveLength(2);
  });

  it('reuses the in-flight run when called again before the first resolves', async () => {
    let calls = 0;
    let resolveFirst!: () => void;
    const gate = new Promise<void>((resolve) => (resolveFirst = resolve));
    const { fetch } = harness({
      op: {
        listUpdatedSince: async (projectId: number) => {
          calls += 1;
          await gate;
          return projectId === 15 ? [wp(1, 15)] : [];
        },
      },
    });
    const first = fetch.execute();
    const second = fetch.execute();
    resolveFirst();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    // 2 projects polled once each by the single shared run, not 4 (2 projects x 2 calls).
    expect(calls).toBe(2);
  });

  it('runs a fresh pass after the previous one settled', async () => {
    const { fetch } = harness();
    const first = await fetch.execute();
    const second = await fetch.execute();
    expect(first).not.toBe(second);
    expect(second).toEqual({ openproject: { fetched: 3, created: 0, updated: 0 }, obsidian: null });
  });

  it('imports the Obsidian inbox when an importer is configured', async () => {
    const importInbox = vi.fn().mockResolvedValue({ imported: 2, skipped: 1, errors: [{ file: 'bad.md', message: 'missing title' }] });
    const { fetch } = harness({ obsidian: { importInbox } });
    const summary = await fetch.execute();
    expect(importInbox).toHaveBeenCalledTimes(1);
    expect(summary.obsidian).toEqual({ imported: 2, skipped: 1, errors: [{ file: 'bad.md', message: 'missing title' }] });
  });
});
