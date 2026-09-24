import { isTerminal, type TicketSnapshot, type TicketState } from '@ai-delivery-hub/domain';
import { es } from '@/i18n/es';
import { ticketStateLabels } from '@/i18n/labels';

export const PHASE1_COLUMNS: readonly TicketState[] = ['received', 'triaging', 'triaged', 'awaiting_owner', 'planning', 'plan_review', 'plan_changes_requested', 'plan_approved'];

export type ColumnId = TicketState | 'closed' | 'later';

export interface BoardColumn {
  id: ColumnId;
  title: string;
  tickets: TicketSnapshot[];
}

export interface BoardFilters {
  repo?: string | undefined;
  owner?: string | undefined;
  risk?: string | undefined;
}

export function applyFilters(tickets: readonly TicketSnapshot[], f: BoardFilters): TicketSnapshot[] {
  return tickets.filter((t) => (!f.repo || t.targetRepo === f.repo) && (!f.owner || t.ownerUserId === f.owner) && (!f.risk || t.riskTier === f.risk));
}

/** Phase 1 states in order, then a collapsed "Closed" column; later-phase states appear only when present. */
export function buildColumns(tickets: readonly TicketSnapshot[]): BoardColumn[] {
  const columns: BoardColumn[] = PHASE1_COLUMNS.map((state) => ({ id: state, title: ticketStateLabels[state], tickets: tickets.filter((t) => t.state === state) }));
  const later = tickets.filter((t) => !isTerminal(t.state) && !PHASE1_COLUMNS.includes(t.state));
  if (later.length > 0) columns.push({ id: 'later', title: es.board.laterPhasesColumn, tickets: later });
  columns.push({ id: 'closed', title: es.board.closedColumn, tickets: tickets.filter((t) => isTerminal(t.state)) });
  return columns;
}
