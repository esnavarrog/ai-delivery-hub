import type { TicketEvent, TicketSnapshot, TriageResult } from '@ai-delivery-hub/domain';
import { es } from '@/i18n/es';
import { ticketCategoryLabels } from '@/i18n/labels';
import { humanize } from '@/lib/format';
import { RiskBadge } from '@/ui/risk-badge';

/** Latest `triage_completed` payload, if any, so the card can show duplicates and signals. */
export function latestTriage(events: readonly TicketEvent[]): TriageResult | undefined {
  const found = [...events].reverse().find((e) => e.type === 'triage_completed');
  return found && found.type === 'triage_completed' ? found.payload : undefined;
}

export function TriageSuggestionCard({ ticket, triage }: { ticket: TicketSnapshot; triage: TriageResult | undefined }) {
  const category = ticket.category ?? triage?.category;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm" aria-label={es.triageSuggestion.ariaLabel}>
      <dt className="text-muted-foreground">{es.triageSuggestion.category}</dt>
      <dd>{category ? ticketCategoryLabels[category] : es.triageSuggestion.unknown}</dd>
      <dt className="text-muted-foreground">{es.triageSuggestion.risk}</dt>
      <dd>
        <RiskBadge tier={ticket.riskTier ?? triage?.riskTier} />
      </dd>
      <dt className="text-muted-foreground">{es.triageSuggestion.repository}</dt>
      <dd className="font-mono text-xs sm:text-sm">{ticket.targetRepo ?? triage?.targetRepo ?? es.triageSuggestion.unknown}</dd>
      {triage?.summary ? (
        <>
          <dt className="text-muted-foreground">{es.triageSuggestion.summary}</dt>
          <dd>{triage.summary}</dd>
        </>
      ) : null}
      {triage && triage.duplicateCandidates.length > 0 ? (
        <>
          <dt className="text-muted-foreground">{es.triageSuggestion.possibleDuplicates}</dt>
          <dd>
            <ul className="flex flex-col gap-1">
              {triage.duplicateCandidates.map((d) => (
                <li key={d.ticketId}>
                  <span className="font-medium">{d.displayKey}</span> <span className="text-muted-foreground">({Math.round(d.similarity * 100)}%)</span> {d.reason}
                </li>
              ))}
            </ul>
          </dd>
        </>
      ) : null}
      {triage?.alreadyImplementedHint ? (
        <>
          <dt className="text-muted-foreground">{es.triageSuggestion.alreadyImplemented}</dt>
          <dd>
            {triage.alreadyImplementedHint.explanation}
            {triage.alreadyImplementedHint.evidencePaths.length > 0 ? (
              <ul className="mt-1 font-mono text-xs">
                {triage.alreadyImplementedHint.evidencePaths.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : null}
          </dd>
        </>
      ) : null}
      {triage && triage.riskSignals.length > 0 ? (
        <>
          <dt className="text-muted-foreground">{es.triageSuggestion.riskSignals}</dt>
          <dd>{triage.riskSignals.map((s) => humanize(s)).join(', ')}</dd>
        </>
      ) : null}
    </dl>
  );
}
