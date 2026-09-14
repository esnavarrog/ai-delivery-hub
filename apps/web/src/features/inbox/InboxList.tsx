import type { TicketSnapshot } from '@ai-delivery-hub/domain';
import { Inbox } from 'lucide-react';
import { EmptyState } from '@/ui/empty-state';
import { TicketCard } from './TicketCard';

export function InboxList({ tickets, selectedIndex, onOpen, emptyTitle }: { tickets: readonly TicketSnapshot[]; selectedIndex: number; onOpen: (ticket: TicketSnapshot) => void; emptyTitle: string }) {
  if (tickets.length === 0) {
    return (
      <EmptyState icon={<Inbox className="size-8" aria-hidden="true" />} title={emptyTitle}>
        <p>
          A ticket enters the hub when its OpenProject status becomes <span className="font-medium">Ready for AI</span> or its subject starts with{' '}
          <span className="font-mono">[AI]</span>. The AI triages it and it shows up here as soon as a decision is yours.
        </p>
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-2" role="list" aria-label="Tickets">
      {tickets.map((t, i) => (
        <div key={t.id} role="listitem">
          <TicketCard ticket={t} selected={i === selectedIndex} onOpen={onOpen} />
        </div>
      ))}
    </div>
  );
}
