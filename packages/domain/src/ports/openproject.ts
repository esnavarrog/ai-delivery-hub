import { z } from 'zod';

const NamedRef = z.object({ id: z.number().int().positive(), name: z.string() });

/** The subset of an OpenProject work package the hub relies on. */
export const WorkPackage = z.object({
  id: z.number().int().positive(),
  subject: z.string(),
  description: z.object({ raw: z.string() }),
  status: z.string(),
  type: z.string(),
  assignee: NamedRef.optional(),
  project: NamedRef,
  /** Priority name as OpenProject reports it (e.g. "High"); mapped to `TicketPriority` outside the domain. */
  priority: z.string().optional(),
  lockVersion: z.number().int().min(0),
  updatedAt: z.iso.datetime(),
});
export type WorkPackage = z.infer<typeof WorkPackage>;

export interface OpenProjectPort {
  getWorkPackage(id: number): Promise<WorkPackage>;
  listUpdatedSince(projectId: number, sinceIso: string): Promise<WorkPackage[]>;
  addComment(workPackageId: number, body: string): Promise<{ commentId: string }>;
  /** Uses OpenProject's optimistic locking; rejects when `lockVersion` is stale. */
  setStatus(workPackageId: number, statusId: number, lockVersion: number): Promise<WorkPackage>;
}
