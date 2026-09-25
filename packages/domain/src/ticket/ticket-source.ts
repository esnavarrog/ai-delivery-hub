import { z } from 'zod';

/**
 * Where a ticket came from. OpenProject tickets carry the OP bookkeeping the ingest pipeline needs
 * (work package id, project id, and `lockVersion` to detect and apply upstream changes
 * idempotently). Manual tickets are authored directly in the hub — today, imported from an
 * Obsidian inbox note — and are identified by an `M-<n>` key the hub assigns itself.
 */
export const TicketSource = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('openproject'),
    workPackageId: z.number().int().positive(),
    projectId: z.number().int().positive(),
    lockVersion: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal('manual'),
    key: z.string().regex(/^M-\d+$/, 'manual ticket key must look like M-0001'),
  }),
]);
export type TicketSource = z.infer<typeof TicketSource>;

/** Short human-readable identifier shown in the UI and used for the Obsidian mirror filename. */
export function ticketDisplayKey(source: TicketSource): string {
  return source.kind === 'openproject' ? `OP-${source.workPackageId}` : source.key;
}

/** Formats the nth manual ticket (1-based) as `M-0001`, `M-0002`, ..., `M-10000`, ... */
export function formatManualKey(n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new Error(`manual ticket sequence must be a positive integer, got ${n}`);
  return `M-${String(n).padStart(4, '0')}`;
}
