import type { TicketSnapshot } from '@ai-delivery-hub/domain';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useMe, useTicketList } from '@/app/queries';
import { es } from '@/i18n/es';
import { departmentLabels, ticketStateLabels } from '@/i18n/labels';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { PageHeader } from '@/ui/page-header';
import { Skeleton } from '@/ui/skeleton';

const OWN_REQUEST_ROLES = new Set(['lead', 'admin']);

/** `/solicitudes`: the manual feature requests the current user filed, newest first. */
export function MyRequestsContainer() {
  const navigate = useNavigate();
  const me = useMe();
  const list = useTicketList();

  const mine = useMemo(() => {
    const tickets = list.data?.tickets ?? [];
    const login = me.data?.login;
    if (!login) return [];
    // The server already scopes `requester` to their own tickets; lead/admin see everything and
    // must filter client-side to keep this page's meaning ("mine").
    const needsClientFilter = me.data?.role !== undefined && OWN_REQUEST_ROLES.has(me.data.role);
    const own = needsClientFilter ? tickets.filter((t) => t.requesterUserId === login) : tickets.filter((t) => t.requesterUserId !== undefined);
    return [...own].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [list.data, me.data]);

  const open = (t: TicketSnapshot) => void navigate({ to: '/tickets/$id', params: { id: t.id } });

  if (list.isError) {
    return (
      <EmptyState title={es.myRequests.notAvailableTitle}>
        {list.error instanceof Error ? list.error.message : es.myRequests.couldNotLoad}
        <div className="mt-3">
          <Button variant="outline" onClick={() => void list.refetch()}>
            {es.myRequests.retry}
          </Button>
        </div>
      </EmptyState>
    );
  }

  return (
    <div>
      <PageHeader
        title={es.myRequests.title}
        description={es.myRequests.description}
        actions={
          <Button asChild>
            <Link to="/solicitudes/nueva">{es.myRequests.newRequestButton}</Link>
          </Button>
        }
      />
      {list.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : mine.length === 0 ? (
        <EmptyState title={es.myRequests.emptyTitle}>{es.myRequests.emptyBody}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={es.myRequests.listAria}>
          {mine.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => open(t)}
                className="flex w-full flex-col gap-1 rounded-lg border bg-card p-3 text-left text-sm transition-colors hover:border-primary/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{t.displayKey}</span>
                  <span className="text-xs text-muted-foreground">{t.createdAt.slice(0, 10)}</span>
                </div>
                <span className="font-medium">{t.subject}</span>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{ticketStateLabels[t.state]}</Badge>
                  {t.department ? <span>{departmentLabels[t.department]}</span> : null}
                  {t.state === 'awaiting_requester' ? (
                    <Badge variant="default">{es.myRequests.needsAnswerBadge(t.pendingQuestionCount ?? 0)}</Badge>
                  ) : null}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
