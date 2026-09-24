import type { TicketSource } from '@ai-delivery-hub/domain';
import { Badge } from './badge';

/** OP / Manual — where the ticket came from (OpenProject work package vs. an Obsidian inbox note). */
export function SourceBadge({ source, className }: { source: TicketSource; className?: string }) {
  const label = source.kind === 'openproject' ? 'OP' : 'Manual';
  return (
    <Badge variant="outline" className={className} aria-label={source.kind === 'openproject' ? 'Source: OpenProject' : 'Source: Manual'} data-source={source.kind}>
      {label}
    </Badge>
  );
}
