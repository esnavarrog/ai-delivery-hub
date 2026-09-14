import type { TicketFlag } from '@ai-delivery-hub/domain';
import { humanize } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/ui/badge';

const TONE: Record<TicketFlag, string> = {
  blocked: 'border-destructive/40 text-destructive',
  needs_info: 'border-warning/50 text-warning-foreground dark:text-warning',
  paused: 'border-muted-foreground/40 text-muted-foreground',
  stale_plan: 'border-warning/50 text-warning-foreground dark:text-warning',
};

export function FlagChips({ flags, className }: { flags: readonly TicketFlag[]; className?: string }) {
  if (flags.length === 0) return null;
  return (
    <ul className={cn('flex flex-wrap gap-1', className)} aria-label="Flags">
      {flags.map((flag) => (
        <li key={flag}>
          <Badge variant="outline" className={cn('capitalize', TONE[flag])} data-flag={flag}>
            {humanize(flag)}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
