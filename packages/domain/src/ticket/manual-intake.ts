import { z } from 'zod';

/** Business unit that raised a manual (non-OpenProject) ticket. */
export const Department = z.enum(['support', 'operations', 'finance', 'other']);
export type Department = z.infer<typeof Department>;

/** How often the requester runs into the problem being reported. */
export const Frequency = z.enum(['daily', 'weekly', 'monthly', 'occasional']);
export type Frequency = z.infer<typeof Frequency>;

/**
 * Structured, problem-first intake for a manually raised feature request. Carried optionally on the
 * `ticket_received` payload of a manual ticket; older manual tickets have no `intake` and still replay.
 */
export const ManualIntake = z.object({
  department: Department,
  problem: z.string().min(1),
  /** Who is affected by the problem (team, role, or individual). */
  affected: z.string().min(1),
  frequency: Frequency,
  currentWorkaround: z.string().min(1),
  expectedOutcome: z.string().min(1),
  successMetric: z.string().min(1).optional(),
  /** ISO date (no time component), e.g. `2026-12-01`. */
  deadline: z.iso.date().optional(),
  deadlineReason: z.string().min(1).optional(),
});
export type ManualIntake = z.infer<typeof ManualIntake>;
