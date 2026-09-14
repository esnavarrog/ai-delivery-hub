import type {
  AddCommentBody,
  ApproveBody,
  CommandResponse,
  CommentResponse,
  ConfirmTriageBody,
  DecisionBody,
  DuplicateBody,
  EnqueuedResponse,
  FlagBody,
  MeResponse,
  RequestChangesBody,
  RunsResponse,
  TicketDetailResponse,
  TicketListResponse,
  TicketPlanResponse,
} from '@ai-delivery-hub/contracts';
import { useMutation, useQuery, useQueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from './api-client';
import { useCurrentLogin } from './current-user';

export const keys = {
  me: (login: string) => ['me', login] as const,
  tickets: (login: string, params: Record<string, string | undefined>) => ['tickets', login, params] as const,
  ticket: (login: string, id: string) => ['ticket', login, id] as const,
  plan: (login: string, id: string) => ['plan', login, id] as const,
  runs: (login: string, ticketId?: string) => ['runs', login, ticketId ?? 'all'] as const,
};

const qs = (params: Record<string, string | undefined>): string => {
  const entries = Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined && e[1] !== '');
  return entries.length > 0 ? `?${new URLSearchParams(entries).toString()}` : '';
};

export function useMe() {
  const login = useCurrentLogin();
  return useQuery({ queryKey: keys.me(login), queryFn: () => api.get<MeResponse>('/api/me'), enabled: login.length > 0, retry: false, staleTime: 60_000 });
}

export function useTicketList(params: { state?: string; repo?: string; owner?: string; waitingOn?: 'me' } = {}) {
  const login = useCurrentLogin();
  return useQuery({
    queryKey: keys.tickets(login, params),
    queryFn: () => api.get<TicketListResponse>(`/api/tickets${qs(params)}`),
    enabled: login.length > 0,
    refetchInterval: 15_000,
  });
}

export function useTicket(id: string, options: { refetchInterval?: number | false } = {}) {
  const login = useCurrentLogin();
  return useQuery({
    queryKey: keys.ticket(login, id),
    queryFn: () => api.get<TicketDetailResponse>(`/api/tickets/${encodeURIComponent(id)}`),
    enabled: login.length > 0,
    refetchInterval: options.refetchInterval ?? false,
  });
}

export function usePlan(id: string) {
  const login = useCurrentLogin();
  return useQuery({ queryKey: keys.plan(login, id), queryFn: () => api.get<TicketPlanResponse>(`/api/tickets/${encodeURIComponent(id)}/plan`), enabled: login.length > 0 });
}

export function useRuns(ticketId?: string) {
  const login = useCurrentLogin();
  return useQuery({
    queryKey: keys.runs(login, ticketId),
    queryFn: () => api.get<RunsResponse>(`/api/runs${qs({ ticketId })}`),
    enabled: login.length > 0,
    refetchInterval: 10_000,
  });
}

/** Everything that can change a ticket from the UI. Each posts to one server route. */
export type TicketCommand =
  | { kind: 'claim' }
  | { kind: 'confirm_triage'; body: ConfirmTriageBody }
  | { kind: 'request_changes'; body: RequestChangesBody }
  | { kind: 'approve'; body: ApproveBody }
  | { kind: 'reject'; body: DecisionBody }
  | { kind: 'duplicate'; body: DuplicateBody }
  | { kind: 'already_implemented'; body: DecisionBody }
  | { kind: 'reopen'; body: DecisionBody }
  | { kind: 'flag'; body: FlagBody }
  | { kind: 'retriage' }
  | { kind: 'replan'; body: DecisionBody }
  | { kind: 'comment'; body: AddCommentBody }
  | { kind: 'resolve_comment'; commentId: string };

const ROUTES: Record<TicketCommand['kind'], string> = {
  claim: 'claim',
  confirm_triage: 'confirm-triage',
  request_changes: 'request-changes',
  approve: 'approve',
  reject: 'reject',
  duplicate: 'duplicate',
  already_implemented: 'already-implemented',
  reopen: 'reopen',
  flag: 'flags',
  retriage: 'retriage',
  replan: 'replan',
  comment: 'comments',
  resolve_comment: 'comments',
};

export const SUCCESS_MESSAGES: Record<TicketCommand['kind'], string> = {
  claim: 'Ticket claimed. Planning starts now.',
  confirm_triage: 'Triage confirmed.',
  request_changes: 'Changes requested.',
  approve: 'Plan approved.',
  reject: 'Ticket rejected.',
  duplicate: 'Ticket marked as duplicate.',
  already_implemented: 'Ticket marked as already implemented.',
  reopen: 'Plan reopened for review.',
  flag: 'Flag updated.',
  retriage: 'Triage queued again.',
  replan: 'New plan version requested.',
  comment: 'Comment added.',
  resolve_comment: 'Comment resolved.',
};

export type CommandResult = CommandResponse | CommentResponse | EnqueuedResponse;

export function runTicketCommand(ticketId: string, command: TicketCommand): Promise<CommandResult> {
  const id = encodeURIComponent(ticketId);
  if (command.kind === 'resolve_comment') {
    return api.post<CommandResponse>(`/api/tickets/${id}/comments/${encodeURIComponent(command.commentId)}/resolve`);
  }
  const body = 'body' in command ? command.body : undefined;
  return api.post<CommandResult>(`/api/tickets/${id}/${ROUTES[command.kind]}`, body);
}

export function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}

/** One mutation for every ticket command: toast on both outcomes, then invalidate the ticket queries. */
export function useTicketCommand(ticketId: string, options: Pick<UseMutationOptions<CommandResult, unknown, TicketCommand>, 'onSuccess'> = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: TicketCommand) => runTicketCommand(ticketId, command),
    onSuccess: async (data, command, context, mutation) => {
      toast.success(SUCCESS_MESSAGES[command.kind]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ticket'] }),
        queryClient.invalidateQueries({ queryKey: ['tickets'] }),
        queryClient.invalidateQueries({ queryKey: ['plan'] }),
        queryClient.invalidateQueries({ queryKey: ['runs'] }),
      ]);
      await options.onSuccess?.(data, command, context, mutation);
    },
    onError: (err) => {
      toast.error(describeError(err));
    },
  });
}
