import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders, createQueryClient } from '@/app/providers';
import { createAppRouter } from '@/app/router';
import './styles.css';

const queryClient = createQueryClient();
const router = createAppRouter(queryClient);

const root = document.getElementById('root');
if (!root) throw new Error('missing #root element');

createRoot(root).render(
  <StrictMode>
    <AppProviders client={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
