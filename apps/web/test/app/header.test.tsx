import type { MeResponse } from '@ai-delivery-hub/contracts';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setCurrentLogin } from '@/app/current-user';
import { Header } from '@/app/Header';
import { renderApp } from '../containers/render-app';

let role: MeResponse['role'] = 'dev';
const server = setupServer(http.get('*/api/me', () => HttpResponse.json({ login: 'user', role } satisfies MeResponse)));

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => setCurrentLogin('user'));

describe('Header nav', () => {
  it('shows Bandeja, Tablero and Ejecuciones to a dev', async () => {
    role = 'dev';
    renderApp(<Header />, { path: '/inbox' });
    await waitFor(() => expect(screen.getByText('user · dev')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Bandeja' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tablero' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ejecuciones' })).toBeInTheDocument();
  });

  it('hides Bandeja, Tablero and Ejecuciones from a requester, keeping the request links', async () => {
    role = 'requester';
    renderApp(<Header />, { path: '/inbox' });
    await waitFor(() => expect(screen.getByText('user · requester')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'Bandeja' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tablero' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ejecuciones' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nueva solicitud' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mis solicitudes' })).toBeInTheDocument();
  });
});
