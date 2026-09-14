import type { TicketSnapshot } from '@ai-delivery-hub/domain';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useTicketList } from '@/app/queries';
import { groupInbox } from '@/lib/inbox';
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
      <EmptyState title="Inbox not available">
        {err instanceof Error ? err.message : 'Could not load tickets.'}
        <div className="mt-3">
          <Button variant="outline" onClick={() => void Promise.all([all.refetch(), waiting.refetch()])}>
            Retry
          </Button>
        </div>
      </EmptyState>
    );
  }

  return (
    <div>
      <PageHeader title="Inbox" description="Decisions that need you first, then everything you follow. Use j / k to move and Enter to open." />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList aria-label="Inbox tabs">
          <TabsTrigger value="waiting">
            Waiting on you
            <Badge variant={groups.waitingOnYou.length > 0 ? 'default' : 'secondary'} className="ml-1 min-w-5 justify-center px-1.5" aria-label={`${groups.waitingOnYou.length} waiting on you`}>
              {waiting.isPending ? '…' : groups.waitingOnYou.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="watching">
            Watching
            <span className="ml-1 text-muted-foreground">{all.isPending ? '' : groups.watching.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="waiting" className="mt-4">
          {waiting.isPending ? <ListSkeleton /> : <InboxList tickets={groups.waitingOnYou} selectedIndex={selected} onOpen={open} emptyTitle="Nothing waiting on you" />}
        </TabsContent>
        <TabsContent value="watching" className="mt-4">
          {all.isPending ? <ListSkeleton /> : <InboxList tickets={groups.watching} selectedIndex={selected} onOpen={open} emptyTitle="Nothing else in flight" />}
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
