/**
 * 周期任务的执行体。
 *
 * 逻辑本身分散在各业务模块里（谁的数据谁维护），这里只做汇总导出，
 * 让 worker 有一个稳定的入口，不必深入 api 的目录结构。
 */
export { aggregateDailyStats } from '../admin/dashboard.js';
export { decayAffinity, refreshVideoQuality } from '../recommend/service.js';
export { pruneRefreshTokens } from '../auth/service.js';
export { expireSubscriptions } from '../membership/service.js';
export { pruneStaleUploads } from '../uploads/service.js';
export { getAlgoWeights } from '../settings/service.js';
