import type { MeResponse, RunsResponse } from '@ai-delivery-hub/contracts';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCurrentLogin } from '@/app/current-user';
import { RunsContainer } from '@/features/runs/RunsContainer';
import { renderApp } from './render-app';

const runsHandler = vi.fn();

const server = setupServer(
  http.get('*/api/me', () => HttpResponse.json({ login: 'esteban', role: 'dev' } satisfies MeResponse)),
  http.get('*/api/runs', () => {
    runsHandler();
    const body: RunsResponse = { runs: [] };
    return HttpResponse.json(body);
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  runsHandler.mockClear();
});
afterAll(() => server.close());
beforeEach(() => setCurrentLogin('esteban'));

describe('RunsContainer', () => {
  it('redirects a requester to /solicitudes without ever calling GET /api/runs (403 on the server)', async () => {
    server.use(http.get('*/api/me', () => HttpResponse.json({ login: 'esteban', role: 'requester' } satisfies MeResponse)));
    const { router } = renderApp(<RunsContainer />, { path: '/runs' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/solicitudes'));
    expect(runsHandler).not.toHaveBeenCalled();
  });

  it('a dev does call GET /api/runs and sees the empty state', async () => {
    renderApp(<RunsContainer />, { path: '/runs' });
    await screen.findByText('Aún no hay ejecuciones');
    expect(runsHandler).toHaveBeenCalled();
  });
});
