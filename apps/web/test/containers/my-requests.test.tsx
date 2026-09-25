import type { MeResponse, TicketListResponse } from '@ai-delivery-hub/contracts';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setCurrentLogin } from '@/app/current-user';
import { MyRequestsContainer } from '@/features/requests/MyRequestsContainer';
import { ticket } from '../fixtures/ticket';
import { renderApp } from './render-app';

let tickets: TicketListResponse['tickets'];
let me: MeResponse;

const server = setupServer(
  http.get('*/api/me', () => HttpResponse.json(me)),
  http.get('*/api/tickets', () => HttpResponse.json({ tickets } satisfies TicketListResponse)),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('MyRequestsContainer', () => {
  it('shows the awaiting-answer badge with the pending question count', async () => {
    setCurrentLogin('ana');
    me = { login: 'ana', role: 'requester' };
    tickets = [
      ticket({ id: 't1', subject: 'No puedo exportar reportes', state: 'awaiting_requester', requesterUserId: 'ana', pendingQuestionCount: 2, department: 'finance' }),
      ticket({ id: 't2', subject: 'Otra solicitud', state: 'triaging', requesterUserId: 'ana', department: 'support' }),
    ];
    renderApp(<MyRequestsContainer />, { path: '/solicitudes' });

    await screen.findByText('No puedo exportar reportes');
    expect(screen.getByText('Necesitamos tu respuesta (2 preguntas)')).toBeInTheDocument();
    expect(screen.getByText('Otra solicitud')).toBeInTheDocument();
  });

  it('shows an empty state with a CTA to /solicitudes/nueva when there are no requests', async () => {
    setCurrentLogin('ana');
    me = { login: 'ana', role: 'requester' };
    tickets = [];
    renderApp(<MyRequestsContainer />, { path: '/solicitudes' });

    expect(await screen.findByText('Aún no tienes solicitudes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nueva solicitud' })).toBeInTheDocument();
  });

  it('for lead/admin, keeps only tickets the caller itself requested', async () => {
    setCurrentLogin('esteban');
    me = { login: 'esteban', role: 'admin' };
    tickets = [
      ticket({ id: 't1', subject: 'Mine as admin', state: 'received', requesterUserId: 'esteban' }),
      ticket({ id: 't2', subject: 'Filed by someone else', state: 'received', requesterUserId: 'ana' }),
      ticket({ id: 't3', subject: 'OpenProject ticket', state: 'planning', requesterUserId: undefined }),
    ];
    renderApp(<MyRequestsContainer />, { path: '/solicitudes' });

    await screen.findByText('Mine as admin');
    expect(screen.queryByText('Filed by someone else')).not.toBeInTheDocument();
    expect(screen.queryByText('OpenProject ticket')).not.toBeInTheDocument();
  });
});
