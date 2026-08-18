import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createPool } from './client.js';
import { loadDbEnv } from './env.js';

/** 丢弃 public schema 重建。仅用于开发环境重置。 */
async function main() {
  loadDbEnv();
  if (process.env.NODE_ENV === 'production' && process.argv[2] !== '--force') {
    console.error('拒绝在生产环境执行重置。如确需执行请加 --force。');
    process.exit(1);
  }

  const pool = createPool({ max: 1 });
  const db = drizzle(pool);

  console.log('正在删除并重建 public schema…');
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await pool.end();

  console.log('重置完成。接着执行 npm run db:migrate && npm run db:seed。');
}

main().catch((error) => {
  console.error('重置失败：', error);
  process.exit(1);
});
