import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlanView } from '@/features/plan/PlanView';
import { comment, plan, planVersion } from '../fixtures/ticket';

describe('PlanView', () => {
  it('renders every section in the fixed order, comments under their section, and a design draft in a sandboxed iframe', () => {
    const version = planVersion({
      plan: plan({ designDrafts: [{ id: 'd1', title: 'Refund form', purpose: 'Mobile layout', artifactRef: 'draft-1' }] }),
    });
    const comments = [comment({ id: 'c1', sectionPath: 'steps[0]' }), comment({ id: 'c2', sectionPath: 'goal', resolvedByVersion: 2, body: 'Clarify the audience' })];
    render(
      <PlanView
        version={version}
        comments={comments}
        changedSections={new Set(['goal'])}
        canResolve
        canComment
        onAddComment={vi.fn()}
        onResolve={vi.fn()}
        draftHtml={() => '<p>draft</p>'}
      />,
    );
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Goal', 'Scope in', 'Scope out', 'Design drafts', 'Files touched', 'Steps', 'Tests', 'Risks', 'Rollback', 'Acceptance criteria', 'Base commit', 'Open questions']);

    const steps = screen.getByTestId('section-steps');
    expect(within(steps).getByText('Please add a spec for the failure path')).toBeInTheDocument();
    expect(within(steps).getByRole('button', { name: /resolve/i })).toBeInTheDocument();

    const goal = screen.getByTestId('section-goal');
    expect(within(goal).getByText('addressed in v2')).toBeInTheDocument();
    expect(goal).toHaveAttribute('data-changed', 'true');

    const iframe = screen.getByTitle('Refund form');
    expect(iframe).toHaveAttribute('sandbox', '');
    expect(iframe).toHaveAttribute('srcdoc', '<p>draft</p>');
  });

  it('omits the design drafts section when the plan has none', () => {
    render(<PlanView version={planVersion()} comments={[]} changedSections={new Set()} canResolve={false} canComment={false} onAddComment={vi.fn()} onResolve={vi.fn()} draftHtml={() => undefined} />);
    expect(screen.queryByRole('heading', { name: 'Design drafts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resolve/i })).not.toBeInTheDocument();
  });
});
