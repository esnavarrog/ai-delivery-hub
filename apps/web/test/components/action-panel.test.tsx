import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ActionPanel } from '@/features/ticket/ActionPanel';
import { resolveActions } from '@/lib/action-resolver';
import { TooltipProvider } from '@/ui/tooltip';
import { detail, run, ticket } from '../fixtures/ticket';

const NOW = new Date('2026-09-14T12:00:00.000Z');

function renderPanel(t = ticket(), extra: Partial<Parameters<typeof ActionPanel>[0]> = {}) {
  const onAction = vi.fn();
  const d = detail({ ticket: t, unresolvedCommentCount: t.unresolvedCommentCount, latestRun: extra.detail?.latestRun ?? null });
  const actions = resolveActions({ ticket: t, role: extra.role ?? 'dev', login: extra.login ?? 'esteban', latestRun: d.latestRun, now: NOW });
  render(
    <TooltipProvider>
      <ActionPanel detail={d} actions={actions} role={extra.role ?? 'dev'} login={extra.login ?? 'esteban'} onAction={onAction} busy={false} now={NOW} />
    </TooltipProvider>,
  );
  return { onAction };
}

describe('ActionPanel', () => {
  it('plan_review as owner: Approve primary, Request changes secondary', async () => {
    const { onAction } = renderPanel(ticket({ state: 'plan_review', ownerUserId: 'esteban' }));
    const approve = screen.getByRole('button', { name: 'Aprobar plan' });
    expect(approve).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Solicitar cambios' })).toBeInTheDocument();
    await userEvent.click(approve);
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'approve' }));
  });

  it('disables Approve with a tooltip while comments are unresolved', () => {
    renderPanel(ticket({ state: 'plan_review', ownerUserId: 'esteban', unresolvedCommentCount: 2 }));
    const approve = screen.getByRole('button', { name: 'Aprobar plan' });
    expect(approve).toBeDisabled();
    expect(screen.getByText(/2 comentarios sin resolver/)).toBeInTheDocument();
  });

  it('awaiting_owner: Claim ticket is the primary action', () => {
    renderPanel(ticket({ state: 'awaiting_owner', ownerUserId: undefined }));
    expect(screen.getByRole('button', { name: 'Reclamar ticket' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprobar plan' })).not.toBeInTheDocument();
  });

  it('planning: shows AI working with elapsed time and Stop AI', () => {
    renderPanel(ticket({ state: 'planning' }), { detail: detail({ latestRun: run({ startedAt: '2026-09-14T11:57:00.000Z' }) }) });
    expect(screen.getByText(/La IA está trabajando · 3m · En ejecución/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Detener IA' })).toBeInTheDocument();
  });

  it('triaged as lead: shows the triage suggestion card and Confirm', () => {
    renderPanel(ticket({ state: 'triaged', ownerUserId: undefined, category: 'bug', riskTier: 'high', targetRepo: 'backend-parkingapp' }), { role: 'lead' });
    expect(screen.getByRole('button', { name: 'Confirmar triaje' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rechazar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marcar como duplicado' })).toBeInTheDocument();
    expect(screen.getByText('backend-parkingapp')).toBeInTheDocument();
  });

  it('requester: read-only panel with Add comment', () => {
    renderPanel(ticket({ state: 'plan_review' }), { role: 'requester' });
    expect(screen.getByText('Solo lectura')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agregar comentario' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprobar plan' })).not.toBeInTheDocument();
  });

  it('Pause AI is offered as a tertiary action outside running states', async () => {
    const { onAction } = renderPanel(ticket({ state: 'plan_review', ownerUserId: 'esteban' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pausar IA' }));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'pause' }));
  });
});
