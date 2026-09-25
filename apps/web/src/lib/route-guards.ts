import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useMe } from '@/app/queries';

/**
 * Cosmetic-only client gate for lead/admin/dev pages (inbox, board, runs): a requester is redirected
 * to `to` (their own requests list). The server is the real enforcement point (403 on /api/runs,
 * ticket list/detail scoped to the requester's own tickets). Returns whether the caller should render
 * nothing while the redirect takes effect.
 */
export function useRedirectRequesterAway(to: string): boolean {
  const navigate = useNavigate();
  const me = useMe();
  const isRequester = me.data?.role === 'requester';
  useEffect(() => {
    if (isRequester) void navigate({ to, replace: true });
  }, [isRequester, navigate, to]);
  return isRequester;
}
