import type { TicketSnapshot } from '@ai-delivery-hub/domain';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTicketList } from '@/app/queries';
import { es } from '@/i18n/es';
import { sortTickets } from '@/lib/inbox';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { PageHeader } from '@/ui/page-header';
import { RiskBadge } from '@/ui/risk-badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { SourceBadge } from '@/ui/source-badge';
import { Skeleton } from '@/ui/skeleton';
import { applyFilters, buildColumns, type BoardFilters } from './board-columns';

const ALL = '__all__';

function FilterSelect({ label, allLabel, value, options, onChange }: { label: string; allLabel: string; value: string | undefined; options: readonly string[]; onChange: (v: string | undefined) => void }) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger className="w-40" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function BoardContainer() {
  const navigate = useNavigate();
  const list = useTicketList();
  const [filters, setFilters] = useState<BoardFilters>({});
  const tickets = list.data?.tickets ?? [];
  const options = useMemo(
    () => ({
      repo: Array.from(new Set(tickets.map((t) => t.targetRepo).filter((x): x is string => !!x))).sort(),
      owner: Array.from(new Set(tickets.map((t) => t.ownerUserId).filter((x): x is string => !!x))).sort(),
      risk: ['low', 'medium', 'high'],
    }),
    [tickets],
  );
  const columns = useMemo(() => buildColumns(applyFilters(tickets, filters)), [tickets, filters]);
  const open = (t: TicketSnapshot) => void navigate({ to: '/tickets/$id', params: { id: t.id } });

  return (
    <div>
      <PageHeader
        title={es.board.title}
        description={es.board.description}
        actions={
          <>
            <FilterSelect label={es.board.repositoryLabel} allLabel={es.board.allRepositories} value={filters.repo} options={options.repo} onChange={(repo) => setFilters((f) => ({ ...f, repo }))} />
            <FilterSelect label={es.board.ownerLabel} allLabel={es.board.allOwners} value={filters.owner} options={options.owner} onChange={(owner) => setFilters((f) => ({ ...f, owner }))} />
            <FilterSelect label={es.board.riskLabel} allLabel={es.board.allRisks} value={filters.risk} options={options.risk} onChange={(risk) => setFilters((f) => ({ ...f, risk }))} />
          </>
        }
      />
      {list.isPending ? (
        <div className="grid grid-flow-col auto-cols-[16rem] gap-3 overflow-x-auto" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : list.isError ? (
        <EmptyState title={es.board.notAvailableTitle}>
          {list.error instanceof Error ? list.error.message : es.board.couldNotLoad}
          <div className="mt-3">
            <Button variant="outline" onClick={() => void list.refetch()}>
              {es.board.retry}
            </Button>
          </div>
        </EmptyState>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-4">
          <div className="grid grid-flow-col auto-cols-[minmax(15rem,17rem)] gap-3">
            {columns.map((col) => (
              <section key={col.id} className={cn('flex min-h-40 flex-col gap-2 rounded-xl bg-muted/50 p-2', col.id === 'closed' && 'opacity-80')} aria-label={es.board.columnAria(col.title)}>
                <h2 className="flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span>{col.title}</span>
                  <span>{col.tickets.length}</span>
                </h2>
                {sortTickets(col.tickets).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => open(t)}
                    className="flex flex-col gap-1 rounded-lg border bg-card p-3 text-left text-sm transition-colors hover:border-primary/40"
                    aria-label={es.board.openTicketAria(t.displayKey, t.subject)}
                  >
                    <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                      <SourceBadge source={t.source} />
                      {t.displayKey}
                    </span>
                    <span className="line-clamp-2 font-medium">{t.subject}</span>
                    <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      <RiskBadge tier={t.riskTier} />
                      {t.targetRepo ? <span>{t.targetRepo}</span> : null}
                      {t.ownerUserId ? <span>· {t.ownerUserId}</span> : null}
                    </span>
                  </button>
                ))}
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
