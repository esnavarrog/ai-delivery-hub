import type { CommandResponse, MeResponse, TicketDetailResponse } from '@ai-delivery-hub/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setCurrentLogin } from '@/app/current-user';
import { TicketPageContainer } from '@/features/ticket/TicketPageContainer';
import { detail, event, SHA, ticket } from '../fixtures/ticket';
import { renderApp } from './render-app';

let current: TicketDetailResponse;
const approveBodies: unknown[] = [];

const server = setupServer(
  http.get('*/api/me', () => HttpResponse.json({ login: 'esteban', role: 'dev' } satisfies MeResponse)),
  http.get('*/api/tickets/t1', () => HttpResponse.json(current)),
  http.post('*/api/tickets/t1/approve', async ({ request }) => {
    approveBodies.push(await request.json());
    current = { ...current, ticket: { ...current.ticket, state: 'plan_approved' } };
    return HttpResponse.json({ ticket: current.ticket } satisfies CommandResponse);
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  setCurrentLogin('esteban');
  approveBodies.length = 0;
  current = detail({
    ticket: ticket({ state: 'plan_review', ownerUserId: 'esteban', riskTier: 'medium' }),
    events: [
      event({ type: 'ticket_received', seq: 1 }),
      event({ type: 'plan_version_created', seq: 2, actor: { kind: 'ai', id: 'claude' }, payload: { version: 1, baseCommitSha: SHA }, artifacts: [{ kind: 'plan_version', ref: 'pv1' }] }),
    ],
  });
});

describe('TicketPageContainer approve flow', () => {
  it('posts an empty approve body for medium risk, toasts and refreshes the state chip', async () => {
    renderApp(<TicketPageContainer ticketId="t1" />, { path: '/tickets/$id', initialEntries: ['/tickets/t1'] });
    await screen.findByText('Add refund endpoint');
    expect(screen.getByText('La IA creó el plan v1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Aprobar plan' }));
    await waitFor(() => expect(approveBodies).toEqual([{}]));
    expect(await screen.findByText('Plan aprobado.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('Plan aprobado').length).toBeGreaterThan(0));
  });

  it('asks for a second approver on high risk and sends it in the body', async () => {
    current = { ...current, ticket: { ...current.ticket, riskTier: 'high' } };
    renderApp(<TicketPageContainer ticketId="t1" />, { path: '/tickets/$id', initialEntries: ['/tickets/t1'] });
    await screen.findByText('Add refund endpoint');
    expect(screen.getByTestId('risk-banner')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Aprobar plan' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(screen.getByLabelText(/usuario del segundo aprobador/i), 'ana');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar plan' }));
    await waitFor(() => expect(approveBodies).toEqual([{ secondApproverId: 'ana' }]));
    expect((await screen.findAllByText('Plan aprobado.')).length).toBeGreaterThan(0);
  });

  it('surfaces a 409 from the server as an error toast', async () => {
    server.use(http.post('*/api/tickets/t1/approve', () => HttpResponse.json({ error: { code: 'conflict', message: 'plan has 1 unresolved comment(s)' } }, { status: 409 })));
    renderApp(<TicketPageContainer ticketId="t1" />, { path: '/tickets/$id', initialEntries: ['/tickets/t1'] });
    await screen.findByText('Add refund endpoint');
    await userEvent.click(screen.getByRole('button', { name: 'Aprobar plan' }));
    expect(await screen.findByText('plan has 1 unresolved comment(s)')).toBeInTheDocument();
  });
});
