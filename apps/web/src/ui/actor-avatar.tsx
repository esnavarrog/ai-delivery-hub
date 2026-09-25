import type { ActorKind } from '@ai-delivery-hub/domain';
import { Bot, Cog, FlaskConical, User } from 'lucide-react';
import { actorKindLabels } from '@/i18n/labels';
import { cn } from '@/lib/utils';

const ICON: Record<ActorKind, typeof Bot> = { ai: Bot, system: Cog, qa: FlaskConical, dev: User };

export function ActorAvatar({ kind, id, className }: { kind: ActorKind; id?: string | undefined; className?: string | undefined }) {
  const Icon = ICON[kind];
  const label = kind === 'ai' ? actorKindLabels.ai : kind === 'system' ? actorKindLabels.system : (id ?? actorKindLabels[kind]);
  return (
    <span
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-full border bg-card text-muted-foreground',
        kind === 'ai' && 'border-primary/40 text-primary',
        className,
      )}
      role="img"
      aria-label={label}
      title={label}
    >
      {kind === 'dev' && id ? <span className="text-xs font-semibold uppercase">{id.slice(0, 2)}</span> : <Icon className="size-4" aria-hidden="true" />}
    </span>
  );
}
