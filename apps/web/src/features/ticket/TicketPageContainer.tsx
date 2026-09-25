import { useNavigate } from '@tanstack/react-router';
import { FileText } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useCurrentLogin } from '@/app/current-user';
import { useMe, useTicket } from '@/app/queries';
import { es } from '@/i18n/es';
import { useTicketStream } from '@/app/use-ticket-stream';
import { resolveActions } from '@/lib/action-resolver';
import { effectiveScores, latestAssessment } from '@/lib/assessment';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { Skeleton } from '@/ui/skeleton';
import { ActionPanel } from './ActionPanel';
import { AnswerQuestionsDialog, latestQuestions } from './AnswerQuestionsDialog';
import { AssessmentCard } from './AssessmentCard';
import { ApproveDialog, ConfirmTriageDialog, ReasonDialog, RequestChangesDialog } from './dialogs';
import { RiskBanner } from './RiskBanner';
import { TicketHeader } from './TicketHeader';
import { Timeline } from './Timeline';
import { useTicketActions } from './use-ticket-actions';

export function TicketPageContainer({ ticketId }: { ticketId: string }) {
  const navigate = useNavigate();
  const login = useCurrentLogin();
  const me = useMe();
  const refetchInterval = useTicketStream(ticketId);
  const ticketQuery = useTicket(ticketId, { refetchInterval });
  const detail = ticketQuery.data;
  const role = me.data?.role ?? 'requester';
  const now = useMemo(() => new Date(), [detail?.ticket.updatedAt, detail?.latestRun?.status]);

  const actions = useMemo(
    () => (detail ? resolveActions({ ticket: detail.ticket, role, login, latestRun: detail.latestRun, now }) : undefined),
    [detail, role, login, now],
  );

  const goToPlan = () => void navigate({ to: '/tickets/$id/plan', params: { id: ticketId } });
  const { dialog, setDialog, onAction, send, busy } = useTicketActions(detail, { requiresSecondApprover: actions?.requiresSecondApprover ?? false, onAddComment: goToPlan });

  // Keyboard: a = approve, r = request changes, when offered and not typing.
  useEffect(() => {
    if (!actions) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || dialog) return;
      if (e.key === 'a' && actions.primary?.id === 'approve') onAction(actions.primary);
      if (e.key === 'r' && actions.secondary?.id === 'request_changes') onAction(actions.secondary);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [actions, dialog, onAction]);

  if (ticketQuery.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-5 w-1/3" />
        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <Skeleton className="h-64" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }
  if (ticketQuery.isError || !detail || !actions) {
    return (
      <EmptyState title={es.ticketPage.notAvailableTitle}>
        {ticketQuery.error instanceof Error ? ticketQuery.error.message : es.ticketPage.couldNotLoad}
        <div className="mt-3">
          <Button variant="outline" onClick={() => void ticketQuery.refetch()}>
            {es.ticketPage.retry}
          </Button>
        </div>
      </EmptyState>
    );
  }

  const { ticket } = detail;
  const planHref = (ref: string) => `/tickets/${encodeURIComponent(ticketId)}/plan?version=${encodeURIComponent(ref)}`;
  const pendingQuestions = latestQuestions(detail.events);
  const assessment = latestAssessment(ticket, detail.events);
  const initialScores = effectiveScores(ticket, assessment?.assessment);

  return (
    <div className="flex flex-col gap-4">
      <TicketHeader
        ticket={ticket}
        actions={
          detail.latestPlan ? (
            <Button variant="outline" onClick={goToPlan}>
              <FileText className="size-4" aria-hidden="true" />
              {es.ticketPage.openPlan(detail.latestPlan.version)}
            </Button>
          ) : undefined
        }
      />
      <RiskBanner tier={ticket.riskTier} />
      {role !== 'requester' ? <AssessmentCard ticket={ticket} events={detail.events} /> : null}
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section aria-label={es.ticketPage.timelineAria} className="min-w-0">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{es.ticketPage.timelineHeading}</h2>
          <Timeline events={detail.events} planHref={planHref} onNavigate={(href) => void navigate({ href })} />
        </section>
        <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start" aria-label={es.ticketPage.actionsAria}>
          <ActionPanel detail={detail} actions={actions} role={role} login={login} busy={busy} now={now} onAction={onAction} />
        </aside>
      </div>

      <ApproveDialog key={`approve-${dialog}`} open={dialog === 'approve'} busy={busy} onOpenChange={(o) => setDialog(o ? 'approve' : null)} login={login} onConfirm={(body) => send({ kind: 'approve', body })} />
      <RequestChangesDialog
        key={`rc-${dialog}`}
        open={dialog === 'request_changes'}
        busy={busy}
        onOpenChange={(o) => setDialog(o ? 'request_changes' : null)}
        unresolvedComments={detail.unresolvedCommentCount}
        onConfirm={(body) => send({ kind: 'request_changes', body })}
      />
      <ConfirmTriageDialog
        key={`ct-${dialog}`}
        open={dialog === 'confirm_triage'}
        busy={busy}
        onOpenChange={(o) => setDialog(o ? 'confirm_triage' : null)}
        ticket={ticket}
        repos={[]}
        {...(initialScores ? { initialScores } : {})}
        onConfirm={(body) => send({ kind: 'confirm_triage', body })}
      />
      <ReasonDialog
        key={`reject-${dialog}`}
        open={dialog === 'reject'}
        busy={busy}
        onOpenChange={(o) => setDialog(o ? 'reject' : null)}
        title={es.dialogs.reject.title}
        description={es.dialogs.reject.description}
        confirmLabel={es.dialogs.reject.confirm}
        destructive
        onConfirm={(body) => send({ kind: 'reject', body: { ...(body.reason ? { reason: body.reason } : {}) } })}
      />
      <ReasonDialog
        key={`dup-${dialog}`}
        open={dialog === 'duplicate'}
        busy={busy}
        onOpenChange={(o) => setDialog(o ? 'duplicate' : null)}
        title={es.dialogs.duplicate.title}
        description={es.dialogs.duplicate.description}
        confirmLabel={es.dialogs.duplicate.confirm}
        destructive
        withDuplicateOf
        onConfirm={(body) => send({ kind: 'duplicate', body })}
      />
      <ReasonDialog
        key={`ai-${dialog}`}
        open={dialog === 'already_implemented'}
        busy={busy}
        onOpenChange={(o) => setDialog(o ? 'already_implemented' : null)}
        title={es.dialogs.alreadyImplemented.title}
        description={es.dialogs.alreadyImplemented.description}
        confirmLabel={es.dialogs.alreadyImplemented.confirm}
        destructive
        onConfirm={(body) => send({ kind: 'already_implemented', body: { ...(body.reason ? { reason: body.reason } : {}) } })}
      />
      <ReasonDialog
        key={`reopen-${dialog}`}
        open={dialog === 'reopen'}
        busy={busy}
        onOpenChange={(o) => setDialog(o ? 'reopen' : null)}
        title={es.dialogs.reopen.title}
        description={es.dialogs.reopen.description}
        confirmLabel={es.dialogs.reopen.confirm}
        onConfirm={(body) => send({ kind: 'reopen', body: { ...(body.reason ? { reason: body.reason } : {}) } })}
      />
      <ReasonDialog
        key={`replan-${dialog}`}
        open={dialog === 'replan'}
        busy={busy}
        onOpenChange={(o) => setDialog(o ? 'replan' : null)}
        title={es.dialogs.replan.title}
        description={es.dialogs.replan.description}
        confirmLabel={es.dialogs.replan.confirm}
        onConfirm={(body) => send({ kind: 'replan', body: { ...(body.reason ? { reason: body.reason } : {}) } })}
      />
      <ReasonDialog
        key={`stop-${dialog}`}
        open={dialog === 'stop'}
        busy={busy}
        onOpenChange={(o) => setDialog(o ? 'stop' : null)}
        title={es.dialogs.stop.title}
        description={es.dialogs.stop.description}
        confirmLabel={es.dialogs.stop.confirm}
        destructive
        onConfirm={(body) => send({ kind: 'flag', body: { flag: 'paused', set: true, ...(body.reason ? { reason: body.reason } : {}) } })}
      />
      <AnswerQuestionsDialog
        key={`aq-${dialog}`}
        open={dialog === 'answer_questions'}
        busy={busy}
        onOpenChange={(o) => setDialog(o ? 'answer_questions' : null)}
        questions={pendingQuestions?.questions ?? []}
        onConfirm={(answers) => send({ kind: 'answer_questions', body: { round: pendingQuestions?.round ?? ticket.clarificationRound ?? 1, answers } })}
      />
    </div>
  );
}
