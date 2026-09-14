import type { PlanCommentDto, PlanVersionDto, RunDto } from '@ai-delivery-hub/contracts';

/** Agent run accounting; one row per triage/planning attempt. */
export interface RunsRepository {
  insert(run: RunDto): Promise<void>;
  update(id: string, patch: Partial<Omit<RunDto, 'id'>>): Promise<void>;
  get(id: string): Promise<RunDto | undefined>;
  /** Newest first. */
  list(filters: { ticketId?: string; limit?: number }): Promise<RunDto[]>;
}

export interface PlanVersionsRepository {
  insert(version: PlanVersionDto): Promise<void>;
  get(id: string): Promise<PlanVersionDto | undefined>;
  /** Ascending by version. */
  listByTicket(ticketId: string): Promise<PlanVersionDto[]>;
  latest(ticketId: string): Promise<PlanVersionDto | undefined>;
  setStatus(id: string, status: PlanVersionDto['status']): Promise<void>;
}

export interface PlanCommentsRepository {
  insert(comment: PlanCommentDto): Promise<void>;
  get(id: string): Promise<PlanCommentDto | undefined>;
  /** Every comment on every version of the ticket, oldest first. */
  listByTicket(ticketId: string): Promise<PlanCommentDto[]>;
  resolve(id: string, resolvedByVersion: number): Promise<void>;
}
