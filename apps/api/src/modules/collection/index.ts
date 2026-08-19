// ========================================================================
// 采集系统 - 模块统一出口
// worker 与其他模块通过 @videox/api/collection 导入
// ========================================================================

// 队列与任务类型
export {
  QUEUE_COLLECTION,
  getCollectionQueue,
  getCollectionQueueEvents,
  enqueueCollectionJob,
  markJobRunning,
  markJobCompleted,
  markJobFailed,
  markJobRetry,
  getQueueStats,
  closeCollectionQueue,
  type CollectionJobData,
  type CollectionJobType,
  type ListCrawlJobData,
  type DetailFetchJobData,
  type PlayUrlRefreshJobData,
  type R2TransferJobData,
  type CollectionBullmqJob,
} from './queues/tasks.js';

// 号池管理
export { AccountPoolManager } from './pool-manager.js';

// Yitongkan API 客户端
export { YitongKanApiClient, createClientFromAccount } from './yitongkan/api-client.js';

// 入库处理器
export {
  upsertCollectedVideo,
  batchUpsertCollectedVideos,
  getCollectedVideoByExternalId,
  markAsImported,
  getPendingImportVideos,
  type UpsertCollectedVideoParams,
} from './storage/ingestor.js';

// 存储策略
export { StorageDecider, type VideoMetadataForDecision, type StorageMode } from './storage/decider.js';

// 热链代理
export { HotlinkProxyService } from './storage/hotlink-proxy.js';

// R2 转存
export { R2TransferService } from './storage/r2-transfer.js';

// 导入发布
export {
  fromExternalImport,
  batchFromExternalImport,
  unpublishCollectedVideo,
} from './storage/import.js';

// 配置
export {
  getCollectionConfig,
  setCollectionConfig,
  getStorageStrategyConfig,
  setStorageStrategyConfig,
  getScheduleConfig,
  setScheduleConfig,
  getPoolConfig,
  setPoolConfig,
} from './storage/config.js';

// 调度器
export {
  scheduleCollectionTasks,
  stopScheduledTasks,
  triggerManualTask,
} from './scheduler.js';

// 共享类型
export type {
  CollectedVideoMetadata,
  AccountPoolEntry,
  StorageStrategyConfig,
  CollectionScheduleConfig,
  CollectionPoolConfig,
} from './types.js';
