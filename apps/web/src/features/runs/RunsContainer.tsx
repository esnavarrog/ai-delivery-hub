import type { RunDto } from '@ai-delivery-hub/contracts';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useRuns } from '@/app/queries';
import { es } from '@/i18n/es';
import { runFailureReasonLabels, runKindLabels, runStatusLabels } from '@/i18n/labels';
import { formatAbsolute, formatCost, formatDuration, formatTokens } from '@/lib/format';
import { useRedirectRequesterAway } from '@/lib/route-guards';
import { cn } from '@/lib/utils';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog';
import { EmptyState } from '@/ui/empty-state';
import { PageHeader } from '@/ui/page-header';
import { RelativeTime } from '@/ui/relative-time';
import { Skeleton } from '@/ui/skeleton';

const STATUS_TONE: Record<RunDto['status'], string> = {
  running: 'bg-accent text-accent-foreground',
  succeeded: 'bg-success/15 text-success',
  failed: 'bg-destructive/15 text-destructive',
  budget_exhausted: 'bg-warning/20 text-warning-foreground dark:text-warning',
};

export function runDuration(run: RunDto, now = new Date()): string {
  const end = run.endedAt ? new Date(run.endedAt) : now;
  return formatDuration(end.getTime() - new Date(run.startedAt).getTime());
}

export function RunsContainer() {
  const hideForRequester = useRedirectRequesterAway('/solicitudes');
  const runs = useRuns();
  const [selected, setSelected] = useState<RunDto | null>(null);

  if (hideForRequester) return null;

  return (
    <div>
      <PageHeader title={es.runs.title} description={es.runs.description} />
      {runs.isPending ? (
        <Skeleton className="h-64" />
      ) : runs.isError ? (
        <EmptyState title={es.runs.notAvailableTitle}>
          {runs.error instanceof Error ? runs.error.message : es.runs.couldNotLoad}
          <div className="mt-3">
            <Button variant="outline" onClick={() => void runs.refetch()}>
              {es.runs.retry}
            </Button>
          </div>
        </EmptyState>
      ) : runs.data.runs.length === 0 ? (
        <EmptyState title={es.runs.noneYetTitle}>{es.runs.noneYetBody}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{es.runs.table.ticket}</th>
                <th className="px-3 py-2 font-medium">{es.runs.table.kind}</th>
                <th className="px-3 py-2 font-medium">{es.runs.table.status}</th>
                <th className="px-3 py-2 font-medium">{es.runs.table.model}</th>
                <th className="px-3 py-2 text-right font-medium">{es.runs.table.tokensIn}</th>
                <th className="px-3 py-2 text-right font-medium">{es.runs.table.tokensOut}</th>
                <th className="px-3 py-2 text-right font-medium">{es.runs.table.cost}</th>
                <th className="px-3 py-2 text-right font-medium">{es.runs.table.duration}</th>
                <th className="px-3 py-2 font-medium">{es.runs.table.started}</th>
              </tr>
            </thead>
            <tbody>
              {runs.data.runs.map((run) => (
                <tr
                  key={run.id}
                  className="cursor-pointer border-t hover:bg-muted/40 focus-within:bg-muted/40"
                  onClick={() => setSelected(run)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelected(run);
                    }
                  }}
                  tabIndex={0}
                  aria-label={es.runs.rowAria(run.id, runKindLabels[run.kind], runStatusLabels[run.status])}
                >
                  <td className="px-3 py-2">
                    <Link to="/tickets/$id" params={{ id: run.ticketId }} className="font-mono text-xs text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                      {run.ticketId}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{runKindLabels[run.kind]}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={cn('border-transparent', STATUS_TONE[run.status])}>
                      {runStatusLabels[run.status]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{run.model}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatTokens(run.inputTokens)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatTokens(run.outputTokens)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCost(run.costUsd)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{runDuration(run)}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    <RelativeTime iso={run.startedAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>{es.runs.dialog.run(runKindLabels[selected.kind], runStatusLabels[selected.status])}</DialogTitle>
                <DialogDescription>
                  {es.runs.dialog.runOn} <span className="font-mono">{selected.id}</span> {es.runs.dialog.onTicket}{' '}
                  <Link to="/tickets/$id" params={{ id: selected.ticketId }} className="font-mono text-primary hover:underline">
                    {selected.ticketId}
                  </Link>
                </DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">{es.runs.dialog.model}</dt>
                <dd className="font-mono text-xs">{selected.model}</dd>
                <dt className="text-muted-foreground">{es.runs.dialog.tokens}</dt>
                <dd>{es.runs.dialog.tokensDetail(formatTokens(selected.inputTokens), formatTokens(selected.outputTokens), formatTokens(selected.budgetTokens))}</dd>
                <dt className="text-muted-foreground">{es.runs.dialog.cost}</dt>
                <dd>{formatCost(selected.costUsd)}</dd>
                <dt className="text-muted-foreground">{es.runs.dialog.duration}</dt>
                <dd>{runDuration(selected)}</dd>
                <dt className="text-muted-foreground">{es.runs.dialog.started}</dt>
                <dd>{formatAbsolute(selected.startedAt)}</dd>
                {selected.endedAt ? (
                  <>
                    <dt className="text-muted-foreground">{es.runs.dialog.ended}</dt>
                    <dd>{formatAbsolute(selected.endedAt)}</dd>
                  </>
                ) : null}
                {selected.failureReason ? (
                  <>
                    <dt className="text-muted-foreground">{es.runs.dialog.failure}</dt>
                    <dd className="text-destructive">{runFailureReasonLabels[selected.failureReason]}</dd>
                  </>
                ) : null}
              </dl>
              {selected.errorMessage ? <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{selected.errorMessage}</pre> : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
