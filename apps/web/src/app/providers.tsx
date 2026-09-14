import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Toaster } from '@/ui/sonner';
import { TooltipProvider } from '@/ui/tooltip';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, staleTime: 5_000, refetchOnWindowFocus: true },
      mutations: { retry: 0 },
    },
  });
}

export function AppProviders({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const [queryClient] = useState(() => client ?? createQueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      <Toaster position="bottom-right" richColors closeButton />
    </QueryClientProvider>
  );
}
