import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../drizzle/', import.meta.url));

/** Applies the SQL migrations in `apps/server/drizzle` to the database at `connectionString`. */
export async function runMigrations(connectionString: string): Promise<void> {
  const handle = createDb(connectionString, 1);
  try {
    await migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await handle.close();
  }
}
