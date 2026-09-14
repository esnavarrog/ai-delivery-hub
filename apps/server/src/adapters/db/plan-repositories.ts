import type { PlanCommentDto, PlanVersionDto, RunDto } from '@ai-delivery-hub/contracts';
import { Plan } from '@ai-delivery-hub/domain';
import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import type { PlanCommentsRepository, PlanVersionsRepository, RunsRepository } from '../../modules/shared/repositories.js';
import type { Db } from './client.js';
import { planComments, planVersions, runs } from './schema.js';

type PlanVersionRow = typeof planVersions.$inferSelect;
type PlanCommentRow = typeof planComments.$inferSelect;
type RunRow = typeof runs.$inferSelect;

function toPlanVersion(row: PlanVersionRow): PlanVersionDto {
  return {
    id: row.id,
    ticketId: row.ticketId,
    version: row.version,
    plan: Plan.parse(row.plan),
    renderedMarkdown: row.renderedMarkdown,
    baseCommitSha: row.baseCommitSha,
    status: row.status as PlanVersionDto['status'],
    createdAt: row.createdAt.toISOString(),
  };
}

export class PgPlanVersionsRepository implements PlanVersionsRepository {
  constructor(private readonly db: Db) {}

  async insert(version: PlanVersionDto): Promise<void> {
    await this.db.insert(planVersions).values({
      id: version.id,
      ticketId: version.ticketId,
      version: version.version,
      plan: version.plan as Record<string, unknown>,
      renderedMarkdown: version.renderedMarkdown,
      baseCommitSha: version.baseCommitSha,
      status: version.status,
      createdAt: new Date(version.createdAt),
    });
  }

  async get(id: string): Promise<PlanVersionDto | undefined> {
    const [row] = await this.db.select().from(planVersions).where(eq(planVersions.id, id));
    return row ? toPlanVersion(row) : undefined;
  }

  async listByTicket(ticketId: string): Promise<PlanVersionDto[]> {
    const rows = await this.db.select().from(planVersions).where(eq(planVersions.ticketId, ticketId)).orderBy(asc(planVersions.version));
    return rows.map(toPlanVersion);
  }

  async latest(ticketId: string): Promise<PlanVersionDto | undefined> {
    const [row] = await this.db.select().from(planVersions).where(eq(planVersions.ticketId, ticketId)).orderBy(desc(planVersions.version)).limit(1);
    return row ? toPlanVersion(row) : undefined;
  }

  async setStatus(id: string, status: PlanVersionDto['status']): Promise<void> {
    await this.db.update(planVersions).set({ status }).where(eq(planVersions.id, id));
  }
}

function toPlanComment(row: PlanCommentRow): PlanCommentDto {
  return {
    id: row.id,
    planVersionId: row.planVersionId,
    sectionPath: row.sectionPath,
    authorId: row.authorId,
    body: row.body,
    resolvedByVersion: row.resolvedByVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

export class PgPlanCommentsRepository implements PlanCommentsRepository {
  constructor(private readonly db: Db) {}

  async insert(comment: PlanCommentDto): Promise<void> {
    await this.db.insert(planComments).values({
      id: comment.id,
      planVersionId: comment.planVersionId,
      sectionPath: comment.sectionPath,
      authorId: comment.authorId,
      body: comment.body,
      resolvedByVersion: comment.resolvedByVersion,
      createdAt: new Date(comment.createdAt),
    });
  }

  async get(id: string): Promise<PlanCommentDto | undefined> {
    const [row] = await this.db.select().from(planComments).where(eq(planComments.id, id));
    return row ? toPlanComment(row) : undefined;
  }

  async listByTicket(ticketId: string): Promise<PlanCommentDto[]> {
    const rows = await this.db
      .select({ comment: planComments })
      .from(planComments)
      .innerJoin(planVersions, eq(planComments.planVersionId, planVersions.id))
      .where(eq(planVersions.ticketId, ticketId))
      .orderBy(asc(planComments.createdAt));
    return rows.map((r) => toPlanComment(r.comment));
  }

  async resolve(id: string, resolvedByVersion: number): Promise<void> {
    await this.db.update(planComments).set({ resolvedByVersion }).where(eq(planComments.id, id));
  }
}

function toRun(row: RunRow): RunDto {
  return {
    id: row.id,
    ticketId: row.ticketId,
    kind: row.kind as RunDto['kind'],
    status: row.status as RunDto['status'],
    model: row.model,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costUsd: row.costUsd === null ? null : Number(row.costUsd),
    budgetTokens: row.budgetTokens,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    failureReason: (row.failureReason as RunDto['failureReason']) ?? null,
    errorMessage: row.errorMessage,
  };
}

function toRunRow(run: RunDto): typeof runs.$inferInsert {
  return {
    id: run.id,
    ticketId: run.ticketId,
    kind: run.kind,
    status: run.status,
    model: run.model,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    costUsd: run.costUsd === null ? null : run.costUsd.toFixed(6),
    budgetTokens: run.budgetTokens,
    startedAt: new Date(run.startedAt),
    endedAt: run.endedAt === null ? null : new Date(run.endedAt),
    failureReason: run.failureReason,
    errorMessage: run.errorMessage,
  };
}

export class PgRunsRepository implements RunsRepository {
  constructor(private readonly db: Db) {}

  async insert(run: RunDto): Promise<void> {
    await this.db.insert(runs).values(toRunRow(run));
  }

  async update(id: string, patch: Partial<Omit<RunDto, 'id'>>): Promise<void> {
    const set: Partial<typeof runs.$inferInsert> = {};
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.model !== undefined) set.model = patch.model;
    if (patch.inputTokens !== undefined) set.inputTokens = patch.inputTokens;
    if (patch.outputTokens !== undefined) set.outputTokens = patch.outputTokens;
    if (patch.costUsd !== undefined) set.costUsd = patch.costUsd === null ? null : patch.costUsd.toFixed(6);
    if (patch.endedAt !== undefined) set.endedAt = patch.endedAt === null ? null : new Date(patch.endedAt);
    if (patch.failureReason !== undefined) set.failureReason = patch.failureReason;
    if (patch.errorMessage !== undefined) set.errorMessage = patch.errorMessage;
    if (Object.keys(set).length === 0) return;
    await this.db.update(runs).set(set).where(eq(runs.id, id));
  }

  async get(id: string): Promise<RunDto | undefined> {
    const [row] = await this.db.select().from(runs).where(eq(runs.id, id));
    return row ? toRun(row) : undefined;
  }

  async list(filters: { ticketId?: string; limit?: number }): Promise<RunDto[]> {
    const where: SQL[] = [];
    if (filters.ticketId) where.push(eq(runs.ticketId, filters.ticketId));
    const rows = await this.db
      .select()
      .from(runs)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(runs.startedAt))
      .limit(filters.limit ?? 100);
    return rows.map(toRun);
  }
}
