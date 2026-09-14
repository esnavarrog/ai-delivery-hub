import { z } from 'zod';
import { CommitSha } from '../events/ticket-event.js';
import { Actor } from '../ticket/actor.js';
import { RiskTier } from '../ticket/ticket-state.js';

export const FileAction = z.enum(['create', 'modify', 'delete']);
export type FileAction = z.infer<typeof FileAction>;

export const FileTouched = z.object({
  path: z.string().min(1),
  action: FileAction,
  why: z.string().min(1),
});
export type FileTouched = z.infer<typeof FileTouched>;

export const PlanStep = z.object({
  order: z.number().int().min(1),
  title: z.string().min(1),
  detail: z.string().min(1),
  tests: z.array(z.string().min(1)),
});
export type PlanStep = z.infer<typeof PlanStep>;

export const PlanRisk = z.object({
  description: z.string().min(1),
  mitigation: z.string().min(1),
  tier: RiskTier,
});
export type PlanRisk = z.infer<typeof PlanRisk>;

export const AcceptanceCriterion = z.object({
  id: z.string().min(1),
  given: z.string().min(1),
  when: z.string().min(1),
  then: z.string().min(1),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterion>;

/** An HTML mockup attached to a plan; `artifactRef` matches an `Artifact` of kind `design_draft`. */
export const DesignDraft = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  purpose: z.string().min(1),
  artifactRef: z.string().min(1),
});
export type DesignDraft = z.infer<typeof DesignDraft>;

export const MAX_DESIGN_DRAFTS = 2;

const unique = <T>(items: readonly T[], key: (item: T) => string | number): boolean =>
  new Set(items.map(key)).size === items.length;

/** Structured implementation plan produced by the planning agent and reviewed by humans. */
export const Plan = z.object({
  goal: z.string().min(1),
  scopeIn: z.array(z.string().min(1)),
  scopeOut: z.array(z.string().min(1)),
  designDrafts: z
    .array(DesignDraft)
    .max(MAX_DESIGN_DRAFTS)
    .refine((drafts) => unique(drafts, (d) => d.id), { message: 'design draft ids must be unique' })
    .optional(),
  filesTouched: z.array(FileTouched),
  steps: z
    .array(PlanStep)
    .min(1)
    .refine((steps) => unique(steps, (s) => s.order), { message: 'step orders must be unique' }),
  tests: z.array(z.string().min(1)),
  risks: z.array(PlanRisk),
  rollback: z.string().min(1),
  acceptanceCriteria: z
    .array(AcceptanceCriterion)
    .min(1)
    .refine((acs) => unique(acs, (a) => a.id), { message: 'acceptance criterion ids must be unique' }),
  baseCommitSha: CommitSha,
  openQuestions: z.array(z.string().min(1)),
});
export type Plan = z.infer<typeof Plan>;

/** Top-level plan sections, in canonical order. Used by rendering, diffing and comment anchoring. */
export const PLAN_SECTION_KEYS = [
  'goal',
  'scopeIn',
  'scopeOut',
  'designDrafts',
  'filesTouched',
  'steps',
  'tests',
  'risks',
  'rollback',
  'acceptanceCriteria',
  'baseCommitSha',
  'openQuestions',
] as const satisfies readonly (keyof Plan)[];
export type PlanSectionKey = (typeof PLAN_SECTION_KEYS)[number];

/** `goal`, `risks`, `steps[2]`, ... — a top-level section, optionally indexed. */
export const SECTION_PATH_PATTERN = new RegExp(`^(${PLAN_SECTION_KEYS.join('|')})(\\[\\d+\\])?$`);
export const SectionPath = z.string().regex(SECTION_PATH_PATTERN, 'expected a plan section path like `steps[2]` or `goal`');
export type SectionPath = z.infer<typeof SectionPath>;

export const PlanVersion = z.object({
  ticketId: z.string().min(1),
  version: z.number().int().min(1),
  plan: Plan,
  renderedMarkdown: z.string(),
  createdBy: Actor,
  createdAt: z.iso.datetime(),
});
export type PlanVersion = z.infer<typeof PlanVersion>;

export const PlanComment = z.object({
  id: z.string().min(1),
  planVersionId: z.string().min(1),
  sectionPath: SectionPath,
  authorId: z.string().min(1),
  body: z.string().min(1),
  resolvedByVersion: z.number().int().min(1).optional(),
});
export type PlanComment = z.infer<typeof PlanComment>;
