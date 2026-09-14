import type { RiskTier } from '@ai-delivery-hub/domain';
import { ShieldAlert } from 'lucide-react';

/** Persistent banner for high-risk tickets; explains the second approver rule. */
export function RiskBanner({ tier }: { tier: RiskTier | undefined }) {
  if (tier !== 'high') return null;
  return (
    <div role="note" className="flex items-start gap-3 rounded-lg border border-risk-high/40 bg-risk-high/10 px-4 py-3 text-sm" data-testid="risk-banner">
      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-risk-high" aria-hidden="true" />
      <div>
        <p className="font-medium text-risk-high">High risk ticket</p>
        <p className="text-foreground/80">
          Payments, auth or PII are involved. Approving the plan requires a second approver (another dev, lead or admin) named in the approval.
        </p>
      </div>
    </div>
  );
}
