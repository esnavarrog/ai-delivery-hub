import { z } from 'zod';

/** Lifecycle states of a ticket. Order matters for documentation and UI only. */
export const TicketState = z.enum([
  'received',
  'triaging',
  'triaged',
  'awaiting_owner',
  'planning',
  'plan_review',
  'plan_changes_requested',
  'plan_approved',
  'rejected',
  'duplicate',
  'already_implemented',
  'implementing',
  'dev_review',
  'sandbox_qa',
  'qa_changes_requested',
  'staging_qa',
  'done',
]);
export type TicketState = z.infer<typeof TicketState>;

/** Orthogonal flags that annotate a ticket without changing its state. */
export const TicketFlag = z.enum(['blocked', 'needs_info', 'paused', 'stale_plan']);
export type TicketFlag = z.infer<typeof TicketFlag>;

export const RiskTier = z.enum(['low', 'medium', 'high']);
export type RiskTier = z.infer<typeof RiskTier>;

export const TicketCategory = z.enum(['bug', 'feature', 'chore', 'question']);
export type TicketCategory = z.infer<typeof TicketCategory>;
