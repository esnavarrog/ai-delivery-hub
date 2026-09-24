import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Timeline } from '@/features/ticket/Timeline';
import { event, SHA } from '../fixtures/ticket';

describe('Timeline', () => {
  it('renders newest first, links plan_version artifacts to the plan route and expands the raw payload', async () => {
    const events = [
      event({ type: 'ticket_received', seq: 1, createdAt: '2026-09-14T10:00:00.000Z' }),
      event({ type: 'plan_version_created', seq: 2, actor: { kind: 'ai', id: 'claude' }, payload: { version: 1, baseCommitSha: SHA }, artifacts: [{ kind: 'plan_version', ref: 'pv1' }], createdAt: '2026-09-14T11:00:00.000Z' }),
    ];
    render(<Timeline events={events} planHref={(ref) => `/tickets/t1/plan?version=${ref}`} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('La IA creó el plan v1');
    expect(items[1]).toHaveTextContent('Ticket recibido desde OpenProject');
    const link = screen.getByRole('link', { name: /plan v1/i });
    expect(link).toHaveAttribute('href', '/tickets/t1/plan?version=pv1');

    await userEvent.click(screen.getAllByRole('button', { name: /mostrar detalles/i })[0]!);
    expect(screen.getByText(/"baseCommitSha"/)).toBeInTheDocument();
  });

  it('shows an empty message when there are no events', () => {
    render(<Timeline events={[]} planHref={() => '#'} />);
    expect(screen.getByText(/aún no hay eventos/i)).toBeInTheDocument();
  });
});
