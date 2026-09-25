import type { TicketSnapshot } from '@ai-delivery-hub/domain';
import { GitBranch } from 'lucide-react';
import { es } from '@/i18n/es';
import { ticketPriorityLabels } from '@/i18n/labels';
import { cn } from '@/lib/utils';
import { ActorAvatar } from '@/ui/actor-avatar';
import { Badge } from '@/ui/badge';
import { FlagChips } from '@/ui/flag-chips';
import { RelativeTime } from '@/ui/relative-time';
import { RiskBadge } from '@/ui/risk-badge';
import { SourceBadge } from '@/ui/source-badge';
import { StateChip } from '@/ui/state-chip';

export function TicketCard({ ticket, selected, onOpen }: { ticket: TicketSnapshot; selected: boolean; onOpen: (ticket: TicketSnapshot) => void }) {
  return (
    <article
      className={cn(
        'group flex cursor-pointer flex-col gap-2 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 focus-within:border-primary',
        selected && 'border-primary ring-2 ring-primary/20',
      )}
      data-selected={selected}
      data-priority={ticket.priority}
      onClick={() => onOpen(ticket)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <SourceBadge source={ticket.source} />
            <span className="font-mono">{ticket.displayKey}</span>
            {ticket.priority !== 'normal' ? <span>{ticketPriorityLabels[ticket.priority]}</span> : null}
          </div>
          <h3 className="truncate font-medium">
            <button type="button" className="text-left focus-visible:outline-none" onClick={(e) => { e.stopPropagation(); onOpen(ticket); }} aria-label={es.board.openTicketAria(ticket.displayKey, ticket.subject)}>
              {ticket.subject}
            </button>
          </h3>
        </div>
        <ActorAvatar kind="dev" id={ticket.ownerUserId ?? undefined} className={cn(!ticket.ownerUserId && 'opacity-40')} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <StateChip state={ticket.state} />
        <RiskBadge tier={ticket.riskTier} />
        {ticket.riceScore !== undefined ? (
          <Badge variant="outline" aria-label={es.rice.badgeAria(ticket.riceScore)}>
            {es.rice.badge(ticket.riceScore)}
          </Badge>
        ) : null}
        {ticket.targetRepo ? (
          <span className="inline-flex items-center gap-1">
            <GitBranch className="size-3" aria-hidden="true" />
            {ticket.targetRepo}
          </span>
        ) : null}
        <RelativeTime iso={ticket.updatedAt} className="ml-auto" />
      </div>
      <FlagChips flags={ticket.flags} />
    </article>
  );
}
