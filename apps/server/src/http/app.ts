import {
  AddCommentBody,
  ApproveBody,
  ConfirmTriageBody,
  CreateTicketBody,
  DecisionBody,
  DuplicateBody,
  FlagBody,
  RequestChangesBody,
  RunsQuery,
  SubmitAnswersBody,
  TicketListQuery,
  type CommandResponse,
  type CommentResponse,
  type CreateTicketResponse,
  type EnqueuedResponse,
  type ErrorCode,
  type ErrorResponse,
  type FetchResponse,
  type MeResponse,
  type PlanVersionSummary,
  type RunResponse,
  type RunsResponse,
  type TicketDetailResponse,
  type TicketListResponse,
  type TicketPlanResponse,
} from '@ai-delivery-hub/contracts';
import type { ManualIntake, Role, TicketEvent, TicketSnapshot, TicketState } from '@ai-delivery-hub/domain';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { isWaitingOn, type HubUser, type TicketCommands } from '../modules/approval/commands.js';
import type { PlanCommentsRepository, PlanVersionsRepository, RunsRepository } from '../modules/shared/repositories.js';
import { ForbiddenError, InvalidCommandError, TicketNotFoundError, TransitionDeniedError } from '../modules/shared/ticket-command.js';

/** Minimal surface of `CreateManualTicket` the HTTP layer needs; avoids importing its full deps type. */
export interface CreateTicketUseCase {
  execute(input: { title: string; description: string; intake: ManualIntake; requesterUserId: string }): Promise<{ ticketId: string; key: string }>;
}

export interface TicketFilters {
  state?: TicketState;
  repo?: string;
  owner?: string;
}

/** Read side used by the HTTP API; implemented over the tickets projection. */
export interface TicketQueries {
  list(filters: TicketFilters): Promise<TicketSnapshot[]>;
  get(id: string): Promise<{ snapshot: TicketSnapshot; events: TicketEvent[] } | undefined>;
  eventsAfter(id: string, seq: number): Promise<TicketEvent[]>;
}

/**
 * Phase 1 development auth: the caller states its GitHub login in this header (or `?hub_user=`
 * for EventSource, which cannot send headers) and the role comes from `repos.yaml` → `roles`.
 * Unknown logins are rejected. GitHub OAuth replaces this in a later step.
 */
export const HUB_USER_HEADER = 'X-Hub-User';
export const HUB_USER_QUERY = 'hub_user';

export interface AppDeps {
  queries: TicketQueries;
  ingestFetch: { execute(): Promise<FetchResponse> };
  sse?: { pollIntervalMs?: number };
  auth: { roles: Record<string, Role> };
  commands: TicketCommands;
  /** Creates a manual (feature-request) ticket; backs `POST /api/tickets`. */
  createTicket: CreateTicketUseCase;
  planVersions: PlanVersionsRepository;
  planComments: PlanCommentsRepository;
  runs: RunsRepository;
}

/** Roles allowed to file a feature request from the web intake route. */
const TICKET_CREATOR_ROLES: readonly Role[] = ['requester', 'lead', 'admin'];

/** A `requester` may only see their own tickets; every other role keeps today's unrestricted access. */
function assertTicketVisible(user: HubUser, snapshot: TicketSnapshot, ticketId: string): void {
  if (user.role === 'requester' && snapshot.requesterUserId !== user.login) throw new TicketNotFoundError(ticketId);
}

type Env = { Variables: { user: HubUser } };

class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const errorBody = (code: ErrorCode, message: string): ErrorResponse => ({ error: { code, message } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Parses the JSON body (an absent body counts as `{}`) against `schema`; 400 with the zod message otherwise. */
async function parseBody<T>(c: Context<Env>, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown = {};
  const text = await c.req.text();
  if (text.trim().length > 0) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HttpError(400, 'bad_request', 'body is not valid JSON');
    }
  }
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) throw new HttpError(400, 'bad_request', z.prettifyError(parsed.error));
  return parsed.data;
}

function parseQuery<T>(c: Context<Env>, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) throw new HttpError(400, 'bad_request', z.prettifyError(parsed.error));
  return parsed.data;
}

export function createApp(deps: AppDeps): Hono<Env> {
  const app = new Hono<Env>();
  const pollIntervalMs = deps.sse?.pollIntervalMs ?? 1000;

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json(errorBody(err.code, err.message), err.status);
    if (err instanceof TicketNotFoundError) return c.json(errorBody('not_found', err.message), 404);
    if (err instanceof TransitionDeniedError) return c.json(errorBody('conflict', err.message), 409);
    if (err instanceof ForbiddenError) return c.json(errorBody('forbidden', err.message), 403);
    if (err instanceof InvalidCommandError) return c.json(errorBody('bad_request', err.message), 400);
    console.error(JSON.stringify({ level: 'error', msg: 'unhandled http error', error: err.message, stack: err.stack }));
    return c.json(errorBody('internal', 'internal error'), 500);
  });
  app.notFound((c) => c.json(errorBody('not_found', `no route for ${c.req.method} ${c.req.path}`), 404));

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.use('/api/*', async (c, next) => {
    const login = c.req.header(HUB_USER_HEADER) ?? c.req.query(HUB_USER_QUERY);
    if (!login) throw new HttpError(401, 'unauthorized', `missing ${HUB_USER_HEADER} header`);
    const role = deps.auth.roles[login];
    if (!role) throw new HttpError(401, 'unauthorized', `unknown user ${login}; add it to repos.yaml roles`);
    c.set('user', { login, role });
    await next();
  });

  app.get('/api/me', (c) => {
    const user = c.get('user');
    const body: MeResponse = { login: user.login, role: user.role };
    return c.json(body);
  });

  /** Manual, on-demand ingest: pulls OpenProject and, when configured, imports the Obsidian inbox. */
  app.post('/api/ingest/fetch', async (c) => {
    const body: FetchResponse = await deps.ingestFetch.execute();
    return c.json(body);
  });

  app.get('/api/tickets', async (c) => {
    const query = parseQuery(c, TicketListQuery);
    const filters: TicketFilters = {};
    if (query.state) filters.state = query.state;
    if (query.repo) filters.repo = query.repo;
    if (query.owner) filters.owner = query.owner;
    let tickets = await deps.queries.list(filters);
    const user = c.get('user');
    if (user.role === 'requester') tickets = tickets.filter((t) => t.requesterUserId === user.login);
    if (query.waitingOn === 'me') {
      tickets = tickets.filter((t) => isWaitingOn(t, user));
    }
    const body: TicketListResponse = { tickets };
    return c.json(body);
  });

  /** Feature-request intake: a requester (or a lead/admin filing on someone's behalf) creates a manual ticket. */
  app.post('/api/tickets', async (c) => {
    const user = c.get('user');
    if (!TICKET_CREATOR_ROLES.includes(user.role)) throw new ForbiddenError(`role ${user.role} may not create tickets`);
    const body = await parseBody(c, CreateTicketBody);
    const { ticketId } = await deps.createTicket.execute({ title: body.title, description: body.description, intake: body.intake, requesterUserId: user.login });
    const created = await deps.queries.get(ticketId);
    if (!created) throw new Error(`ticket ${ticketId} was not found immediately after creation`);
    const responseBody: CreateTicketResponse = { ticket: created.snapshot };
    return c.json(responseBody, 201);
  });

  app.get('/api/tickets/:id', async (c) => {
    const id = c.req.param('id');
    const found = await deps.queries.get(id);
    if (!found) throw new TicketNotFoundError(id);
    assertTicketVisible(c.get('user'), found.snapshot, id);
    const [latest, [latestRun]] = await Promise.all([deps.planVersions.latest(id), deps.runs.list({ ticketId: id, limit: 1 })]);
    const latestPlan: PlanVersionSummary | null = latest
      ? { id: latest.id, version: latest.version, goal: latest.plan.goal, baseCommitSha: latest.baseCommitSha, createdAt: latest.createdAt }
      : null;
    const body: TicketDetailResponse = {
      ticket: found.snapshot,
      events: found.events,
      latestPlan,
      unresolvedCommentCount: found.snapshot.unresolvedCommentCount,
      latestRun: latestRun ?? null,
    };
    return c.json(body);
  });

  app.get('/api/tickets/:id/plan', async (c) => {
    const id = c.req.param('id');
    const found = await deps.queries.get(id);
    if (!found) throw new TicketNotFoundError(id);
    assertTicketVisible(c.get('user'), found.snapshot, id);
    const [versions, comments] = await Promise.all([deps.planVersions.listByTicket(id), deps.planComments.listByTicket(id)]);
    const body: TicketPlanResponse = { versions, comments };
    return c.json(body);
  });

  /** Streams events with seq > `after` (default 0) as `ticket_event` messages; polls the store every second. */
  app.get('/api/tickets/:id/events/stream', async (c) => {
    const id = c.req.param('id');
    const found = await deps.queries.get(id);
    if (!found) throw new TicketNotFoundError(id);
    assertTicketVisible(c.get('user'), found.snapshot, id);
    let after = Number(c.req.query('after') ?? c.req.header('Last-Event-ID') ?? 0) || 0;
    return streamSSE(c, async (stream) => {
      while (!stream.aborted && !stream.closed) {
        const events = await deps.queries.eventsAfter(id, after);
        for (const event of events) {
          await stream.writeSSE({ event: 'ticket_event', id: String(event.seq), data: JSON.stringify(event) });
          after = Math.max(after, event.seq);
        }
        await sleep(pollIntervalMs);
      }
    });
  });

  // ---- commands ------------------------------------------------------------

  const command = (c: Context<Env>, result: { snapshot: TicketSnapshot }) => {
    const body: CommandResponse = { ticket: result.snapshot };
    return c.json(body);
  };

  app.post('/api/tickets/:id/claim', async (c) => command(c, await deps.commands.claimTicket(c.req.param('id'), c.get('user'))));

  app.post('/api/tickets/:id/confirm-triage', async (c) =>
    command(c, await deps.commands.confirmTriage(c.req.param('id'), c.get('user'), await parseBody(c, ConfirmTriageBody))),
  );

  app.post('/api/tickets/:id/request-changes', async (c) =>
    command(c, await deps.commands.requestPlanChanges(c.req.param('id'), c.get('user'), await parseBody(c, RequestChangesBody))),
  );

  app.post('/api/tickets/:id/approve', async (c) => command(c, await deps.commands.approvePlan(c.req.param('id'), c.get('user'), await parseBody(c, ApproveBody))));

  app.post('/api/tickets/:id/reject', async (c) => command(c, await deps.commands.rejectTicket(c.req.param('id'), c.get('user'), await parseBody(c, DecisionBody))));

  app.post('/api/tickets/:id/duplicate', async (c) => command(c, await deps.commands.markDuplicate(c.req.param('id'), c.get('user'), await parseBody(c, DuplicateBody))));

  app.post('/api/tickets/:id/already-implemented', async (c) =>
    command(c, await deps.commands.markAlreadyImplemented(c.req.param('id'), c.get('user'), await parseBody(c, DecisionBody))),
  );

  app.post('/api/tickets/:id/reopen', async (c) => command(c, await deps.commands.reopenPlan(c.req.param('id'), c.get('user'), await parseBody(c, DecisionBody))));

  app.post('/api/tickets/:id/flags', async (c) => command(c, await deps.commands.setFlag(c.req.param('id'), c.get('user'), await parseBody(c, FlagBody))));

  app.post('/api/tickets/:id/retriage', async (c) => {
    const result = await deps.commands.retriage(c.req.param('id'), c.get('user'));
    const body: EnqueuedResponse = { ticket: result.snapshot, enqueued: result.enqueued };
    return c.json(body);
  });

  app.post('/api/tickets/:id/answers', async (c) => {
    const result = await deps.commands.submitAnswers(c.req.param('id'), c.get('user'), await parseBody(c, SubmitAnswersBody));
    const body: EnqueuedResponse = { ticket: result.snapshot, enqueued: result.enqueued };
    return c.json(body);
  });

  app.post('/api/tickets/:id/replan', async (c) => {
    const result = await deps.commands.replan(c.req.param('id'), c.get('user'), await parseBody(c, DecisionBody));
    const body: EnqueuedResponse = { ticket: result.snapshot, enqueued: result.enqueued };
    return c.json(body);
  });

  app.post('/api/tickets/:id/comments', async (c) => {
    const result = await deps.commands.addPlanComment(c.req.param('id'), c.get('user'), await parseBody(c, AddCommentBody));
    const body: CommentResponse = { ticket: result.snapshot, comment: result.comment };
    return c.json(body, 201);
  });

  app.post('/api/tickets/:id/comments/:commentId/resolve', async (c) =>
    command(c, await deps.commands.resolvePlanComment(c.req.param('id'), c.get('user'), c.req.param('commentId'))),
  );

  // ---- runs ----------------------------------------------------------------

  /** Requesters have no UI need for AI run costs/logs; the ticket timeline already shows what they need. */
  const assertRunsVisible = (user: HubUser): void => {
    if (user.role === 'requester') throw new ForbiddenError('requesters may not view runs');
  };

  app.get('/api/runs', async (c) => {
    assertRunsVisible(c.get('user'));
    const query = parseQuery(c, RunsQuery);
    const runs = await deps.runs.list(query.ticketId ? { ticketId: query.ticketId } : {});
    const body: RunsResponse = { runs };
    return c.json(body);
  });

  app.get('/api/runs/:id', async (c) => {
    assertRunsVisible(c.get('user'));
    const run = await deps.runs.get(c.req.param('id'));
    if (!run) throw new HttpError(404, 'not_found', `run ${c.req.param('id')} not found`);
    const body: RunResponse = { run };
    return c.json(body);
  });

  return app;
}
