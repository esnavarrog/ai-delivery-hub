/** OpenProject base URL for work package links; `/api/me` does not expose it yet. */
export const OP_BASE_URL: string = ((import.meta.env['VITE_OP_BASE_URL'] as string | undefined) ?? '').replace(/\/$/, '');

export function workPackageUrl(opWorkPackageId: number): string | undefined {
  return OP_BASE_URL ? `${OP_BASE_URL}/work_packages/${opWorkPackageId}` : undefined;
}
