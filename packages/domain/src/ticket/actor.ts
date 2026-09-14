import { z } from 'zod';

export const ActorKind = z.enum(['ai', 'dev', 'qa', 'system']);
export type ActorKind = z.infer<typeof ActorKind>;

/** Who caused an event or attempts a transition. */
export const Actor = z.object({
  kind: ActorKind,
  id: z.string().min(1),
});
export type Actor = z.infer<typeof Actor>;

/**
 * Authorization role of a human actor, resolved outside the domain.
 * - `requester`: raised the ticket; may only comment on plans and toggle `needs_info`.
 * - `dev`: owner-scoped review rights.
 * - `lead`: owner-equivalent review rights on any ticket; valid second approver.
 * - `qa`: QA gates (phase 3).
 * - `admin`: owner-equivalent everywhere.
 */
export const Role = z.enum(['requester', 'dev', 'lead', 'qa', 'admin']);
export type Role = z.infer<typeof Role>;
