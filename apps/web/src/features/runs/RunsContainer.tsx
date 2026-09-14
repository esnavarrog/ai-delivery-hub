import type { RunDto } from '@ai-delivery-hub/contracts';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useRuns } from '@/app/queries';
import { formatCost, formatDuration, formatTokens, humanize } from '@/lib/format';
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
  const runs = useRuns();
  const [selected, setSelected] = useState<RunDto | null>(null);

  return (
    <div>
      <PageHeader title="Runs" description="Every AI run with its budget, cost and outcome. Select a row for details." />
      {runs.isPending ? (
        <Skeleton className="h-64" />
      ) : runs.isError ? (
        <EmptyState title="Runs not available">
          {runs.error instanceof Error ? runs.error.message : 'Could not load runs.'}
          <div className="mt-3">
            <Button variant="outline" onClick={() => void runs.refetch()}>
              Retry
            </Button>
          </div>
        </EmptyState>
      ) : runs.data.runs.length === 0 ? (
        <EmptyState title="No runs yet">Runs appear as soon as the AI triages or plans a ticket.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Ticket</th>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 text-right font-medium">Tokens in</th>
                <th className="px-3 py-2 text-right font-medium">Tokens out</th>
                <th className="px-3 py-2 text-right font-medium">Cost</th>
                <th className="px-3 py-2 text-right font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Started</th>
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
                  aria-label={`Run ${run.id}, ${run.kind}, ${humanize(run.status)}`}
                >
                  <td className="px-3 py-2">
                    <Link to="/tickets/$id" params={{ id: run.ticketId }} className="font-mono text-xs text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                      {run.ticketId}
                    </Link>
                  </td>
                  <td className="px-3 py-2 capitalize">{run.kind}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={cn('border-transparent', STATUS_TONE[run.status])}>
                      {humanize(run.status)}
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
                <DialogTitle className="capitalize">
                  {selected.kind} run · {humanize(selected.status)}
                </DialogTitle>
                <DialogDescription>
                  Run <span className="font-mono">{selected.id}</span> on ticket{' '}
                  <Link to="/tickets/$id" params={{ id: selected.ticketId }} className="font-mono text-primary hover:underline">
                    {selected.ticketId}
                  </Link>
                </DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Model</dt>
                <dd className="font-mono text-xs">{selected.model}</dd>
                <dt className="text-muted-foreground">Tokens</dt>
                <dd>
                  {formatTokens(selected.inputTokens)} in · {formatTokens(selected.outputTokens)} out · budget {formatTokens(selected.budgetTokens)}
                </dd>
                <dt className="text-muted-foreground">Cost</dt>
                <dd>{formatCost(selected.costUsd)}</dd>
                <dt className="text-muted-foreground">Duration</dt>
                <dd>{runDuration(selected)}</dd>
                <dt className="text-muted-foreground">Started</dt>
                <dd>{new Date(selected.startedAt).toLocaleString()}</dd>
                {selected.endedAt ? (
                  <>
                    <dt className="text-muted-foreground">Ended</dt>
                    <dd>{new Date(selected.endedAt).toLocaleString()}</dd>
                  </>
                ) : null}
                {selected.failureReason ? (
                  <>
                    <dt className="text-muted-foreground">Failure</dt>
                    <dd className="text-destructive">{humanize(selected.failureReason, true)}</dd>
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
