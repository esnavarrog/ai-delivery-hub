import { z } from 'zod';
import { RiskTier, TicketCategory, TicketFlag, TicketState } from './ticket-state.js';

/** Mirrors OpenProject's default priority set. */
export const TicketPriority = z.enum(['low', 'normal', 'high', 'immediate']);
export type TicketPriority = z.infer<typeof TicketPriority>;

/**
 * Read model of a ticket, derived by folding its event stream.
 * `lastPlanVersionAt` / `lastHumanCommentAt` exist so the replan guard can be
 * evaluated from the snapshot alone, without reloading events.
 */
export const TicketSnapshot = z.object({
  id: z.string().min(1),
  opWorkPackageId: z.number().int().positive(),
  opProjectId: z.number().int().positive(),
  opLockVersion: z.number().int().min(0),
  subject: z.string().min(1),
  state: TicketState,
  flags: z.array(TicketFlag),
  category: TicketCategory.optional(),
  riskTier: RiskTier.optional(),
  targetRepo: z.string().min(1).optional(),
  ownerUserId: z.string().min(1).optional(),
  priority: TicketPriority,
  planVersionCount: z.number().int().min(0),
  unresolvedCommentCount: z.number().int().min(0),
  lastPlanVersionAt: z.iso.datetime().optional(),
  lastHumanCommentAt: z.iso.datetime().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type TicketSnapshot = z.infer<typeof TicketSnapshot>;
