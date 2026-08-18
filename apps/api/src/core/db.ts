import { getDb, getPool, closeDb, sql, type SQL } from '@videox/db';
import { env } from '../config/env.js';

export const db = getDb({ connectionString: env.DATABASE_URL, max: 20 });
export const pool = getPool();
export { closeDb };
export * as t from '@videox/db/schema';

type Executor = { execute: (query: SQL) => Promise<unknown> };

/**
 * node-postgres 驱动下 `db.execute()` 返回的是 pg 的 QueryResult 而不是行数组，
 * 而 postgres.js 等驱动直接返回数组。原生 SQL 在推荐打分、统计聚合里用得很多，
 * 这里统一收敛成行数组，顺带避免每处都写 `.rows`。
 */
export async function sqlRows<T = Record<string, unknown>>(
  query: SQL,
  executor: Executor = db as unknown as Executor,
): Promise<T[]> {
  const result = (await executor.execute(query)) as T[] | { rows?: T[] };
  return Array.isArray(result) ? result : ((result?.rows ?? []) as T[]);
}

/**
 * 把字符串数组绑成**单个** Postgres 数组参数。
 *
 * 直接写 `${ids}` 时 drizzle 会展开成 `($1, $2, ...)` 的值列表，配合 `= any(...)`
 * 就会拼出非法 SQL，空数组更是直接变成 `()`。sql.param 强制整体绑定，
 * 空数组交给 pg 序列化成 `{}`，语义上就是「谁都不匹配」。
 */
export function uuidArray(ids: readonly string[]): SQL {
  return sql`${sql.param([...ids])}::uuid[]`;
}
