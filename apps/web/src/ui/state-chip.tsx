import { isTerminal, type TicketState } from '@ai-delivery-hub/domain';
import { ticketStateLabels } from '@/i18n/labels';
import { cn } from '@/lib/utils';
import { Badge } from '@/ui/badge';

const TONE: Partial<Record<TicketState, string>> = {
  triaging: 'bg-accent text-accent-foreground',
  planning: 'bg-accent text-accent-foreground',
  awaiting_owner: 'bg-warning/20 text-warning-foreground dark:text-warning',
  triaged: 'bg-warning/20 text-warning-foreground dark:text-warning',
  plan_review: 'bg-primary/15 text-primary',
  plan_changes_requested: 'bg-warning/20 text-warning-foreground dark:text-warning',
  plan_approved: 'bg-success/15 text-success',
};

export function StateChip({ state, className }: { state: TicketState; className?: string }) {
  const tone = TONE[state] ?? (isTerminal(state) ? 'bg-muted text-muted-foreground' : 'bg-secondary text-secondary-foreground');
  return (
    <Badge variant="outline" className={cn('border-transparent font-medium', tone, className)} data-state={state}>
      {ticketStateLabels[state]}
    </Badge>
  );
}
