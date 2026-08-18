import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'docker-compose.yml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const REPO_ROOT = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));

// .env 优先，缺失的键回落到 .env.example，保证克隆下来就能跑。
dotenv.config({ path: path.join(REPO_ROOT, '.env'), quiet: true });
dotenv.config({ path: path.join(REPO_ROOT, '.env.example'), quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(4000),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  API_PUBLIC_URL: z.string().default('http://localhost:4000'),
  SITE_PUBLIC_URL: z.string().default('http://localhost:5173'),
  MOBILE_PUBLIC_URL: z.string().default('http://localhost:5174'),
  ADMIN_PUBLIC_URL: z.string().default('http://localhost:5175'),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  PLAY_TOKEN_SECRET: z.string().min(16),
  HLS_KEY_SECRET: z.string().min(16),
  COOKIE_SECRET: z.string().min(16),

  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),
  PLAY_TOKEN_TTL_SECONDS: z.coerce.number().int().default(7200),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_ROOT: z.string().default('./storage'),
  UPLOAD_TMP_DIR: z.string().default('./storage/tmp'),

  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  S3_PUBLIC_BASE_URL: z.string().default(''),

  MAX_CONCURRENT_STREAMS: z.coerce.number().int().default(3),
  PLAY_TOKEN_IP_PREFIX_PARTS: z.coerce.number().int().default(3),

  GEOIP_MMDB_PATH: z.string().default(''),

  TRANSCODE_CONCURRENCY: z.coerce.number().int().default(2),
  TRANSCODE_PRESET: z.string().default('veryfast'),
  TRANSCODE_HWACCEL: z.enum(['none', 'nvenc', 'qsv']).default('none'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('环境变量校验失败：');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const raw = parsed.data;

function absolute(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(REPO_ROOT, p);
}

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  isDev: raw.NODE_ENV === 'development',
  storageRoot: absolute(raw.STORAGE_LOCAL_ROOT),
  uploadTmpDir: absolute(raw.UPLOAD_TMP_DIR),
  /** CORS 白名单：三个前端 + 本机常见变体 */
  corsOrigins: [
    raw.SITE_PUBLIC_URL,
    raw.MOBILE_PUBLIC_URL,
    raw.ADMIN_PUBLIC_URL,
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://127.0.0.1:5175',
  ].filter((v, i, arr) => v && arr.indexOf(v) === i),
} as const;

export type Env = typeof env;
