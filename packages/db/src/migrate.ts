import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { createPool } from './client.js';
import { loadDbEnv } from './env.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  loadDbEnv();
  const pool = createPool({ max: 1 });
  const db = drizzle(pool);

  const migrationsFolder = path.join(packageRoot, 'drizzle');
  if (!fs.existsSync(migrationsFolder)) {
    console.error(`找不到迁移目录 ${migrationsFolder}，请先执行 npm run db:generate`);
    process.exit(1);
  }

  console.log('正在应用结构迁移…');
  await migrate(db, { migrationsFolder });
  console.log('结构迁移完成。');

  const postSqlPath = path.join(packageRoot, 'sql', 'post-migrate.sql');
  if (fs.existsSync(postSqlPath)) {
    console.log('正在应用扩展与索引（post-migrate.sql）…');
    const raw = fs.readFileSync(postSqlPath, 'utf8');
    // 按分号切分并逐句执行，失败时能准确报出是哪一句。
    const statements = raw
      .split(/;\s*$/m)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.split('\n').every((line) => line.trim().startsWith('--')));

    for (const statement of statements) {
      try {
        await db.execute(sql.raw(statement));
      } catch (error) {
        console.error('执行失败的语句：\n', statement);
        throw error;
      }
    }
    console.log(`扩展与索引应用完成（${statements.length} 条语句）。`);
  }

  await pool.end();
  console.log('数据库已就绪。');
}

main().catch((error) => {
  console.error('迁移失败：', error);
  process.exit(1);
});
