import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { Header } from '@/app/Header';
import { useCurrentLogin } from '@/app/current-user';
import { es } from '@/i18n/es';
import { EmptyState } from '@/ui/empty-state';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: () => <EmptyState title={es.root.notFoundTitle}>{es.root.notFoundBody}</EmptyState>,
});

function RootLayout() {
  const login = useCurrentLogin();
  return (
    <div className="min-h-dvh">
      <Header />
      <main className="mx-auto w-full max-w-7xl px-[var(--gutter)] py-6">
        {login.length === 0 ? <EmptyState title={es.root.pickUserTitle}>{es.root.pickUserBody}</EmptyState> : <Outlet />}
      </main>
    </div>
  );
}
