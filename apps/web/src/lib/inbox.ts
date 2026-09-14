import { isTerminal, type TicketPriority, type TicketSnapshot } from '@ai-delivery-hub/domain';

const PRIORITY_RANK: Record<TicketPriority, number> = { immediate: 0, high: 1, normal: 2, low: 3 };

/** Priority first (immediate > high > normal > low), then the ticket that has waited longest in its state. */
export function sortTickets(tickets: readonly TicketSnapshot[]): TicketSnapshot[] {
  return [...tickets].sort((a, b) => {
    const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (byPriority !== 0) return byPriority;
    return a.updatedAt.localeCompare(b.updatedAt);
  });
}

export interface InboxGroups {
  waitingOnYou: TicketSnapshot[];
  watching: TicketSnapshot[];
}

/** `waiting` comes from the server (`?waitingOn=me`); everything else that is still open is "watching". */
export function groupInbox(all: readonly TicketSnapshot[], waiting: readonly TicketSnapshot[]): InboxGroups {
  const waitingIds = new Set(waiting.map((t) => t.id));
  return {
    waitingOnYou: sortTickets(waiting),
    watching: sortTickets(all.filter((t) => !waitingIds.has(t.id) && !isTerminal(t.state))),
  };
}
