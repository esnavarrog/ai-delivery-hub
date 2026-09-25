import type { FetchResponse, ObsidianImportSummary } from '@ai-delivery-hub/contracts';
import type { Clock, OpenProjectPort } from '@ai-delivery-hub/domain';
import type { IngestWorkPackage } from './ingest-work-package.js';
import { pollOnce, type WatermarkStore } from './poll.js';

export interface ObsidianInboxImporter {
  importInbox(): Promise<ObsidianImportSummary>;
}

export interface FetchDeps {
  op: Pick<OpenProjectPort, 'listUpdatedSince'>;
  watermarks: WatermarkStore;
  ingest: Pick<IngestWorkPackage, 'execute'>;
  projectIds: readonly number[];
  clock: Clock;
  /** Wired once the Obsidian vault is configured (see T4); `obsidian` stays `null` without it. */
  obsidian?: ObsidianInboxImporter;
}

/**
 * Runs one on-demand ingest pass: pulls OpenProject (reusing `pollOnce`/watermarks) and, when an
 * Obsidian importer is configured, imports `hub/inbox/*.md`. A second call made while a pass is
 * still running reuses that same in-flight run instead of starting a concurrent one — the caller
 * (`POST /api/ingest/fetch`) always gets a settled summary, never a 409.
 */
export class RunIngestFetch {
  private inFlight: Promise<FetchResponse> | undefined;

  constructor(private readonly deps: FetchDeps) {}

  execute(): Promise<FetchResponse> {
    if (!this.inFlight) {
      this.inFlight = this.runOnce().finally(() => {
        this.inFlight = undefined;
      });
    }
    return this.inFlight;
  }

  private async runOnce(): Promise<FetchResponse> {
    const summaries = await pollOnce({
      op: this.deps.op,
      watermarks: this.deps.watermarks,
      ingest: this.deps.ingest,
      projectIds: this.deps.projectIds,
      clock: this.deps.clock,
    });
    const openproject = summaries.reduce(
      (acc, s) => ({
        fetched: acc.fetched + s.fetched,
        created: acc.created + s.outcomes.created,
        updated: acc.updated + s.outcomes.updated,
      }),
      { fetched: 0, created: 0, updated: 0 },
    );
    const obsidian = this.deps.obsidian ? await this.deps.obsidian.importInbox() : null;
    return { openproject, obsidian };
  }
}
