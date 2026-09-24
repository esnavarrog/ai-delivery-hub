import type { TicketSource } from '@ai-delivery-hub/domain';
import { es } from '@/i18n/es';
import { Badge } from './badge';

/** OP / Manual — where the ticket came from (OpenProject work package vs. an Obsidian inbox note). */
export function SourceBadge({ source, className }: { source: TicketSource; className?: string }) {
  const label = source.kind === 'openproject' ? es.source.op : es.source.manual;
  return (
    <Badge variant="outline" className={className} aria-label={es.source.ariaLabel(source.kind)} data-source={source.kind}>
      {label}
    </Badge>
  );
}
