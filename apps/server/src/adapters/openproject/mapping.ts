import { TicketPriority, WorkPackage } from '@ai-delivery-hub/domain';
import type { TriggerRule } from '@ai-delivery-hub/policies';
import { z } from 'zod';

const OpLink = z.object({ href: z.string().nullable(), title: z.string().optional() });

/** The HAL shape OpenProject v3 returns for a work package; only the fields the hub reads. */
export const OpWorkPackageResource = z.object({
  id: z.number().int().positive(),
  subject: z.string(),
  description: z.object({ raw: z.string().nullable() }).nullable().optional(),
  lockVersion: z.number().int().min(0),
  updatedAt: z.iso.datetime({ offset: true }),
  _links: z.object({
    status: OpLink,
    type: OpLink,
    project: OpLink,
    assignee: OpLink.optional(),
    priority: OpLink.optional(),
  }),
});
export type OpWorkPackageResource = z.infer<typeof OpWorkPackageResource>;

export const OpCollection = z.object({
  total: z.number().int().min(0).optional(),
  count: z.number().int().min(0).optional(),
  pageSize: z.number().int().positive().optional(),
  offset: z.number().int().positive().optional(),
  _embedded: z.object({ elements: z.array(z.unknown()) }),
});
export type OpCollection = z.infer<typeof OpCollection>;

export class OpenProjectMappingError extends Error {
  override readonly name = 'OpenProjectMappingError';
}

function idFromHref(href: string | null | undefined, what: string): number {
  const match = href?.match(/\/(\d+)$/);
  if (!match) throw new OpenProjectMappingError(`work package has no usable ${what} link (href: ${String(href)})`);
  return Number(match[1]);
}

export function toWorkPackage(raw: unknown): WorkPackage {
  const parsed = OpWorkPackageResource.safeParse(raw);
  if (!parsed.success) throw new OpenProjectMappingError(`unexpected work package shape: ${z.prettifyError(parsed.error)}`);
  const r = parsed.data;
  const assigneeHref = r._links.assignee?.href;
  const wp: WorkPackage = {
    id: r.id,
    subject: r.subject,
    description: { raw: r.description?.raw ?? '' },
    status: r._links.status.title ?? '',
    type: r._links.type.title ?? '',
    project: { id: idFromHref(r._links.project.href, 'project'), name: r._links.project.title ?? '' },
    lockVersion: r.lockVersion,
    updatedAt: r.updatedAt,
  };
  if (r._links.priority?.title !== undefined) wp.priority = r._links.priority.title;
  if (assigneeHref) wp.assignee = { id: idFromHref(assigneeHref, 'assignee'), name: r._links.assignee?.title ?? '' };
  return WorkPackage.parse(wp);
}

const PRIORITY_NAMES: Record<string, TicketPriority> = {
  low: 'low',
  baja: 'low',
  normal: 'normal',
  high: 'high',
  alta: 'high',
  immediate: 'immediate',
  inmediata: 'immediate',
};

/** OpenProject priority name (English or Spanish instance) -> domain priority; unknown names are `normal`. */
export function mapPriority(name: string | undefined): TicketPriority {
  return PRIORITY_NAMES[name?.trim().toLowerCase() ?? ''] ?? 'normal';
}

function hasPrefix(subject: string, prefix: string): boolean {
  return subject.trimStart().toLowerCase().startsWith(prefix.toLowerCase());
}

/** Whether a work package opts into the hub under `rule`. */
export function matchesTrigger(wp: WorkPackage, rule: TriggerRule): boolean {
  const byStatus = rule.statusName !== undefined && wp.status === rule.statusName;
  const byPrefix = rule.subjectPrefix !== undefined && hasPrefix(wp.subject, rule.subjectPrefix);
  switch (rule.kind) {
    case 'status':
      return byStatus;
    case 'prefix':
      return byPrefix;
    case 'status_or_prefix':
      return byStatus || byPrefix;
  }
}
