// ========================================================================
// 采集系统 - 存储策略决策器
// ========================================================================

import { getStorageStrategyConfig } from './config.js';
import { logger } from '../../../core/logger.js';
import type { StorageStrategyConfig } from '../types.js';

export interface VideoMetadataForDecision {
  externalId: string;
  title: string;
  publishedAt?: string;
  fetchedAt?: string;
  viewCount?: number;
  duration?: number;
}

export type StorageMode = 'hotlink' | 'r2_transfer';

/**
 * 存储策略决策器
 *
 * 决策规则：
 * 1. growthMode === 'rapid'（新站快速增长期）→ 全部热链，零存储成本快速铺量
 * 2. mode === 'hotlink_only' → 全部热链
 * 3. mode === 'r2_only' → 全部转存
 * 4. mode === 'hybrid'（混合模式）：
 *    a. 最新 N 天内发布的视频 → R2 转存
 *    b. 热门视频（viewCount >= threshold）→ R2 转存
 *    c. 其余 → 热链
 */
export class StorageDecider {
  private static instance: StorageDecider;

  private constructor() {}

  public static getInstance(): StorageDecider {
    if (!StorageDecider.instance) {
      StorageDecider.instance = new StorageDecider();
    }
    return StorageDecider.instance;
  }

  /**
   * 决定某个视频用哪种方式入库
   */
  async decideStorageMode(videoMetadata: VideoMetadataForDecision): Promise<StorageMode> {
    const config = await getStorageStrategyConfig();
    
    const mode = this.applyRules(config, videoMetadata);
    
    logger.debug(
      { 
        externalId: videoMetadata.externalId, 
        mode,
        strategyMode: config.mode,
        growthMode: config.growthMode,
      },
      '存储策略决策完成',
    );
    
    return mode;
  }

  /**
   * 批量决策（用于批量导入场景）
   */
  async decideStorageModes(videos: VideoMetadataForDecision[]): Promise<Map<string, StorageMode>> {
    const config = await getStorageStrategyConfig();
    const result = new Map<string, StorageMode>();
    
    for (const video of videos) {
      result.set(video.externalId, this.applyRules(config, video));
    }
    
    const hotlinkCount = Array.from(result.values()).filter((m) => m === 'hotlink').length;
    logger.info(
      { total: videos.length, hotlink: hotlinkCount, r2: videos.length - hotlinkCount },
      '批量存储策略决策完成',
    );
    
    return result;
  }

  /**
   * 核心决策规则（纯函数，方便测试）
   */
  private applyRules(config: StorageStrategyConfig, video: VideoMetadataForDecision): StorageMode {
    // 规则 1：新站快速增长期 → 全部热链
    if (config.growthMode === 'rapid') {
      return 'hotlink';
    }

    // 规则 2：纯热链模式
    if (config.mode === 'hotlink_only') {
      return 'hotlink';
    }

    // 规则 3：全量转存模式
    if (config.mode === 'r2_only') {
      return 'r2_transfer';
    }

    // 规则 4：混合模式
    if (config.mode === 'hybrid') {
      // 4a. 最新 N 天内发布的视频 → R2
      const daysToTransfer = config.latestDays ?? 30;
      const referenceDate = video.publishedAt ?? video.fetchedAt;
      
      if (referenceDate) {
        const createdDate = new Date(referenceDate);
        const now = new Date();
        const daysDiff = (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24);
        
        if (daysDiff <= daysToTransfer) {
          return 'r2_transfer';
        }
      }

      // 4b. 热门视频 → R2
      const popularThreshold = config.popularViewThreshold ?? 10000;
      if (video.viewCount && video.viewCount >= popularThreshold) {
        return 'r2_transfer';
      }
    }

    // 默认热链
    return 'hotlink';
  }

  /**
   * 预估转存成本（帮助管理员做预算决策）
   */
  async estimateTransferCost(
    videos: Array<{ duration?: number }>,
  ): Promise<{
    estimatedStorageGB: number;
    estimatedMonthlyCostUSD: number;
    exceedsBudget: boolean;
  }> {
    const config = await getStorageStrategyConfig();
    
    // 经验值：平均码率约 1.8Mbps（高清档），444.8MB / 平均时长
    const AVG_MB_PER_MINUTE = 5.4; // 1.8Mbps ≈ 13.5MB/min 单码率，取 5.4MB/min 作为均值偏保守
    
    const totalMinutes = videos.reduce((sum, v) => sum + (v.duration ?? 0) / 60, 0);
    const estimatedStorageGB = (totalMinutes * AVG_MB_PER_MINUTE) / 1024;
    
    // R2 定价：存储 $0.015/GB/月
    const estimatedMonthlyCostUSD = estimatedStorageGB * 0.015;
    
    const budget = config.monthlyBudgetUSD ?? Infinity;
    
    return {
      estimatedStorageGB: Math.round(estimatedStorageGB * 100) / 100,
      estimatedMonthlyCostUSD: Math.round(estimatedMonthlyCostUSD * 100) / 100,
      exceedsBudget: estimatedMonthlyCostUSD > budget,
    };
  }
}
