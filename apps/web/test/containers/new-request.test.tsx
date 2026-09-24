import type { CreateTicketBody, CreateTicketResponse, MeResponse } from '@ai-delivery-hub/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setCurrentLogin } from '@/app/current-user';
import { NewRequestContainer } from '@/features/requests/NewRequestContainer';
import { ticket } from '../fixtures/ticket';
import { renderApp } from './render-app';

const bodies: unknown[] = [];

const server = setupServer(
  http.get('*/api/me', () => HttpResponse.json({ login: 'ana', role: 'requester' } satisfies MeResponse)),
  http.post('*/api/tickets', async ({ request }) => {
    const body = (await request.json()) as CreateTicketBody;
    bodies.push(body);
    const response: CreateTicketResponse = { ticket: ticket({ id: 'new-1', subject: body.title, state: 'received', requesterUserId: 'ana', department: body.intake.department }) };
    return HttpResponse.json(response, { status: 201 });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  setCurrentLogin('ana');
  bodies.length = 0;
});

async function chooseSelectOption(label: string | RegExp, optionName: string | RegExp) {
  await userEvent.click(screen.getByRole('combobox', { name: label }));
  await userEvent.click(await screen.findByRole('option', { name: optionName }));
}

describe('NewRequestContainer', () => {
  it('blocks submit and shows a validation message when required fields are missing', async () => {
    renderApp(<NewRequestContainer />, { path: '/solicitudes/nueva' });
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar solicitud' }));
    expect(bodies).toHaveLength(0);
    expect(await screen.findByText('Este campo es obligatorio')).toBeInTheDocument();
  });

  // Heavier interaction test (six typed fields + two Select flows); a longer timeout keeps it
  // stable under full-suite CPU contention without weakening any assertion.
  it(
    'submits the intake built from the problem-first fields and navigates to /solicitudes',
    async () => {
      renderApp(<NewRequestContainer />, { path: '/solicitudes/nueva' });

      await userEvent.type(await screen.findByLabelText('Título'), 'No puedo exportar reportes de caja');
      await chooseSelectOption('Área', 'Finanzas');
      await userEvent.type(screen.getByLabelText('¿Qué problema tienes?'), 'El sistema no exporta el reporte de caja diario');
      await userEvent.type(screen.getByLabelText('¿A quién afecta?'), 'Todo el equipo de finanzas');
      await chooseSelectOption('¿Con qué frecuencia ocurre?', 'Diaria');
      await userEvent.type(screen.getByLabelText('¿Cómo lo resuelves hoy?'), 'Lo armamos a mano en una planilla');
      await userEvent.type(screen.getByLabelText('¿Qué resultado esperas?'), 'Poder exportar el reporte con un clic');

      await userEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));

      await waitFor(() => expect(bodies).toHaveLength(1));
      const body = bodies[0] as CreateTicketBody;
      expect(body.title).toBe('No puedo exportar reportes de caja');
      expect(body.intake).toMatchObject({
        department: 'finance',
        problem: 'El sistema no exporta el reporte de caja diario',
        affected: 'Todo el equipo de finanzas',
        frequency: 'daily',
        currentWorkaround: 'Lo armamos a mano en una planilla',
        expectedOutcome: 'Poder exportar el reporte con un clic',
      });
      expect(body.description.length).toBeGreaterThan(0);

      expect(await screen.findByText('Solicitud enviada.')).toBeInTheDocument();
    },
    15_000,
  );
});
