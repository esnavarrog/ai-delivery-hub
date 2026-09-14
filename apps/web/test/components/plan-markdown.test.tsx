import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlanMarkdown } from '@/features/plan/PlanMarkdown';

describe('PlanMarkdown', () => {
  it('renders headings and lists from the rendered markdown', () => {
    render(<PlanMarkdown markdown={'# Plan\n\n## Goal\n\n- one\n- two'} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Plan' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
  it('explains when there is nothing to render', () => {
    render(<PlanMarkdown markdown="   " />);
    expect(screen.getByText(/no rendered markdown/)).toBeInTheDocument();
  });
});
