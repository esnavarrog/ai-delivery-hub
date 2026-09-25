import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProviders } from '@/app/providers';

/** Renders `element` at `path` inside a memory router plus the app providers (fresh query client, no retries). */
export function renderApp(element: ReactNode, { path = '/', initialEntries = [path] }: { path?: string; initialEntries?: string[] } = {}) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const pageRoute = createRoute({ getParentRoute: () => rootRoute, path, component: () => <>{element}</> });
  const ticketRoute = createRoute({ getParentRoute: () => rootRoute, path: '/tickets/$id', component: () => <p>ticket page</p> });
  const planRoute = createRoute({ getParentRoute: () => rootRoute, path: '/tickets/$id/plan', component: () => <p>plan page</p> });
  const solicitudesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/solicitudes', component: () => <p>solicitudes page</p> });
  const routes = [
    pageRoute,
    ...(path === '/tickets/$id' ? [] : [ticketRoute]),
    ...(path === '/tickets/$id/plan' ? [] : [planRoute]),
    ...(path === '/solicitudes' ? [] : [solicitudesRoute]),
  ];
  const router = createRouter({ routeTree: rootRoute.addChildren(routes), history: createMemoryHistory({ initialEntries }) });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false }, mutations: { retry: false } } });
  const utils = render(
    <AppProviders client={client}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...utils, router, client };
}
