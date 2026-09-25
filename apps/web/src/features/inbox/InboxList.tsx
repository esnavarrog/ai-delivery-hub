import type { TicketSnapshot } from '@ai-delivery-hub/domain';
import { Inbox } from 'lucide-react';
import { es } from '@/i18n/es';
import { EmptyState } from '@/ui/empty-state';
import { TicketCard } from './TicketCard';

export function InboxList({ tickets, selectedIndex, onOpen, emptyTitle }: { tickets: readonly TicketSnapshot[]; selectedIndex: number; onOpen: (ticket: TicketSnapshot) => void; emptyTitle: string }) {
  if (tickets.length === 0) {
    return (
      <EmptyState icon={<Inbox className="size-8" aria-hidden="true" />} title={emptyTitle}>
        <p>
          Un ticket entra al hub cuando su estado en OpenProject pasa a <span className="font-medium">Ready for AI</span> o su asunto empieza con{' '}
          <span className="font-mono">[AI]</span> en un repositorio configurado en repos.yaml, o cuando llega como nota nueva en la bandeja de entrada de{' '}
          <span className="font-medium">Obsidian</span>. La IA lo analiza (triaje) y aparece aquí en cuanto una decisión te corresponde a ti. Presiona{' '}
          <span className="font-medium">&ldquo;Traer tickets&rdquo;</span> para traer los tickets de OpenProject e importar la bandeja de Obsidian manualmente.
        </p>
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-2" role="list" aria-label={es.inbox.ticketsListAria}>
      {tickets.map((t, i) => (
        <div key={t.id} role="listitem">
          <TicketCard ticket={t} selected={i === selectedIndex} onOpen={onOpen} />
        </div>
      ))}
    </div>
  );
}
