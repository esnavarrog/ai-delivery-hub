import type { PlanVersionDto } from '@ai-delivery-hub/contracts';
import type { PlanSectionKey } from '@ai-delivery-hub/domain';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, FileText, GitCompareArrows, LayoutList } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useCurrentLogin } from '@/app/current-user';
import { es } from '@/i18n/es';
import { useMe, usePlan, useTicket } from '@/app/queries';
import { useTicketStream } from '@/app/use-ticket-stream';
import { resolveActions } from '@/lib/action-resolver';
import { changedSectionPaths, changedTopLevelSections } from '@/lib/plan-diff';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { EmptyState } from '@/ui/empty-state';
import { RelativeTime } from '@/ui/relative-time';
import { RiskBadge } from '@/ui/risk-badge';
import { Skeleton } from '@/ui/skeleton';
import { StateChip } from '@/ui/state-chip';
import { ApproveDialog, RequestChangesDialog } from '../ticket/dialogs';
import { RiskBanner } from '../ticket/RiskBanner';
import { useTicketActions } from '../ticket/use-ticket-actions';
import { PlanMarkdown } from './PlanMarkdown';
import { PlanView } from './PlanView';
import { VersionSwitcher } from './VersionSwitcher';

const REVIEW_ROLES = ['lead', 'admin'];

export function PlanPageContainer({ ticketId, versionId, onVersionChange }: { ticketId: string; versionId: string | undefined; onVersionChange: (id: string) => void }) {
  const navigate = useNavigate();
  const login = useCurrentLogin();
  const me = useMe();
  const refetchInterval = useTicketStream(ticketId);
  const ticketQuery = useTicket(ticketId, { refetchInterval });
  const planQuery = usePlan(ticketId);
  const [compare, setCompare] = useState(false);
  const [view, setView] = useState<'structured' | 'markdown'>('structured');

  const versions = useMemo(() => [...(planQuery.data?.versions ?? [])].sort((a, b) => a.version - b.version), [planQuery.data]);
  const selected: PlanVersionDto | undefined = versions.find((v) => v.id === versionId) ?? versions[versions.length - 1];
  const previous = selected ? versions.find((v) => v.version === selected.version - 1) : undefined;
  const comments = useMemo(() => (planQuery.data?.comments ?? []).filter((c) => c.planVersionId === selected?.id), [planQuery.data, selected]);
  const unresolved = comments.filter((c) => c.resolvedByVersion === null).length;

  const changedSections = useMemo<Set<PlanSectionKey>>(() => {
    if (!compare || !selected || !previous) return new Set();
    return changedTopLevelSections(changedSectionPaths(previous.plan, selected.plan));
  }, [compare, selected, previous]);

  const detail = ticketQuery.data;
  const role = me.data?.role ?? 'requester';
  const now = useMemo(() => new Date(), [detail?.ticket.updatedAt]);
  const actions = useMemo(() => (detail ? resolveActions({ ticket: detail.ticket, role, login, latestRun: detail.latestRun, now }) : undefined), [detail, role, login, now]);
  const { dialog, setDialog, onAction, send, busy } = useTicketActions(detail, { requiresSecondApprover: actions?.requiresSecondApprover ?? false, onAddComment: () => undefined });

  const canResolve = !!detail && (REVIEW_ROLES.includes(role) || detail.ticket.ownerUserId === login);
  const canComment = login.length > 0;
  const isLatest = !!selected && selected.version === versions[versions.length - 1]?.version;

  if (planQuery.isPending || ticketQuery.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-8 w-1/2" />
        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <Skeleton className="h-96" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }
  if (planQuery.isError || ticketQuery.isError || !detail) {
    const err = planQuery.error ?? ticketQuery.error;
    return <EmptyState title={es.plan.notAvailableTitle}>{err instanceof Error ? err.message : es.plan.couldNotLoad}</EmptyState>;
  }
  if (!selected) {
    return (
      <EmptyState title={es.plan.noPlanYetTitle}>
        {es.plan.noPlanYetBody}
        <div className="mt-3">
          <Button variant="outline" asChild>
            <Link to="/tickets/$id" params={{ id: ticketId }}>
              {es.plan.backToTicket}
            </Link>
          </Button>
        </div>
      </EmptyState>
    );
  }

  const approve = actions?.primary?.id === 'approve' ? actions.primary : undefined;
  const requestChanges = actions?.secondary?.id === 'request_changes' ? actions.secondary : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link to="/tickets/$id" params={{ id: ticketId }} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden="true" />
            {detail.ticket.displayKey} {detail.ticket.subject}
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">
            Plan v{selected.version} <span className="text-base font-normal text-muted-foreground">· {selected.status}</span>
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StateChip state={detail.ticket.state} />
            <RiskBadge tier={detail.ticket.riskTier} />
            <RelativeTime iso={selected.createdAt} prefix="creado" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <VersionSwitcher versions={versions} selectedId={selected.id} onSelect={onVersionChange} />
          <Button variant="outline" aria-pressed={view === 'markdown'} onClick={() => setView((v) => (v === 'markdown' ? 'structured' : 'markdown'))}>
            {view === 'markdown' ? <LayoutList className="size-4" aria-hidden="true" /> : <FileText className="size-4" aria-hidden="true" />}
            {view === 'markdown' ? es.plan.structuredView : es.plan.markdownView}
          </Button>
          <Button variant={compare ? 'secondary' : 'outline'} disabled={!previous} aria-pressed={compare} onClick={() => setCompare((c) => !c)} title={previous ? undefined : es.plan.noPreviousVersion}>
            <GitCompareArrows className="size-4" aria-hidden="true" />
            {previous ? es.plan.compareWith(previous.version) : es.plan.compare}
          </Button>
        </div>
      </div>
      <RiskBanner tier={detail.ticket.riskTier} />
      {compare && previous ? (
        <p className="text-sm text-muted-foreground" role="status">
          {changedSections.size === 0 ? es.plan.noSectionDiffers(previous.version) : es.plan.sectionsChanged(changedSections.size, previous.version)}
        </p>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="min-w-0">
          {view === 'markdown' ? (
            <PlanMarkdown markdown={selected.renderedMarkdown} />
          ) : (
          <PlanView
            version={selected}
            comments={comments}
            changedSections={changedSections}
            canComment={canComment}
            canResolve={canResolve}
            busy={busy}
            onAddComment={({ sectionPath, body }) => send({ kind: 'comment', body: { sectionPath, body, planVersionId: selected.id } })}
            onResolve={(commentId) => send({ kind: 'resolve_comment', commentId })}
            draftHtml={() => undefined}
          />
          )}
        </div>
        <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start" aria-label={es.plan.reviewTitle}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{es.plan.reviewTitle}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <p className={cn(unresolved > 0 ? 'text-warning-foreground dark:text-warning' : 'text-muted-foreground')}>
                <span className="text-2xl font-semibold tabular-nums">{unresolved}</span> {es.plan.unresolvedComments(unresolved)}
                {selected.version}
              </p>
              {!isLatest ? <p className="text-muted-foreground">{es.plan.viewingOlderVersion}</p> : null}
              {approve || requestChanges ? (
                <div className="flex flex-col gap-2">
                  {approve ? (
                    <div className="flex flex-col gap-1">
                      <Button className="w-full" disabled={busy || approve.disabledReason !== undefined} onClick={() => onAction(approve)}>
                        {approve.label}
                      </Button>
                      {approve.disabledReason ? <p className="text-xs text-muted-foreground">{approve.disabledReason}</p> : null}
                    </div>
                  ) : null}
                  {requestChanges ? (
                    <Button variant="outline" className="w-full" disabled={busy} onClick={() => onAction(requestChanges)}>
                      {requestChanges.label}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <p className="text-muted-foreground">{actions?.info.message}</p>
              )}
              <Button variant="ghost" className="w-full" onClick={() => void navigate({ to: '/tickets/$id', params: { id: ticketId } })}>
                {es.actions.backToTimeline}
              </Button>
            </CardContent>
          </Card>
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
    </div>
  );
}
