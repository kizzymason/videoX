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

// .env 优先。开发态缺失的键回落到 .env.example，方便克隆即跑。
// 生产态禁止回落，避免漏配 .env 时带着 example 里的 dev_* 密钥启动。
dotenv.config({ path: path.join(REPO_ROOT, '.env'), quiet: true });
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: path.join(REPO_ROOT, '.env.example'), quiet: true });
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(4000),
  /** 0 或 1 为单进程；>1 时用 cluster 起多个 worker 吃满多核。 */
  API_CLUSTER_WORKERS: z.coerce.number().int().min(0).max(32).default(0),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  /** 每个进程的 PG 连接上限。cluster 下要保证 进程数 × 上限 < PG max_connections。 */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),

  /**
   * 设为 nginx 内部 location（如 /__accel）后，本地盘的分片与静态资源改由反代
   * sendfile 发出，Node 只做鉴权。留空则维持 Node 自己 pipe 文件流。
   */
  MEDIA_ACCEL_PREFIX: z.string().default(''),

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

const SECRET_FIELDS = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'PLAY_TOKEN_SECRET',
  'HLS_KEY_SECRET',
  'COOKIE_SECRET',
] as const;

function isInsecureSecret(value: string): boolean {
  const v = value.toLowerCase();
  return v.startsWith('dev_') || v.includes('change_me');
}

if (raw.NODE_ENV === 'production') {
  const bad = SECRET_FIELDS.filter((key) => isInsecureSecret(raw[key]));
  if (bad.length > 0) {
    console.error('生产环境拒绝默认密钥。请用 `openssl rand -hex 32` 写入 .env 后重启：');
    for (const key of bad) console.error(`  ${key}`);
    process.exit(1);
  }
}

function absolute(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(REPO_ROOT, p);
}

function toOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  isDev: raw.NODE_ENV === 'development',
  // 未上证书前用 http://IP 访问时不能写 Secure cookie，否则浏览器会丢登录态。
  cookieSecure:
    isHttpsUrl(raw.API_PUBLIC_URL) ||
    isHttpsUrl(raw.SITE_PUBLIC_URL) ||
    isHttpsUrl(raw.ADMIN_PUBLIC_URL),
  storageRoot: absolute(raw.STORAGE_LOCAL_ROOT),
  uploadTmpDir: absolute(raw.UPLOAD_TMP_DIR),
  /** CORS 白名单：三个前端 + 本机常见变体。只比 origin，路径 /m /admin 不进比对。 */
  corsOrigins: [
    toOrigin(raw.API_PUBLIC_URL),
    toOrigin(raw.SITE_PUBLIC_URL),
    toOrigin(raw.MOBILE_PUBLIC_URL),
    toOrigin(raw.ADMIN_PUBLIC_URL),
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://127.0.0.1:5175',
  ].filter((v, i, arr) => v && arr.indexOf(v) === i),
} as const;

export type Env = typeof env;
