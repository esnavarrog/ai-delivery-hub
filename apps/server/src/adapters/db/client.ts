import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

/**
 * node-postgres (`pg`) is the single driver: pg-boss already depends on it, Drizzle's
 * `node-postgres` dialect targets it, and its Pool supports the dedicated LISTEN connection
 * SSE may use later, so a second driver (postgres.js) would only add surface.
 */
export function createDb(connectionString: string, poolSize = 10): DbHandle {
  const pool = new pg.Pool({ connectionString, max: poolSize });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
