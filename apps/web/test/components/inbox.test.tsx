import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InboxList } from '@/features/inbox/InboxList';
import { ticket } from '../fixtures/ticket';

describe('InboxList', () => {
  it('explains how a ticket enters the hub when empty', () => {
    render(<InboxList tickets={[]} selectedIndex={0} onOpen={vi.fn()} emptyTitle="Nada pendiente para ti" />);
    expect(screen.getByText('Nada pendiente para ti')).toBeInTheDocument();
    expect(screen.getByText(/Ready for AI/)).toBeInTheDocument();
    expect(screen.getByText(/\[AI\]/)).toBeInTheDocument();
    expect(screen.getAllByText(/Obsidian/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Traer tickets/)).toBeInTheDocument();
  });

  it('renders a card with the display key, subject, repo, risk and state', () => {
    render(<InboxList tickets={[ticket({ flags: ['needs_info'] })]} selectedIndex={0} onOpen={vi.fn()} emptyTitle="x" />);
    expect(screen.getByText('OP-8378')).toBeInTheDocument();
    expect(screen.getByText('Add refund endpoint')).toBeInTheDocument();
    expect(screen.getByText('backend-parkingapp')).toBeInTheDocument();
    expect(screen.getByLabelText('riesgo medio')).toBeInTheDocument();
    expect(screen.getByText('Revisión del plan')).toBeInTheDocument();
    expect(screen.getByText('Necesita información')).toBeInTheDocument();
  });

  it('shows an OP source badge for an OpenProject ticket and a Manual badge for a manual ticket', () => {
    render(
      <InboxList
        tickets={[ticket({ id: 't-op' }), ticket({ id: 't-manual', source: { kind: 'manual', key: 'M-0001' }, displayKey: 'M-0001' })]}
        selectedIndex={0}
        onOpen={vi.fn()}
        emptyTitle="x"
      />,
    );
    expect(screen.getByLabelText('Fuente: OpenProject')).toHaveTextContent('OP');
    expect(screen.getByLabelText('Fuente: Manual')).toHaveTextContent('Manual');
    expect(screen.getByText('M-0001')).toBeInTheDocument();
  });
});
