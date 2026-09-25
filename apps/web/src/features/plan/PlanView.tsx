import type { PlanCommentDto, PlanVersionDto } from '@ai-delivery-hub/contracts';
import { PLAN_SECTION_KEYS, type Plan, type PlanSectionKey, type SectionPath } from '@ai-delivery-hub/domain';
import type { ReactNode } from 'react';
import { es } from '@/i18n/es';
import { cn } from '@/lib/utils';
import { RiskBadge } from '@/ui/risk-badge';
import { SectionComments } from './SectionComments';
import { SECTION_LABELS } from './section-labels';

export interface PlanViewProps {
  version: PlanVersionDto;
  /** Comments of this version only. */
  comments: readonly PlanCommentDto[];
  /** Top-level sections that differ from the compared version; highlighted. */
  changedSections: ReadonlySet<PlanSectionKey>;
  canComment: boolean;
  canResolve: boolean;
  busy?: boolean;
  onAddComment: (input: { sectionPath: SectionPath; body: string }) => void;
  onResolve: (commentId: string) => void;
  /** Resolves a `design_draft` artifact ref to its HTML; undefined when the artifact cannot be fetched. */
  draftHtml: (artifactRef: string) => string | undefined;
}

const sectionOf = (path: string): string => path.replace(/\[\d+\]$/, '');

function List({ items, mono = false }: { items: readonly string[]; mono?: boolean }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{es.plan.none}</p>;
  return (
    <ul className={cn('list-disc space-y-1 pl-5 text-sm', mono && 'font-mono text-xs')}>
      {items.map((item, i) => (
        <li key={`${i}-${item}`}>{item}</li>
      ))}
    </ul>
  );
}

function renderSection(key: PlanSectionKey, plan: Plan, draftHtml: PlanViewProps['draftHtml']): ReactNode {
  switch (key) {
    case 'goal':
      return <p className="text-sm">{plan.goal}</p>;
    case 'scopeIn':
      return <List items={plan.scopeIn} />;
    case 'scopeOut':
      return <List items={plan.scopeOut} />;
    case 'designDrafts':
      return (
        <div className="grid gap-4 md:grid-cols-2">
          {(plan.designDrafts ?? []).map((draft) => {
            const html = draftHtml(draft.artifactRef);
            return (
              <figure key={draft.id} className="flex flex-col gap-2 rounded-lg border p-3">
                <figcaption className="text-sm">
                  <span className="font-medium">{draft.title}</span>
                  <span className="text-muted-foreground"> · {draft.purpose}</span>
                </figcaption>
                {html !== undefined ? (
                  <iframe title={draft.title} sandbox="" srcDoc={html} className="h-72 w-full rounded border bg-white" />
                ) : (
                  <p className="rounded border border-dashed p-3 text-xs text-muted-foreground">{es.plan.draftNotDownloadable(draft.artifactRef)}</p>
                )}
              </figure>
            );
          })}
        </div>
      );
    case 'filesTouched':
      return plan.filesTouched.length === 0 ? (
        <p className="text-sm text-muted-foreground">{es.plan.none}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {plan.filesTouched.map((f) => (
            <li key={`${f.action}:${f.path}`} className="flex flex-wrap items-baseline gap-2">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs uppercase">{f.action}</span>
              <span className="font-mono text-xs sm:text-sm">{f.path}</span>
              <span className="text-muted-foreground">{f.why}</span>
            </li>
          ))}
        </ul>
      );
    case 'steps':
      return (
        <ol className="space-y-3 text-sm">
          {[...plan.steps]
            .sort((a, b) => a.order - b.order)
            .map((step) => (
              <li key={step.order} className="flex gap-3">
                <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{step.order}</span>
                <div className="min-w-0">
                  <p className="font-medium">{step.title}</p>
                  <p className="text-muted-foreground">{step.detail}</p>
                  {step.tests.length > 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {es.plan.tests} <span className="font-mono">{step.tests.join(', ')}</span>
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
        </ol>
      );
    case 'tests':
      return <List items={plan.tests} mono />;
    case 'risks':
      return plan.risks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{es.plan.noneIdentified}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {plan.risks.map((r, i) => (
            <li key={`${i}-${r.description}`} className="flex flex-col gap-1 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <RiskBadge tier={r.tier} />
                <span className="font-medium">{r.description}</span>
              </div>
              <p className="text-muted-foreground">
                {es.plan.mitigation} {r.mitigation}
              </p>
            </li>
          ))}
        </ul>
      );
    case 'rollback':
      return <p className="text-sm">{plan.rollback}</p>;
    case 'acceptanceCriteria':
      return (
        <ul className="space-y-2 text-sm">
          {plan.acceptanceCriteria.map((ac) => (
            <li key={ac.id} className="rounded-md border p-3">
              <p className="font-mono text-xs text-muted-foreground">{ac.id}</p>
              <p>
                <span className="font-medium">{es.plan.given}</span> {ac.given}, <span className="font-medium">{es.plan.when}</span> {ac.when}, <span className="font-medium">{es.plan.then}</span> {ac.then}
              </p>
            </li>
          ))}
        </ul>
      );
    case 'baseCommitSha':
      return <code className="break-all font-mono text-xs">{plan.baseCommitSha}</code>;
    case 'openQuestions':
      return <List items={plan.openQuestions} />;
  }
}

/** Plan sections in canonical order, each with its comments and inline comment affordance. */
export function PlanView({ version, comments, changedSections, canComment, canResolve, busy = false, onAddComment, onResolve, draftHtml }: PlanViewProps) {
  const { plan } = version;
  const keys = PLAN_SECTION_KEYS.filter((key) => key !== 'designDrafts' || (plan.designDrafts !== undefined && plan.designDrafts.length > 0));
  return (
    <div className="flex flex-col gap-6" data-testid="plan-view" data-version={version.version}>
      {keys.map((key) => {
        const sectionComments = comments.filter((c) => sectionOf(c.sectionPath) === key);
        const changed = changedSections.has(key);
        return (
          <section
            key={key}
            id={`section-${key}`}
            data-testid={`section-${key}`}
            data-changed={changed ? 'true' : 'false'}
            className={cn('rounded-xl border bg-card p-4 sm:p-5', changed && 'border-primary/50 ring-2 ring-primary/20')}
            aria-labelledby={`heading-${key}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
              <h2 id={`heading-${key}`} className="text-base font-semibold">
                {SECTION_LABELS[key]}
              </h2>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {changed ? <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">{es.plan.changed}</span> : null}
                {sectionComments.length > 0 ? <span>{es.plan.comments(sectionComments.length)}</span> : null}
              </div>
            </div>
            {renderSection(key, plan, draftHtml)}
            <SectionComments sectionPath={key} comments={sectionComments} canComment={canComment} canResolve={canResolve} busy={busy} onAddComment={onAddComment} onResolve={onResolve} />
          </section>
        );
      })}
    </div>
  );
}
