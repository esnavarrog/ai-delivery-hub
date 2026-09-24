import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { createAppRouter } from '@/app/router';

const routesById = createAppRouter(new QueryClient()).routesById as unknown as Record<string, { parentRoute?: { id: string } } | undefined>;

describe('route tree', () => {
  // Page routes render standalone components without <Outlet/>, so nesting one under another hides the child page.
  it.each(['/solicitudes/', '/solicitudes/nueva'])('%s is a leaf page mounted directly under the root layout', (id) => {
    expect(routesById[id], `route ${id} exists`).toBeDefined();
    expect(routesById[id]?.parentRoute?.id).toBe('__root__');
  });
});
