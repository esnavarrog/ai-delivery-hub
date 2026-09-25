import { riceScore, type TicketEvent, type TicketSnapshot } from '@ai-delivery-hub/domain';
import { es } from '@/i18n/es';
import { confidenceLabel, effortLabels, feasibilityLabels, recommendationLabels } from '@/i18n/labels';
import { effectiveScores, isTriageConfirmed, latestAssessment } from '@/lib/assessment';
import { Badge } from '@/ui/badge';

/**
 * The AI's three-lens triage assessment (functional / technical / management) plus a prominent RICE
 * score, for lead/admin/dev on the ticket page. Renders nothing when the ticket has no assessment yet
 * (e.g. an OpenProject ticket triaged before this feature existed).
 */
export function AssessmentCard({ ticket, events }: { ticket: TicketSnapshot; events: readonly TicketEvent[] }) {
  const found = latestAssessment(ticket, events);
  if (!found) return null;
  const { assessment, provisional } = found;
  const scores = effectiveScores(ticket, assessment);
  const rice = scores ? riceScore(scores) : undefined;
  const confirmed = isTriageConfirmed(events);

  return (
    <section aria-label={es.assessmentCard.ariaLabel} className="flex flex-col gap-4 rounded-xl border bg-card p-4 text-sm">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{es.assessmentCard.heading}</h2>
        <Badge variant={confirmed ? 'default' : 'secondary'}>{confirmed ? es.assessmentCard.humanConfirmed : es.assessmentCard.aiSuggested}</Badge>
      </header>

      {provisional ? <p className="text-xs text-muted-foreground">{es.assessmentCard.provisionalNote}</p> : null}

      {rice !== undefined ? (
        <div className="flex items-center gap-3 rounded-lg bg-muted p-3" title={es.assessmentCard.riceFormula}>
          <span className="text-2xl font-bold tabular-nums">{rice}</span>
          <div className="flex flex-col">
            <span className="font-medium">{es.assessmentCard.riceHeading}</span>
            <span className="text-xs text-muted-foreground">{es.assessmentCard.riceFormula}</span>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <section aria-label={es.assessmentCard.functionalHeading} className="flex flex-col gap-1">
          <h3 className="font-medium">{es.assessmentCard.functionalHeading}</h3>
          <dl className="flex flex-col gap-1">
            <dt className="text-muted-foreground">{es.assessmentCard.clarityLabel}</dt>
            <dd>{assessment.functional.clarity}</dd>
            <dt className="text-muted-foreground">{es.assessmentCard.acceptanceCriteriaLabel}</dt>
            <dd>
              {assessment.functional.acceptanceCriteria.length > 0 ? (
                <ul className="list-disc pl-4">
                  {assessment.functional.acceptanceCriteria.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              ) : (
                es.assessmentCard.none
              )}
            </dd>
            <dt className="text-muted-foreground">{es.assessmentCard.questionsLabel}</dt>
            <dd>
              {assessment.functional.questions.length > 0 ? (
                <ul className="list-disc pl-4">
                  {assessment.functional.questions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              ) : (
                es.assessmentCard.noneFeminine
              )}
            </dd>
          </dl>
        </section>

        <section aria-label={es.assessmentCard.technicalHeading} className="flex flex-col gap-1">
          <h3 className="font-medium">{es.assessmentCard.technicalHeading}</h3>
          <dl className="flex flex-col gap-1">
            <dt className="text-muted-foreground">{es.assessmentCard.feasibilityLabel}</dt>
            <dd>{feasibilityLabels[assessment.technical.feasibility]}</dd>
            <dt className="text-muted-foreground">{es.assessmentCard.risksLabel}</dt>
            <dd>
              {assessment.technical.risks.length > 0 ? (
                <ul className="list-disc pl-4">
                  {assessment.technical.risks.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : (
                es.assessmentCard.none
              )}
            </dd>
            <dt className="text-muted-foreground">{es.assessmentCard.dependenciesLabel}</dt>
            <dd>
              {assessment.technical.dependencies.length > 0 ? (
                <ul className="list-disc pl-4">
                  {assessment.technical.dependencies.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              ) : (
                es.assessmentCard.noneFeminine
              )}
            </dd>
          </dl>
        </section>

        <section aria-label={es.assessmentCard.managementHeading} className="flex flex-col gap-1">
          <h3 className="font-medium">{es.assessmentCard.managementHeading}</h3>
          <dl className="flex flex-col gap-1">
            <dt className="text-muted-foreground">{es.assessmentCard.valueLabel}</dt>
            <dd>{assessment.management.value}</dd>
            <dt className="text-muted-foreground">{es.assessmentCard.reachLabel}</dt>
            <dd>{assessment.management.reach}</dd>
            <dt className="text-muted-foreground">{es.assessmentCard.confidenceLabel}</dt>
            <dd>{confidenceLabel(assessment.management.confidence)}</dd>
            <dt className="text-muted-foreground">{es.assessmentCard.effortLabel}</dt>
            <dd>{effortLabels[assessment.management.effort]}</dd>
            <dt className="text-muted-foreground">{es.assessmentCard.recommendationLabel}</dt>
            <dd>
              <Badge variant="outline">{recommendationLabels[assessment.management.recommendation]}</Badge>
            </dd>
            <dt className="text-muted-foreground">{es.assessmentCard.rationaleLabel}</dt>
            <dd>{assessment.management.rationale}</dd>
          </dl>
        </section>
      </div>
    </section>
  );
}
