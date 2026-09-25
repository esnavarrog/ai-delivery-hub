import type { CommandResponse, MeResponse, TicketDetailResponse } from '@ai-delivery-hub/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setCurrentLogin } from '@/app/current-user';
import { TicketPageContainer } from '@/features/ticket/TicketPageContainer';
import { detail, event, ticket } from '../fixtures/ticket';
import { renderApp } from './render-app';

let current: TicketDetailResponse;
const answerBodies: unknown[] = [];

const server = setupServer(
  http.get('*/api/me', () => HttpResponse.json({ login: 'esteban', role: 'admin' } satisfies MeResponse)),
  http.get('*/api/tickets/t1', () => HttpResponse.json(current)),
  http.post('*/api/tickets/t1/answers', async ({ request }) => {
    answerBodies.push(await request.json());
    current = { ...current, ticket: { ...current.ticket, state: 'triaging' } };
    return HttpResponse.json({ ticket: current.ticket } satisfies CommandResponse);
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  setCurrentLogin('esteban');
  answerBodies.length = 0;
  current = detail({
    ticket: ticket({ state: 'awaiting_requester', ownerUserId: undefined, requesterUserId: 'ana', clarificationRound: 1, pendingQuestionCount: 2 }),
    events: [
      event({ type: 'ticket_received', seq: 1 }),
      event({
        type: 'requester_questions_asked',
        seq: 2,
        actor: { kind: 'ai', id: 'claude' },
        payload: {
          round: 1,
          questions: [
            { id: 'q1-1', text: '¿Cuántas personas usan este flujo hoy?' },
            { id: 'q1-2', text: '¿Qué pasa si no se resuelve este mes?' },
          ],
        },
      }),
    ],
  });
});

describe('TicketPageContainer answer questions flow', () => {
  it('shows the pending questions and posts round + answers to /api/tickets/:id/answers', async () => {
    renderApp(<TicketPageContainer ticketId="t1" />, { path: '/tickets/$id', initialEntries: ['/tickets/t1'] });
    await screen.findByText('Add refund endpoint');

    await userEvent.click(screen.getByRole('button', { name: 'Responder preguntas' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('¿Cuántas personas usan este flujo hoy?');
    expect(dialog).toHaveTextContent('¿Qué pasa si no se resuelve este mes?');

    const textareas = screen.getAllByRole('textbox');
    await userEvent.type(textareas[0]!, 'Unas 40 personas de soporte.');
    await userEvent.type(textareas[1]!, 'Seguimos perdiendo tiempo manualmente cada semana.');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar respuestas' }));

    await waitFor(() =>
      expect(answerBodies).toEqual([
        {
          round: 1,
          answers: [
            { questionId: 'q1-1', text: 'Unas 40 personas de soporte.' },
            { questionId: 'q1-2', text: 'Seguimos perdiendo tiempo manualmente cada semana.' },
          ],
        },
      ]),
    );
    expect(await screen.findByText('Respuestas enviadas. La IA repite el triaje con tu información.')).toBeInTheDocument();
  });
});
