import type { Artifact, TicketEvent } from '@ai-delivery-hub/domain';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { useState, type MouseEvent } from 'react';
import { es } from '@/i18n/es';
import { eventToSentence } from '@/lib/event-to-sentence';
import { humanize } from '@/lib/format';
import { ActorAvatar } from '@/ui/actor-avatar';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { RelativeTime } from '@/ui/relative-time';

export interface TimelineProps {
  events: readonly TicketEvent[];
  /** Builds the in-app URL for a `plan_version` artifact ref. */
  planHref: (ref: string) => string;
  /** SPA navigation for artifact links; falls back to a normal anchor when omitted. */
  onNavigate?: ((href: string) => void) | undefined;
}

function artifactLabel(artifact: Artifact, text: string): string {
  if (artifact.kind === 'plan_version') {
    const match = /plan v(\d+)/.exec(text);
    return match ? es.timeline.openPlanVersion(match[1] ?? '') : es.timeline.openPlanVersionGeneric;
  }
  return `${humanize(artifact.kind, true)} ${artifact.ref}`;
}

/** Events newest first, each as one sentence with actor icon, expandable payload and artifact links. */
export function Timeline({ events, planHref, onNavigate }: TimelineProps) {
  if (events.length === 0) {
    return <EmptyState title={es.timeline.emptyTitle}>{es.timeline.emptyBody}</EmptyState>;
  }
  const ordered = [...events].sort((a, b) => b.seq - a.seq);
  return (
    <ol className="relative flex flex-col gap-1" aria-label={es.timeline.ariaLabel}>
      {ordered.map((event) => (
        <TimelineItem key={event.id} event={event} planHref={planHref} onNavigate={onNavigate} />
      ))}
    </ol>
  );
}

function TimelineItem({ event, planHref, onNavigate }: { event: TicketEvent } & Pick<TimelineProps, 'planHref' | 'onNavigate'>) {
  const [open, setOpen] = useState(false);
  const sentence = eventToSentence(event);
  const hasPayload = event.payload && Object.keys(event.payload).length > 0;

  const handleClick = (href: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onNavigate) return;
    e.preventDefault();
    onNavigate(href);
  };

  return (
    <li className="flex gap-3 rounded-lg px-2 py-2 hover:bg-muted/50" data-event-type={event.type}>
      <ActorAvatar kind={event.actor.kind} id={event.actor.id} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="text-sm">{sentence.text}</p>
          <RelativeTime iso={event.createdAt} className="text-xs text-muted-foreground" />
        </div>
        {sentence.reason ? (
          <p className="mt-0.5 text-sm text-muted-foreground">
            {es.timeline.reasonPrefix} {sentence.reason}
          </p>
        ) : null}
        {sentence.artifacts.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-2" aria-label={es.timeline.artifactsAria}>
            {sentence.artifacts.map((artifact) => {
              const href = artifact.kind === 'plan_version' ? planHref(artifact.ref) : undefined;
              const label = artifactLabel(artifact, sentence.text);
              return (
                <span key={`${artifact.kind}:${artifact.ref}`}>
                  {href ? (
                    <a href={href} onClick={handleClick(href)} className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline">
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                      {label}
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{label}</span>
                  )}
                </span>
              );
            })}
          </div>
        ) : null}
        {hasPayload ? (
          <div className="mt-1">
            <Button variant="ghost" size="sm" className="h-6 px-1 text-xs text-muted-foreground" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {open ? <ChevronDown className="size-3" aria-hidden="true" /> : <ChevronRight className="size-3" aria-hidden="true" />}
              {open ? es.timeline.hideDetails : es.timeline.showDetails}
            </Button>
            {open ? (
              <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-muted p-2 text-xs" aria-label={es.timeline.rawPayloadAria}>
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
