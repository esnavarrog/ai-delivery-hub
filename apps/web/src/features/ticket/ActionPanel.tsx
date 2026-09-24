import type { TicketDetailResponse } from '@ai-delivery-hub/contracts';
import type { Role } from '@ai-delivery-hub/domain';
import { AlertTriangle, Bot, CheckCircle2, Clock, Eye, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { es } from '@/i18n/es';
import type { ActionPlan, InfoKind, ResolvedAction } from '@/lib/action-resolver';
import { formatTokens } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card';
import { Separator } from '@/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';
import { latestTriage, TriageSuggestionCard } from './TriageSuggestionCard';

export interface ActionPanelProps {
  detail: TicketDetailResponse;
  actions: ActionPlan;
  role: Role;
  login: string;
  busy: boolean;
  now: Date;
  onAction: (action: ResolvedAction) => void;
}

const ICON: Record<InfoKind, typeof Bot> = {
  waiting: Clock,
  ai_working: Bot,
  paused: Lock,
  failed: AlertTriangle,
  triage_suggestion: Eye,
  plan_review: Eye,
  approved: CheckCircle2,
  closed: Lock,
  read_only: Eye,
  later_phase: Clock,
};

function ActionButton({ action, variant, size, busy, onAction, className }: { action: ResolvedAction; variant: 'default' | 'outline' | 'ghost' | 'destructive'; size?: 'sm' | 'default'; busy: boolean; onAction: (a: ResolvedAction) => void; className?: string }) {
  const button = (
    <Button
      variant={action.destructive && variant === 'default' ? 'destructive' : variant}
      size={size ?? 'default'}
      className={cn(action.destructive && variant !== 'default' && 'text-destructive hover:text-destructive', className)}
      disabled={busy || action.disabledReason !== undefined}
      aria-disabled={action.disabledReason !== undefined}
      onClick={() => onAction(action)}
    >
      {action.label}
    </Button>
  );
  if (!action.disabledReason) return button;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex w-full" aria-label={action.disabledReason}>
            {button}
          </span>
        </TooltipTrigger>
        <TooltipContent>{action.disabledReason}</TooltipContent>
      </Tooltip>
      <p className="text-xs text-muted-foreground" role="note">
        {action.disabledReason}
      </p>
    </div>
  );
}

/**
 * The one decision card for the current state and role. Pure presentation: the container resolves
 * `actions` and handles dialogs and mutations behind `onAction`.
 */
export function ActionPanel({ detail, actions, busy, onAction }: ActionPanelProps) {
  const { info, primary, secondary, more, tertiary } = actions;
  const Icon = ICON[info.kind];
  const run = detail.latestRun;

  let body: ReactNode = <p className="text-sm text-muted-foreground">{info.message}</p>;
  if (info.kind === 'triage_suggestion') {
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{info.message}</p>
        <TriageSuggestionCard ticket={detail.ticket} triage={latestTriage(detail.events)} />
      </div>
    );
  } else if (info.kind === 'ai_working' && run) {
    const used = run.inputTokens + run.outputTokens;
    const pct = Math.min(100, Math.round((used / run.budgetTokens) * 100));
    body = (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{info.message}</p>
        <div className="text-xs text-muted-foreground">
          {run.model} · {formatTokens(used)} of {formatTokens(run.budgetTokens)} tokens ({pct}%)
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={es.actionPanel.tokenBudgetAria}>
          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  } else if (info.kind === 'ai_working') {
    body = <p className="text-sm font-medium">{info.message}</p>;
  } else if (info.kind === 'approved' && detail.latestPlan) {
    body = (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-muted-foreground">{info.message}</p>
        <p>{es.actionPanel.approvedPlan(detail.latestPlan.version, detail.latestPlan.goal)}</p>
      </div>
    );
  }

  return (
    <Card data-testid="action-panel" data-info-kind={info.kind} className={cn(info.kind === 'failed' && 'border-destructive/50')}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className={cn('size-4', info.kind === 'failed' ? 'text-destructive' : 'text-muted-foreground')} aria-hidden="true" />
          {info.title}
        </CardTitle>
        {info.kind === 'plan_review' && detail.latestPlan ? <CardDescription>{es.actionPanel.planLabel(detail.latestPlan.version, detail.latestPlan.goal)}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {body}
        {primary || secondary || more.length > 0 ? (
          <div className="flex flex-col gap-2">
            {primary ? <ActionButton action={primary} variant="default" busy={busy} onAction={onAction} className="w-full" /> : null}
            {secondary ? <ActionButton action={secondary} variant="outline" busy={busy} onAction={onAction} className="w-full" /> : null}
            {more.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {more.map((a) => (
                  <ActionButton key={a.id} action={a} variant="ghost" size="sm" busy={busy} onAction={onAction} />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {tertiary.length > 0 ? (
          <>
            <Separator />
            <div className="flex flex-wrap gap-2">
              {tertiary.map((a) => (
                <ActionButton key={a.id} action={a} variant="ghost" size="sm" busy={busy} onAction={onAction} className="text-muted-foreground" />
              ))}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
