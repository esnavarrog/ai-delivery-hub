import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { Header } from '@/app/Header';
import { useCurrentLogin } from '@/app/current-user';
import { EmptyState } from '@/ui/empty-state';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: () => <EmptyState title="Page not found">There is nothing at this address.</EmptyState>,
});

function RootLayout() {
  const login = useCurrentLogin();
  return (
    <div className="min-h-dvh">
      <Header />
      <main className="mx-auto w-full max-w-7xl px-[var(--gutter)] py-6">
        {login.length === 0 ? (
          <EmptyState title="Pick a user to continue">
            Phase 1 uses development auth. Choose or type a login in the header; its role comes from <span className="font-mono">repos.yaml</span>.
          </EmptyState>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}
