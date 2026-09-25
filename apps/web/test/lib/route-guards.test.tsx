import type { MeResponse } from '@ai-delivery-hub/contracts';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setCurrentLogin } from '@/app/current-user';
import { useRedirectRequesterAway } from '@/lib/route-guards';
import { renderApp } from '../containers/render-app';

function Guarded() {
  const hidden = useRedirectRequesterAway('/solicitudes');
  if (hidden) return null;
  return <p>protected content</p>;
}

let role: MeResponse['role'] = 'requester';
const server = setupServer(http.get('*/api/me', () => HttpResponse.json({ login: 'user', role } satisfies MeResponse)));

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => setCurrentLogin('user'));

describe('useRedirectRequesterAway', () => {
  it('hides the content and redirects a requester to the given path', async () => {
    role = 'requester';
    const { router } = renderApp(<Guarded />, { path: '/inbox' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/solicitudes'));
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('lets a non-requester through', async () => {
    role = 'dev';
    renderApp(<Guarded />, { path: '/inbox' });
    expect(await screen.findByText('protected content')).toBeInTheDocument();
  });
});
