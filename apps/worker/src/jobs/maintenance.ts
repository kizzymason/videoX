import type { Job } from 'bullmq';
import {
  aggregateDailyStats,
  decayAffinity,
  expireSubscriptions,
  getAlgoWeights,
  pruneRefreshTokens,
  pruneStaleUploads,
  refreshVideoQuality,
} from '@videox/api/maintenance';
import type { MaintenanceJobData } from '@videox/api/core/queue';
import { logger } from '../logger.js';

export async function runMaintenanceJob(job: Job<MaintenanceJobData>): Promise<void> {
  const { task } = job.data;
  const started = Date.now();

  switch (task) {
    case 'aggregate_stats': {
      // 回补 3 天：迟到的埋点与跨时区的边界数据都会落在这个窗口里。
      await aggregateDailyStats(3);
      break;
    }
    case 'decay_affinity': {
      const weights = await getAlgoWeights();
      await decayAffinity(weights.affinityHalfLifeDays);
      break;
    }
    case 'prune_tokens': {
      const [tokens, uploads, subscriptions] = await Promise.all([
        pruneRefreshTokens(),
        pruneStaleUploads(),
        expireSubscriptions(),
      ]);
      logger.info({ tokens, uploads, subscriptions }, '清理完成');
      break;
    }
    case 'refresh_quality': {
      await refreshVideoQuality();
      break;
    }
    default: {
      logger.warn({ task }, '未知的周期任务');
      return;
    }
  }

  logger.info({ task, ms: Date.now() - started }, '周期任务完成');
}
