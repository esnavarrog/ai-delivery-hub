import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useCurrentLogin } from './current-user';

export const FALLBACK_POLL_MS = 5_000;

/**
 * Subscribes to `/api/tickets/:id/events/stream` and invalidates the ticket queries on every event.
 * Returns the polling interval the ticket query should use: `false` while the stream is healthy, 5 s otherwise.
 */
export function useTicketStream(ticketId: string): number | false {
  const login = useCurrentLogin();
  const queryClient = useQueryClient();
  const [healthy, setHealthy] = useState(false);

  useEffect(() => {
    if (!login || typeof EventSource === 'undefined') {
      setHealthy(false);
      return;
    }
    const url = `/api/tickets/${encodeURIComponent(ticketId)}/events/stream?hub_user=${encodeURIComponent(login)}`;
    const source = new EventSource(url);
    source.onopen = () => setHealthy(true);
    source.onerror = () => setHealthy(false);
    source.addEventListener('ticket_event', () => {
      void queryClient.invalidateQueries({ queryKey: ['ticket'] });
      void queryClient.invalidateQueries({ queryKey: ['plan'] });
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
    });
    return () => {
      source.close();
      setHealthy(false);
    };
  }, [ticketId, login, queryClient]);

  return healthy ? false : FALLBACK_POLL_MS;
}
