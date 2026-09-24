/**
 * 采集视频「自动导入」的共享规则。
 *
 * 放在 shared 是因为后台要用同一套边界值渲染表单、API 要用同一套判定落库，
 * 两边各写一份迟早走偏。这里只有纯函数与常量，不碰数据库。
 */

export const COLLECTED_STATUSES = ['pending', 'imported', 'updating', 'archived', 'failed'] as const;
export type CollectedStatus = (typeof COLLECTED_STATUSES)[number];

export const AUTO_IMPORT_BATCH_MIN = 1;
export const AUTO_IMPORT_BATCH_MAX = 80;
export const AUTO_IMPORT_INTERVAL_MIN = 1;
export const AUTO_IMPORT_INTERVAL_MAX = 1440;
export const AUTO_IMPORT_ATTEMPTS_MIN = 1;
export const AUTO_IMPORT_ATTEMPTS_MAX = 10;

export interface CollectionAutoImportConfig {
  /** 关掉后采集照跑，只是不自动入库，等管理员手动导入。 */
  enabled: boolean;
  /** 入库即公开；关掉则先 unlisted 等审核。 */
  autoPublish: boolean;
  /** 单轮最多导入多少条，避免一次占满 worker。 */
  batchSize: number;
  /** 轮询间隔（分钟）。调度器每分钟醒一次，按这个值决定是否真的跑。 */
  intervalMinutes: number;
  /** 同一条记录最多试几次，超过判定为失效不再重试。 */
  maxAttempts: number;
  /** auto = 按存储策略自动决定热链还是转存。 */
  forceMode: 'auto' | 'hotlink' | 'r2_transfer';
}

export const DEFAULT_AUTO_IMPORT_CONFIG: CollectionAutoImportConfig = {
  enabled: true,
  autoPublish: true,
  batchSize: 40,
  intervalMinutes: 10,
  maxAttempts: 3,
  forceMode: 'auto',
};

export type ImportFailureKind = 'permanent' | 'transient';

/**
 * 源站把片子删了、记录本身不存在这类错误，再试一百次也是同样结果，
 * 直接判死后置成 failed，否则「导入全部」会被这几条永远卡住。
 *
 * 数字用 \b 兜住：外部 ID 里的 404/500 是数字串的一部分，不该被当成状态码。
 */
const PERMANENT_PATTERNS: RegExp[] = [
  /\b404\b/,
  /\b410\b/,
  /not found/i,
  /记录不存在/,
  /不存在或已/,
  /已下架/,
  /已删除/,
  /deleted/i,
  /removed/i,
  /invalid video/i,
];

const TRANSIENT_PATTERNS: RegExp[] = [
  /\b408\b/,
  /\b425\b/,
  /\b429\b/,
  /\b5\d{2}\b/,
  /timeout/i,
  /timed out/i,
  /ECONN/i,
  /EAI_AGAIN/i,
  /ETIMEDOUT/i,
  /socket hang up/i,
  /fetch failed/i,
  /network/i,
  /号池/,
  /无可用账号/,
  /token/i,
  /transient/i,
  /rate limit/i,
  /too many/i,
];

export function classifyImportFailure(message: string): ImportFailureKind {
  const text = message ?? '';
  if (PERMANENT_PATTERNS.some((re) => re.test(text))) return 'permanent';
  if (TRANSIENT_PATTERNS.some((re) => re.test(text))) return 'transient';
  // 认不出来的按可重试处理：最多再试 maxAttempts 次就会自动转 failed，不会永久堆积。
  return 'transient';
}

/** 这一次失败之后该不该判定为失效（不再重试）。 */
export function shouldGiveUpImport(params: {
  message: string;
  attempts: number;
  maxAttempts: number;
}): boolean {
  if (classifyImportFailure(params.message) === 'permanent') return true;
  return params.attempts >= Math.max(AUTO_IMPORT_ATTEMPTS_MIN, params.maxAttempts);
}

export function normalizeAutoImportConfig(raw: unknown): CollectionAutoImportConfig {
  const value = (raw ?? {}) as Partial<CollectionAutoImportConfig>;
  const clamp = (n: unknown, min: number, max: number, fallback: number) => {
    const num = Number(n);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, Math.round(num)));
  };
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_AUTO_IMPORT_CONFIG.enabled,
    autoPublish:
      typeof value.autoPublish === 'boolean' ? value.autoPublish : DEFAULT_AUTO_IMPORT_CONFIG.autoPublish,
    batchSize: clamp(value.batchSize, AUTO_IMPORT_BATCH_MIN, AUTO_IMPORT_BATCH_MAX, DEFAULT_AUTO_IMPORT_CONFIG.batchSize),
    intervalMinutes: clamp(
      value.intervalMinutes,
      AUTO_IMPORT_INTERVAL_MIN,
      AUTO_IMPORT_INTERVAL_MAX,
      DEFAULT_AUTO_IMPORT_CONFIG.intervalMinutes,
    ),
    maxAttempts: clamp(
      value.maxAttempts,
      AUTO_IMPORT_ATTEMPTS_MIN,
      AUTO_IMPORT_ATTEMPTS_MAX,
      DEFAULT_AUTO_IMPORT_CONFIG.maxAttempts,
    ),
    forceMode:
      value.forceMode === 'hotlink' || value.forceMode === 'r2_transfer'
        ? value.forceMode
        : DEFAULT_AUTO_IMPORT_CONFIG.forceMode,
  };
}
