// ========================================================================
// 采集系统 - 共享类型定义
// ========================================================================

export type CollectionJobType = 'list_crawl' | 'detail_fetch' | 'play_url_refresh';

export interface CollectedVideoMetadata {
  externalId: number;
  title: string;
  coverUrl?: string;
  duration?: number;
  publishedAt?: string;
  fetchedAt: string;
  [key: string]: unknown;
}

export interface AccountPoolEntry {
  id: string;
  targetSite: string;
  uid: string;
  token: string;
  username?: string;
  isVip: boolean;
  vipExpiresAt?: string | null;
  status: 'active' | 'inactive' | 'banned';
  usageCount: number;
  lastUsedAt?: string | null;
  lastCheckAt?: string | null;
}

export interface StorageStrategyConfig {
  mode: 'hotlink_only' | 'r2_only' | 'hybrid';
  growthMode: 'slow' | 'rapid';
  latestDays?: number;          // 最新 N 天转存
  popularViewThreshold?: number; // 热门视频浏览量阈值
  maxStorageGB?: number;         // 最大存储限制（GB）
  monthlyBudgetUSD?: number;     // 月度预算（美元）
}

export interface CollectionScheduleConfig {
  enabled: boolean;
  kind: 'gv' | 'mv' | 'tv';
  pageCountPerRun: number;       // 每次抓取页数
  cronExpression?: string;       // 自定义 Cron
  startTime: string;             // 每日执行时间（HH:mm）
  incremental: boolean;          // 增量 vs 全量
}

export interface CollectionPoolConfig {
  minAccountCount: number;       // 最小账号数保护线
  vipWeightMultiplier: number;   // VIP 账号权重倍数
  healthCheckIntervalMinutes: number;
  autoRemoveFailedAfterAttempts: number;
}
