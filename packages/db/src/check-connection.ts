import pg from 'pg';
import { loadDbEnv } from './env.js';

/** 连接自检：只打印非敏感字段，方便定位「连到了哪个库」这类问题。 */
async function main() {
  const { databaseUrl, repoRoot } = loadDbEnv();
  const parsed = new URL(databaseUrl);
  console.log('仓库根目录:', repoRoot);
  console.log('目标主机  :', parsed.hostname);
  console.log('目标端口  :', parsed.port || '5432');
  console.log('目标数据库:', parsed.pathname.replace(/^\//, ''));
  console.log('登录用户  :', parsed.username);
  console.log('是否带密码:', parsed.password.length > 0 ? `是（${parsed.password.length} 位）` : '否');

  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const res = await client.query('select current_user, current_database(), version()');
    console.log('连接成功:', res.rows[0]);
    await client.end();
  } catch (error) {
    console.error('连接失败:', (error as Error).message);
    process.exitCode = 1;
  }
}

void main();
