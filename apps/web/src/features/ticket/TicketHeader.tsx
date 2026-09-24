import type { TicketSnapshot } from '@ai-delivery-hub/domain';
import { ExternalLink, GitBranch, User } from 'lucide-react';
import type { ReactNode } from 'react';
import { workPackageUrl } from '@/app/config';
import { FlagChips } from '@/ui/flag-chips';
import { RelativeTime } from '@/ui/relative-time';
import { RiskBadge } from '@/ui/risk-badge';
import { SourceBadge } from '@/ui/source-badge';
import { StateChip } from '@/ui/state-chip';

export function TicketHeader({ ticket, actions }: { ticket: TicketSnapshot; actions?: ReactNode }) {
  const opUrl = ticket.source.kind === 'openproject' ? workPackageUrl(ticket.source.workPackageId) : undefined;
  return (
    <header className="flex flex-col gap-3 pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <SourceBadge source={ticket.source} />
            {opUrl ? (
              <a href={opUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono hover:text-foreground hover:underline" aria-label={`Open work package ${ticket.displayKey} in OpenProject`}>
                {ticket.displayKey}
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            ) : (
              <span className="font-mono">{ticket.displayKey}</span>
            )}
            <span aria-hidden="true">·</span>
            <span className="capitalize">{ticket.priority} priority</span>
            <span aria-hidden="true">·</span>
            <RelativeTime iso={ticket.updatedAt} prefix="in state" />
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{ticket.subject}</h1>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StateChip state={ticket.state} />
        <RiskBadge tier={ticket.riskTier} />
        {ticket.targetRepo ? (
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            <GitBranch className="size-3.5" aria-hidden="true" />
            {ticket.targetRepo}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
          <User className="size-3.5" aria-hidden="true" />
          {ticket.ownerUserId ?? 'no owner yet'}
        </span>
        {ticket.category ? <span className="text-sm capitalize text-muted-foreground">{ticket.category}</span> : null}
        <FlagChips flags={ticket.flags} />
      </div>
    </header>
  );
}
