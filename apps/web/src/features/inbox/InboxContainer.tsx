import type { TicketSnapshot } from '@ai-delivery-hub/domain';
import { useNavigate } from '@tanstack/react-router';
import { RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useIngestFetch, useTicketList } from '@/app/queries';
import { es } from '@/i18n/es';
import { groupInbox } from '@/lib/inbox';
import { cn } from '@/lib/utils';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { PageHeader } from '@/ui/page-header';
import { Skeleton } from '@/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs';
import { InboxList } from './InboxList';

type Tab = 'waiting' | 'watching';

export function InboxContainer() {
  const navigate = useNavigate();
  const all = useTicketList();
  const waiting = useTicketList({ waitingOn: 'me' });
  const ingestFetch = useIngestFetch();
  const [tab, setTab] = useState<Tab>('waiting');
  const [selected, setSelected] = useState(0);

  const groups = useMemo(() => groupInbox(all.data?.tickets ?? [], waiting.data?.tickets ?? []), [all.data, waiting.data]);
  const visible = tab === 'waiting' ? groups.waitingOnYou : groups.watching;

  const open = (t: TicketSnapshot) => void navigate({ to: '/tickets/$id', params: { id: t.id } });

  useEffect(() => setSelected(0), [tab]);

  // j/k move, Enter opens.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.key === 'j') setSelected((i) => Math.min(visible.length - 1, i + 1));
      else if (e.key === 'k') setSelected((i) => Math.max(0, i - 1));
      else if (e.key === 'Enter') {
        const t = visible[selected];
        if (t) open(t);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  if (all.isError || waiting.isError) {
    const err = all.error ?? waiting.error;
    return (
      <EmptyState title={es.inbox.notAvailableTitle}>
        {err instanceof Error ? err.message : es.inbox.couldNotLoad}
        <div className="mt-3">
          <Button variant="outline" onClick={() => void Promise.all([all.refetch(), waiting.refetch()])}>
            {es.inbox.retry}
          </Button>
        </div>
      </EmptyState>
    );
  }

  return (
    <div>
      <PageHeader
        title={es.inbox.title}
        description={es.inbox.description}
        actions={
          <Button variant="outline" onClick={() => ingestFetch.mutate()} disabled={ingestFetch.isPending} aria-label={es.inbox.fetchButtonAria}>
            <RefreshCw className={cn('size-4', ingestFetch.isPending && 'animate-spin')} aria-hidden="true" />
            {ingestFetch.isPending ? es.inbox.fetching : es.inbox.fetchButton}
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList aria-label={es.inbox.tabsAriaLabel}>
          <TabsTrigger value="waiting">
            {es.inbox.waitingTab}
            <Badge variant={groups.waitingOnYou.length > 0 ? 'default' : 'secondary'} className="ml-1 min-w-5 justify-center px-1.5" aria-label={es.inbox.waitingBadgeAria(groups.waitingOnYou.length)}>
              {waiting.isPending ? '…' : groups.waitingOnYou.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="watching">
            {es.inbox.watchingTab}
            <span className="ml-1 text-muted-foreground">{all.isPending ? '' : groups.watching.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="waiting" className="mt-4">
          {waiting.isPending ? <ListSkeleton /> : <InboxList tickets={groups.waitingOnYou} selectedIndex={selected} onOpen={open} emptyTitle={es.inbox.nothingWaiting} />}
        </TabsContent>
        <TabsContent value="watching" className="mt-4">
          {all.isPending ? <ListSkeleton /> : <InboxList tickets={groups.watching} selectedIndex={selected} onOpen={open} emptyTitle={es.inbox.nothingWatching} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </div>
  );
}
