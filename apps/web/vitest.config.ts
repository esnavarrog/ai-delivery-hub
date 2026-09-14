import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    css: false,
  },
});
