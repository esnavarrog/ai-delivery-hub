import type { WorkPackage } from '@ai-delivery-hub/domain';
import { describe, expect, it } from 'vitest';
import { IngestWorkPackage } from '../../src/modules/ingest/ingest-work-package.js';
import { pollOnce, type WatermarkStore } from '../../src/modules/ingest/poll.js';
import { pollCron } from '../../src/jobs/boss.js';
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

describe('pollOnce', () => {
  it('uses the watermark (or a default lookback), ingests every work package and advances the watermark to the pass start', async () => {
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
    await watermarks.set(15, '2026-09-14T11:00:00.000Z');
    const calls: Array<[number, string]> = [];
    const op = {
      listUpdatedSince: async (projectId: number, since: string) => {
        calls.push([projectId, since]);
        return projectId === 15 ? [wp(1, 15), wp(2, 15, 'plain')] : [wp(3, 6)];
      },
    };

    const summary = await pollOnce({ op, watermarks, ingest, projectIds: [15, 6], clock, defaultLookbackMs: 3_600_000 });

    expect(calls).toEqual([
      [15, '2026-09-14T11:00:00.000Z'],
      [6, '2026-09-14T11:00:00.000Z'],
    ]);
    expect(summary[0]).toMatchObject({ projectId: 15, fetched: 2, outcomes: { created: 1, ignored: 1, updated: 0, unchanged: 0 } });
    expect(summary[1]).toMatchObject({ projectId: 6, fetched: 1, outcomes: { created: 1 } });
    expect(await watermarks.get(15)).toBe('2026-09-14T12:00:00.000Z');
    expect(await watermarks.get(6)).toBe('2026-09-14T12:00:00.000Z');
    expect(store.all()).toHaveLength(2);
  });
});

describe('pollCron', () => {
  it('rounds the interval to whole minutes', () => {
    expect(pollCron(120_000)).toBe('*/2 * * * *');
    expect(pollCron(1_000)).toBe('* * * * *');
    expect(pollCron(59_000)).toBe('* * * * *');
    expect(pollCron(7_200_000)).toBe('0 */2 * * *');
  });
});
