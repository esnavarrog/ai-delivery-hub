import type { PlanCommentDto, PlanVersionDto, RunDto } from '@ai-delivery-hub/contracts';
import {
  OptimisticConcurrencyError,
  type Clock,
  type EventStore,
  type IdGenerator,
  type TicketEvent,
  type TicketSource,
} from '@ai-delivery-hub/domain';
import type { TicketFilters, TicketQueries } from '../../src/http/app.js';
import type { TicketIndex } from '../../src/modules/ingest/ingest-work-package.js';
import { projectTicket } from '../../src/modules/ingest/ticket-received.js';
import type { PlanCommentsRepository, PlanVersionsRepository, RunsRepository } from '../../src/modules/shared/repositories.js';

export class MemoryEventStore implements EventStore {
  readonly streams = new Map<string, TicketEvent[]>();

  async append(ticketId: string, expectedSeq: number, events: readonly TicketEvent[]): Promise<void> {
    const current = this.streams.get(ticketId) ?? [];
    if (current.length !== expectedSeq) throw new OptimisticConcurrencyError(ticketId, expectedSeq, current.length);
    this.streams.set(ticketId, [...current, ...events]);
  }

  async load(ticketId: string): Promise<TicketEvent[]> {
    return [...(this.streams.get(ticketId) ?? [])];
  }

  all(): TicketEvent[] {
    return [...this.streams.values()].flat();
  }

  types(ticketId: string): string[] {
    return (this.streams.get(ticketId) ?? []).map((e) => e.type);
  }
}

/** Mimics the tickets projection by scanning `ticket_received` payloads. */
export class MemoryTicketIndex implements TicketIndex {
  constructor(private readonly store: MemoryEventStore) {}

  async findTicketIdByWorkPackage(opWorkPackageId: number): Promise<string | undefined> {
    for (const [ticketId, events] of this.store.streams) {
      const received = events.find((e) => e.type === 'ticket_received');
      const source = (received?.payload as { source?: TicketSource } | undefined)?.source;
      if (source?.kind === 'openproject' && source.workPackageId === opWorkPackageId) return ticketId;
    }
    return undefined;
  }
}

/** Projects every stream on demand; good enough for HTTP tests over a MemoryEventStore. */
export class MemoryTicketQueries implements TicketQueries {
  constructor(private readonly store: MemoryEventStore) {}

  async list(filters: TicketFilters) {
    const all = [...this.store.streams.values()].filter((events) => events.length > 0).map((events) => projectTicket(events).snapshot);
    return all
      .filter((t) => (!filters.state || t.state === filters.state) && (!filters.repo || t.targetRepo === filters.repo) && (!filters.owner || t.ownerUserId === filters.owner))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  }

  async get(id: string) {
    const events = this.store.streams.get(id);
    if (!events || events.length === 0) return undefined;
    return { snapshot: projectTicket(events).snapshot, events: [...events] };
  }

  async eventsAfter(id: string, seq: number) {
    return (this.store.streams.get(id) ?? []).filter((e) => e.seq > seq);
  }
}

export class SequentialIds implements IdGenerator {
  private n = 0;
  uuid(): string {
    this.n += 1;
    return `00000000-0000-4000-8000-${String(this.n).padStart(12, '0')}`;
  }
}

export class FixedClock implements Clock {
  constructor(private iso = '2026-09-14T12:00:00.000Z') {}
  now(): Date {
    return new Date(this.iso);
  }
  nowIso(): string {
    return this.iso;
  }
  set(iso: string): void {
    this.iso = iso;
  }
  /** Advances the clock by `ms` so ordering-sensitive guards (replan) can be exercised. */
  tick(ms = 1000): void {
    this.iso = new Date(this.now().getTime() + ms).toISOString();
  }
}

export interface ReceivedOverrides {
  /** Shorthand for an OpenProject source with this work package id (default project/lock version). */
  opWorkPackageId?: number;
  /** Full source override, e.g. `{ kind: 'manual', key: 'M-0001' }`; wins over `opWorkPackageId`. */
  source?: TicketSource;
  subject?: string;
  description?: string;
  priority?: 'low' | 'normal' | 'high' | 'immediate';
  createdAt?: string;
  /** Manual (feature request) tickets only: the login of the ticket's requester/creator. */
  requesterUserId?: string;
}

/** A well-formed `ticket_received` event so tests can seed a stream without going through ingest. */
export function receivedEvent(ticketId: string, overrides: ReceivedOverrides = {}): TicketEvent {
  const source: TicketSource = overrides.source ?? { kind: 'openproject', workPackageId: overrides.opWorkPackageId ?? 4711, projectId: 15, lockVersion: 1 };
  const payload: Record<string, unknown> = {
    source,
    subject: overrides.subject ?? '[AI] Login fails without cookie',
    description: overrides.description ?? 'Steps to reproduce: open the app without a session cookie.',
    status: 'New',
    type: 'Bug',
    priority: overrides.priority ?? 'normal',
    opUpdatedAt: '2026-09-14T09:00:00Z',
  };
  if (overrides.requesterUserId !== undefined) payload['requesterUserId'] = overrides.requesterUserId;
  return {
    id: `10000000-0000-4000-8000-${ticketId.replace(/[^0-9a-f]/gi, '').padStart(12, '0').slice(-12)}`,
    ticketId,
    seq: 1,
    type: 'ticket_received',
    actor: { kind: 'system', id: 'ingest' },
    artifacts: [],
    payload,
    createdAt: overrides.createdAt ?? '2026-09-14T11:00:00.000Z',
  } as TicketEvent;
}

export class MemoryRunsRepository implements RunsRepository {
  readonly rows = new Map<string, RunDto>();

  async insert(run: RunDto): Promise<void> {
    this.rows.set(run.id, { ...run });
  }

  async update(id: string, patch: Partial<Omit<RunDto, 'id'>>): Promise<void> {
    const current = this.rows.get(id);
    if (!current) throw new Error(`run ${id} not found`);
    this.rows.set(id, { ...current, ...patch });
  }

  async get(id: string): Promise<RunDto | undefined> {
    return this.rows.get(id);
  }

  async list(filters: { ticketId?: string; limit?: number }): Promise<RunDto[]> {
    return [...this.rows.values()]
      .filter((r) => !filters.ticketId || r.ticketId === filters.ticketId)
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
      .slice(0, filters.limit ?? 100);
  }
}

export class MemoryPlanVersionsRepository implements PlanVersionsRepository {
  readonly rows = new Map<string, PlanVersionDto>();

  async insert(version: PlanVersionDto): Promise<void> {
    this.rows.set(version.id, { ...version });
  }

  async get(id: string): Promise<PlanVersionDto | undefined> {
    return this.rows.get(id);
  }

  async listByTicket(ticketId: string): Promise<PlanVersionDto[]> {
    return [...this.rows.values()].filter((v) => v.ticketId === ticketId).sort((a, b) => a.version - b.version);
  }

  async latest(ticketId: string): Promise<PlanVersionDto | undefined> {
    return (await this.listByTicket(ticketId)).at(-1);
  }

  async setStatus(id: string, status: PlanVersionDto['status']): Promise<void> {
    const current = this.rows.get(id);
    if (current) this.rows.set(id, { ...current, status });
  }
}

export class MemoryPlanCommentsRepository implements PlanCommentsRepository {
  readonly rows = new Map<string, PlanCommentDto>();
  constructor(private readonly versions: MemoryPlanVersionsRepository) {}

  async insert(comment: PlanCommentDto): Promise<void> {
    this.rows.set(comment.id, { ...comment });
  }

  async get(id: string): Promise<PlanCommentDto | undefined> {
    return this.rows.get(id);
  }

  async listByTicket(ticketId: string): Promise<PlanCommentDto[]> {
    const versionIds = new Set((await this.versions.listByTicket(ticketId)).map((v) => v.id));
    return [...this.rows.values()].filter((c) => versionIds.has(c.planVersionId)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }

  async resolve(id: string, resolvedByVersion: number): Promise<void> {
    const current = this.rows.get(id);
    if (!current) throw new Error(`comment ${id} not found`);
    this.rows.set(id, { ...current, resolvedByVersion });
  }
}
