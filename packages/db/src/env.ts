import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/** 从仓库根目录向上找 .env，保证任意 workspace 里执行脚本都能读到同一份配置。 */
export function findRepoRoot(start = path.dirname(fileURLToPath(import.meta.url))): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'docker-compose.yml')) && fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

let loaded = false;

export function loadDbEnv(): { databaseUrl: string; repoRoot: string } {
  const repoRoot = findRepoRoot();
  if (!loaded) {
    dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });
    dotenv.config({ path: path.join(repoRoot, '.env.example'), quiet: true });
    loaded = true;
  }
  const databaseUrl =
    process.env.DATABASE_URL ?? 'postgresql://videox:videox_dev_password@localhost:15433/videox';
  return { databaseUrl, repoRoot };
}
