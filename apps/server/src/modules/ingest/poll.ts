import type { Clock, OpenProjectPort } from '@ai-delivery-hub/domain';
import type { IngestOutcome, IngestWorkPackage } from './ingest-work-package.js';

export interface WatermarkStore {
  get(projectId: number): Promise<string | undefined>;
  set(projectId: number, sinceIso: string): Promise<void>;
}

export interface PollDeps {
  op: Pick<OpenProjectPort, 'listUpdatedSince'>;
  watermarks: WatermarkStore;
  ingest: Pick<IngestWorkPackage, 'execute'>;
  projectIds: readonly number[];
  clock: Clock;
  /** Window used when a project has no watermark yet. */
  defaultLookbackMs?: number;
}

export interface ProjectPollSummary {
  projectId: number;
  since: string;
  fetched: number;
  outcomes: Record<IngestOutcome['kind'], number>;
}

export const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * One polling pass over every configured project. The watermark advances to the instant the
 * pass started, so a work package updated during the pass is seen again next time; ingest is
 * idempotent so the overlap is harmless.
 */
export async function pollOnce(deps: PollDeps): Promise<ProjectPollSummary[]> {
  const startedAt = deps.clock.nowIso();
  const summaries: ProjectPollSummary[] = [];
  for (const projectId of deps.projectIds) {
    const since =
      (await deps.watermarks.get(projectId)) ??
      new Date(deps.clock.now().getTime() - (deps.defaultLookbackMs ?? DEFAULT_LOOKBACK_MS)).toISOString();
    const workPackages = await deps.op.listUpdatedSince(projectId, since);
    const outcomes: ProjectPollSummary['outcomes'] = { created: 0, updated: 0, unchanged: 0, ignored: 0 };
    for (const wp of workPackages) outcomes[(await deps.ingest.execute(wp)).kind] += 1;
    await deps.watermarks.set(projectId, startedAt);
    summaries.push({ projectId, since, fetched: workPackages.length, outcomes });
  }
  return summaries;
}
