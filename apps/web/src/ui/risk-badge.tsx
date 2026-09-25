import type { RiskTier } from '@ai-delivery-hub/domain';
import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { es } from '@/i18n/es';
import { riskTierLabels } from '@/i18n/labels';
import { cn } from '@/lib/utils';
import { Badge } from '@/ui/badge';

const STYLE: Record<RiskTier, string> = {
  low: 'bg-risk-low/15 text-risk-low border-risk-low/30',
  medium: 'bg-risk-medium/20 text-risk-medium border-risk-medium/40',
  high: 'bg-risk-high/15 text-risk-high border-risk-high/40',
};

const ICON: Record<RiskTier, typeof ShieldAlert> = { low: ShieldCheck, medium: ShieldQuestion, high: ShieldAlert };

/** Risk is always visible: unknown tiers render as "risk pending" instead of disappearing. */
export function RiskBadge({ tier, className }: { tier: RiskTier | undefined; className?: string }) {
  if (!tier) {
    return (
      <Badge variant="outline" className={cn('text-muted-foreground', className)} aria-label={es.risk.pendingAria}>
        {es.risk.pending}
      </Badge>
    );
  }
  const Icon = ICON[tier];
  const label = riskTierLabels[tier];
  return (
    <Badge variant="outline" className={cn('gap-1 font-medium', STYLE[tier], className)} aria-label={es.risk.riskSuffix(label)} data-risk={tier}>
      <Icon className="size-3" aria-hidden="true" />
      {es.risk.riskSuffix(label)}
    </Badge>
  );
}
