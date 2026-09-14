import {
  canTransition,
  type Actor,
  type Clock,
  type EventStore,
  type IdGenerator,
  type OpenProjectPort,
  type TicketEvent,
  type TicketSnapshot,
  type TicketState,
} from '@ai-delivery-hub/domain';
import { OpenProjectConflictError } from '../../adapters/openproject/client.js';
import { projectTicket } from '../ingest/ticket-received.js';

export type OutboxKind = 'op_comment' | 'op_status';

export type OutboxPayload = { body: string } | { statusName: string };

export interface OutboxRow {
  key: string;
  ticketId: string;
  eventSeq: number;
  kind: OutboxKind;
  opWorkPackageId: number;
  payload: OutboxPayload;
}

export type StatusSyncMap = Partial<Record<TicketState, string>>;

export interface SyncOptions {
  statusSync: StatusSyncMap;
  /** Public base URL of the web app, used in OpenProject comments. */
  hubPublicUrl: string;
}

export const SYNC_ACTOR: Actor = { kind: 'system', id: 'op-sync' };

export function outboxKey(ticketId: string, eventSeq: number, kind: OutboxKind): string {
  return `${ticketId}:${eventSeq}:${kind}`;
}

export function receivedComment(snapshot: TicketSnapshot): string {
  return [
    `AI Delivery Hub received this work package as ticket \`${snapshot.id}\`.`,
    'It will be triaged automatically; a developer will review the proposed plan before any change is made.',
  ].join('\n');
}

export function planReadyComment(ticketId: string, version: number, goal: string | undefined, hubPublicUrl: string): string {
  const link = `${hubPublicUrl.replace(/\/+$/, '')}/tickets/${ticketId}/plan`;
  return `AI plan v${version} ready for review: ${link}${goal ? ` — ${goal}` : ''}`;
}

/**
 * Outbox rows a freshly appended event should produce, given the snapshot *after* applying it.
 * Pure: the caller persists the rows with `OutboxRepository.enqueue`, which ignores duplicate keys.
 */
export function outboxRowsForEvent(event: TicketEvent, after: TicketSnapshot, options: SyncOptions): OutboxRow[] {
  const base = { ticketId: event.ticketId, eventSeq: event.seq, opWorkPackageId: after.opWorkPackageId };
  const comment = (body: string): OutboxRow => ({ ...base, key: outboxKey(event.ticketId, event.seq, 'op_comment'), kind: 'op_comment', payload: { body } });
  if (event.type === 'ticket_received') return [comment(receivedComment(after))];
  if (event.type === 'op_sync_posted' || event.type === 'ticket_updated_from_op') return [];
  const rows: OutboxRow[] = [];
  if (event.type === 'plan_version_created') {
    rows.push(comment(planReadyComment(event.ticketId, event.payload.version, event.payload.goal, options.hubPublicUrl)));
  }
  const statusName = options.statusSync[after.state];
  if (statusName !== undefined) rows.push({ ...base, key: outboxKey(event.ticketId, event.seq, 'op_status'), kind: 'op_status', payload: { statusName } });
  return rows;
}

export type OutboxStatus = 'pending' | 'posted' | 'failed';

export interface StoredOutboxRow extends OutboxRow {
  status: OutboxStatus;
  attempts: number;
  externalRef?: string;
  lastError?: string;
}

export interface OutboxRepository {
  /** Inserts rows whose key is new; returns the keys actually inserted. */
  enqueue(rows: readonly OutboxRow[]): Promise<string[]>;
  get(key: string): Promise<StoredOutboxRow | undefined>;
  markPosted(key: string, externalRef: string): Promise<void>;
  markFailed(key: string, error: string): Promise<void>;
}

export interface OpenProjectSyncPort extends OpenProjectPort {
  statusIdByName(name: string): Promise<number>;
}

export interface OutboxWorkerDeps {
  repo: OutboxRepository;
  op: OpenProjectSyncPort;
  eventStore: EventStore;
  ids: IdGenerator;
  clock: Clock;
}

export type OutboxResult = { kind: 'posted'; externalRef: string } | { kind: 'skipped'; reason: string } | { kind: 'failed'; error: string };

/** Posts one outbox row to OpenProject and records `op_sync_posted` on the ticket stream. */
export class OutboxWorker {
  constructor(private readonly deps: OutboxWorkerDeps) {}

  async process(key: string): Promise<OutboxResult> {
    const row = await this.deps.repo.get(key);
    if (!row) return { kind: 'skipped', reason: 'unknown key' };
    if (row.status === 'posted') return { kind: 'skipped', reason: 'already posted' };
    try {
      const externalRef = await this.post(row);
      await this.deps.repo.markPosted(key, externalRef);
      await this.recordPosted(row, externalRef);
      return { kind: 'posted', externalRef };
    } catch (err) {
      const message = err instanceof OpenProjectConflictError ? `lockVersion conflict: ${err.message}` : (err as Error).message;
      await this.deps.repo.markFailed(key, message);
      return { kind: 'failed', error: message };
    }
  }

  private async post(row: StoredOutboxRow): Promise<string> {
    if (row.kind === 'op_comment') {
      const { commentId } = await this.deps.op.addComment(row.opWorkPackageId, (row.payload as { body: string }).body);
      return commentId;
    }
    const statusName = (row.payload as { statusName: string }).statusName;
    const statusId = await this.deps.op.statusIdByName(statusName);
    // Always fetch the current lockVersion: OpenProject may have moved since ingest.
    const fresh = await this.deps.op.getWorkPackage(row.opWorkPackageId);
    if (fresh.status === statusName) return `status:${statusId}:noop`;
    const updated = await this.deps.op.setStatus(row.opWorkPackageId, statusId, fresh.lockVersion);
    return `status:${statusId}:lock${updated.lockVersion}`;
  }

  private async recordPosted(row: StoredOutboxRow, externalRef: string): Promise<void> {
    const events = await this.deps.eventStore.load(row.ticketId);
    const { snapshot } = projectTicket(events);
    // Informational events are refused on terminal tickets (e.g. a mirrored `rejected`); the outbox row is the record then.
    if (!canTransition({ ticket: snapshot, actor: SYNC_ACTOR }, 'op_sync_posted').allowed) return;
    const seq = events.length + 1;
    const event = {
      id: this.deps.ids.uuid(),
      ticketId: row.ticketId,
      seq,
      type: 'op_sync_posted',
      actor: SYNC_ACTOR,
      artifacts: row.kind === 'op_comment' ? [{ kind: 'op_comment', ref: externalRef }] : [],
      payload: { kind: row.kind, outboxKey: row.key, sourceSeq: row.eventSeq, externalRef },
      createdAt: this.deps.clock.nowIso(),
    } as TicketEvent;
    await this.deps.eventStore.append(row.ticketId, events.length, [event]);
  }
}
