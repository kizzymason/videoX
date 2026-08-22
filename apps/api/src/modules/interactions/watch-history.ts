import { sql } from 'drizzle-orm';
import { WATCH_HISTORY_LIMIT } from '@videox/shared';
import { db } from '../../core/db.js';

/** 每个用户只留最近 keep 条，按 watched_at 倒序。 */
export async function trimWatchHistory(
  userId: string,
  keep = WATCH_HISTORY_LIMIT,
): Promise<void> {
  await db.execute(sql`
    DELETE FROM watch_history
    WHERE user_id = ${userId}::uuid
      AND id NOT IN (
        SELECT id FROM watch_history
        WHERE user_id = ${userId}::uuid
        ORDER BY watched_at DESC
        LIMIT ${keep}
      )
  `);
}
