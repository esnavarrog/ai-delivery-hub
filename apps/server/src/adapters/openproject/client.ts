import type { Clock, OpenProjectPort, WorkPackage } from '@ai-delivery-hub/domain';
import { z } from 'zod';
import { OpCollection, toWorkPackage } from './mapping.js';

export class OpenProjectHttpError extends Error {
  override readonly name: string = 'OpenProjectHttpError';
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: unknown,
  ) {
    super(`OpenProject ${method} ${path} failed with ${status}`);
  }
}

/** OpenProject rejected an update because `lockVersion` was stale (HTTP 409). */
export class OpenProjectConflictError extends OpenProjectHttpError {
  override readonly name = 'OpenProjectConflictError';
}

export interface OpActivity {
  id: number;
  kind: 'comment' | 'change';
  comment: string;
  /** Journal lines as OpenProject renders them, e.g. "Estado se cambió de New a Ready for AI". */
  details: string[];
  userName?: string;
  createdAt: string;
}

const OpActivityResource = z.object({
  _type: z.string(),
  id: z.number().int(),
  comment: z.object({ raw: z.string().nullable() }).nullable().optional(),
  details: z.array(z.object({ raw: z.string().nullable() })).default([]),
  createdAt: z.string(),
  _links: z.object({ user: z.object({ title: z.string().optional() }).optional() }).optional(),
});

export interface OpenProjectClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  clock?: Clock;
  pageSize?: number;
}

const systemClock: Clock = { now: () => new Date(), nowIso: () => new Date().toISOString() };

/** Read-only REST v3 client (GET only). Auth is HTTP basic with user `apikey`, pagination via `offset`/`pageSize`. */
export class OpenProjectClient implements OpenProjectPort {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: Clock;
  private readonly pageSize: number;

  constructor(options: OpenProjectClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.authHeader = `Basic ${Buffer.from(`apikey:${options.apiKey}`).toString('base64')}`;
    this.fetchImpl = options.fetch ?? fetch;
    this.clock = options.clock ?? systemClock;
    this.pageSize = options.pageSize ?? 100;
  }

  async getWorkPackage(id: number): Promise<WorkPackage> {
    return toWorkPackage(await this.request('GET', `/api/v3/work_packages/${id}`));
  }

  /**
   * Work packages of `projectId` updated in `[sinceIso, now]`. OpenProject's filter key is
   * `updated_at` (snake case) with the `<>d` between-dates operator; `updatedAt` is silently ignored.
   */
  async listUpdatedSince(projectId: number, sinceIso: string): Promise<WorkPackage[]> {
    const filters = JSON.stringify([{ updated_at: { operator: '<>d', values: [sinceIso, this.clock.nowIso()] } }]);
    const sortBy = JSON.stringify([['updatedAt', 'asc']]);
    const result: WorkPackage[] = [];
    for (let offset = 1; ; offset += 1) {
      const query = new URLSearchParams({ filters, sortBy, pageSize: String(this.pageSize), offset: String(offset) });
      const page = OpCollection.parse(await this.request('GET', `/api/v3/projects/${projectId}/work_packages?${query}`));
      for (const element of page._embedded.elements) result.push(toWorkPackage(element));
      const fetched = page._embedded.elements.length;
      const done = fetched < this.pageSize || (page.total !== undefined && result.length >= page.total);
      if (done) return result;
    }
  }

  async getActivities(workPackageId: number): Promise<OpActivity[]> {
    const raw = OpCollection.parse(await this.request('GET', `/api/v3/work_packages/${workPackageId}/activities`));
    return raw._embedded.elements.map((element) => {
      const a = OpActivityResource.parse(element);
      const activity: OpActivity = {
        id: a.id,
        kind: a._type === 'Activity::Comment' ? 'comment' : 'change',
        comment: a.comment?.raw ?? '',
        details: a.details.map((d) => d.raw ?? ''),
        createdAt: a.createdAt,
      };
      const userName = a._links?.user?.title;
      if (userName !== undefined) activity.userName = userName;
      return activity;
    });
  }

  private async request(method: 'GET', path: string): Promise<unknown> {
    const headers: Record<string, string> = { authorization: this.authHeader, accept: 'application/hal+json, application/json' };
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers });
    const payload: unknown = await res.json().catch(() => undefined);
    if (res.status === 409) throw new OpenProjectConflictError(res.status, method, path, payload);
    if (!res.ok) throw new OpenProjectHttpError(res.status, method, path, payload);
    return payload;
  }
}
