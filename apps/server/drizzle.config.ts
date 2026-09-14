import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/adapters/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env['DATABASE_URL'] ?? 'postgres://hub:hub@localhost:5433/hub' },
});
