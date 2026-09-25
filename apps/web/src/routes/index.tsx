import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useMe } from '@/app/queries';

export const Route = createFileRoute('/')({ component: IndexRedirect });

/** Sends the requester to their own requests list; everyone else keeps landing on the inbox. */
function IndexRedirect() {
  const navigate = useNavigate();
  const me = useMe();

  useEffect(() => {
    if (!me.data && !me.isError) return;
    void navigate({ to: me.data?.role === 'requester' ? '/solicitudes' : '/inbox', replace: true });
  }, [me.data, me.isError, navigate]);

  return null;
}
