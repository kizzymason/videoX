import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
import { loadDbEnv } from './env.js';

export type Database = NodePgDatabase<typeof schema>;

let pool: pg.Pool | null = null;
let database: Database | null = null;

export interface DbOptions {
  connectionString?: string;
  max?: number;
  logger?: boolean;
}

export function createPool(options: DbOptions = {}): pg.Pool {
  const { databaseUrl } = loadDbEnv();
  return new pg.Pool({
    connectionString: options.connectionString ?? databaseUrl,
    max: options.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // 统一用 UTC 存取，避免容器与宿主机时区不一致导致的偏移。
    options: '-c timezone=UTC',
  });
}

/** 进程级单例。API 与 worker 各自持有一个连接池。 */
export function getDb(options: DbOptions = {}): Database {
  if (!database) {
    pool = createPool(options);
    database = drizzle(pool, { schema, logger: options.logger ?? false });
  }
  return database;
}

export function getPool(): pg.Pool {
  if (!pool) getDb();
  return pool!;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    database = null;
  }
}

/** 简单探活，供启动时的健康检查使用。 */
export async function pingDb(): Promise<boolean> {
  try {
    const client = await getPool().connect();
    try {
      await client.query('select 1');
      return true;
    } finally {
      client.release();
    }
  } catch {
    return false;
  }
}
