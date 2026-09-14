import type { MeResponse, TicketListResponse } from '@ai-delivery-hub/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setCurrentLogin } from '@/app/current-user';
import { InboxContainer } from '@/features/inbox/InboxContainer';
import { ticket } from '../fixtures/ticket';
import { renderApp } from './render-app';

const all = [
  ticket({ id: 'mine', subject: 'Mine to approve', state: 'plan_review', ownerUserId: 'esteban', priority: 'high' }),
  ticket({ id: 'theirs', subject: 'Someone else plans', state: 'planning', ownerUserId: 'ana' }),
  ticket({ id: 'closed', subject: 'Old one', state: 'rejected' }),
];

const server = setupServer(
  http.get('*/api/me', ({ request }) => {
    expect(request.headers.get('X-Hub-User')).toBe('esteban');
    return HttpResponse.json({ login: 'esteban', role: 'dev' } satisfies MeResponse);
  }),
  http.get('*/api/tickets', ({ request }) => {
    const url = new URL(request.url);
    const body: TicketListResponse = { tickets: url.searchParams.get('waitingOn') === 'me' ? [all[0]!] : all };
    return HttpResponse.json(body);
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => setCurrentLogin('esteban'));

describe('InboxContainer', () => {
  it('loads both lists, shows the waiting badge and groups watching without closed tickets', async () => {
    renderApp(<InboxContainer />, { path: '/inbox' });
    await screen.findByText('Mine to approve');
    expect(screen.getByLabelText('1 waiting on you')).toHaveTextContent('1');
    const waitingTab = screen.getByRole('tabpanel');
    expect(within(waitingTab).queryByText('Someone else plans')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /watching/i }));
    await waitFor(() => expect(screen.getByText('Someone else plans')).toBeInTheDocument());
    expect(screen.queryByText('Old one')).not.toBeInTheDocument();
  });

  it('shows the server error message when the list fails', async () => {
    server.use(http.get('*/api/tickets', () => HttpResponse.json({ error: { code: 'unauthorized', message: 'unknown user esteban; add it to repos.yaml roles' } }, { status: 401 })));
    renderApp(<InboxContainer />, { path: '/inbox' });
    expect(await screen.findByText(/unknown user esteban/)).toBeInTheDocument();
  });
});
