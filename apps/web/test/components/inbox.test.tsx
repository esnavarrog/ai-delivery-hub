import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InboxList } from '@/features/inbox/InboxList';
import { ticket } from '../fixtures/ticket';

describe('InboxList', () => {
  it('explains how a ticket enters the hub when empty', () => {
    render(<InboxList tickets={[]} selectedIndex={0} onOpen={vi.fn()} emptyTitle="Nothing waiting on you" />);
    expect(screen.getByText('Nothing waiting on you')).toBeInTheDocument();
    expect(screen.getByText(/Ready for AI/)).toBeInTheDocument();
    expect(screen.getByText(/\[AI\]/)).toBeInTheDocument();
  });

  it('renders a card with work package id, subject, repo, risk and state', () => {
    render(<InboxList tickets={[ticket({ flags: ['needs_info'] })]} selectedIndex={0} onOpen={vi.fn()} emptyTitle="x" />);
    expect(screen.getByText('#8378')).toBeInTheDocument();
    expect(screen.getByText('Add refund endpoint')).toBeInTheDocument();
    expect(screen.getByText('backend-parkingapp')).toBeInTheDocument();
    expect(screen.getByLabelText('medium risk')).toBeInTheDocument();
    expect(screen.getByText('plan review')).toBeInTheDocument();
    expect(screen.getByText('needs info')).toBeInTheDocument();
  });
});
