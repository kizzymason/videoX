// ========================================================================
// 采集系统 - 热链代理服务
// ========================================================================

import { and, eq } from 'drizzle-orm';
import { db, t } from '../../../core/db.js';
import { logger } from '../../../core/logger.js';
import { AccountPoolManager } from '../pool-manager.js';
import { createClientFromAccount } from '../yitongkan/api-client.js';

/**
 * 热链播放地址缓存（内存 + TTL）
 * 源站账号 token 用来向源站换 m3u8；播放器拿到的是 CDN 地址，与号池 token 脱钩。
 * 更新 account_pools.token 不会踢掉正在播的流，也故意不失效这里的缓存。
 * 源站 token 有效期约 5 分钟，缓存 4 分钟留安全余量。
 */
const CACHE_TTL_MS = 4 * 60 * 1000;

interface CacheEntry {
  url: string;
  qualities: Array<{ label: string; url: string }>;
  expiresAt: number;
}

const playUrlCache = new Map<string, CacheEntry>();

// 定期清理过期缓存，防止内存泄漏
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of playUrlCache) {
    if (entry.expiresAt < now) playUrlCache.delete(key);
  }
}, 60_000).unref();

/**
 * 热链代理服务
 *
 * 核心思路（参考 caiji/yitongkan_dev_reference.md 4.2 节）：
 * - 不代理视频流，只在播放请求时向源站换取 m3u8 地址
 * - 用户浏览器直接请求源站 CDN，零带宽成本
 * - 源站 Referer 检测为零，token 有效期 >= 5 分钟，支持多用户共享同一 m3u8
 * - 用号池轮换取地址，避免单账号高频触发风控
 */
export class HotlinkProxyService {
  private static instance: HotlinkProxyService;

  private constructor() {}

  public static getInstance(): HotlinkProxyService {
    if (!HotlinkProxyService.instance) {
      HotlinkProxyService.instance = new HotlinkProxyService();
    }
    return HotlinkProxyService.instance;
  }

  /**
   * 获取热链播放地址（带缓存）
   */
  async getPlayUrl(collectedVideoId: string): Promise<{
    url: string;
    qualities: Array<{ label: string; url: string }>;
    cached: boolean;
  }> {
    // 1. 查缓存
    const cached = playUrlCache.get(collectedVideoId);
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug({ collectedVideoId }, '热链播放地址命中缓存');
      return { url: cached.url, qualities: cached.qualities, cached: true };
    }

    // 2. 查数据库拿外部 ID
    const collected = await db
      .select()
      .from(t.collectedVideos)
      .where(eq(t.collectedVideos.id, collectedVideoId))
      .limit(1);

    if (collected.length === 0) {
      throw new Error(`采集视频记录不存在: ${collectedVideoId}`);
    }

    const record = collected[0];

    // 3. 从号池取账号并向源站换取播放地址
    const fresh = await this.fetchExternalPlayUrl(
      record.externalId,
      record.kind,
      record.targetSite,
    );

    // 4. 写缓存
    playUrlCache.set(collectedVideoId, {
      url: fresh.url,
      qualities: fresh.qualities,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    // 5. 回写数据库（便于审计与离线分析）
    await db
      .update(t.collectedVideos)
      .set({
        externalPlayUrl: fresh.url,
        lastFetchedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(t.collectedVideos.id, collectedVideoId));

    return { url: fresh.url, qualities: fresh.qualities, cached: false };
  }

  /**
   * 获取多个视频的播放地址（批量，用于后台预取）
   */
  async getPlayUrls(collectedVideoIds: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    for (const id of collectedVideoIds) {
      try {
        const { url } = await this.getPlayUrl(id);
        result.set(id, url);
      } catch (error) {
        logger.warn({ collectedVideoId: id, err: error }, '批量获取播放地址失败，跳过');
      }
    }

    return result;
  }

  /**
   * 直接按外部 ID 获取播放地址（不经过 collectedVideos 表）
   */
  async fetchExternalPlayUrl(
    externalId: string,
    kind: string,
    targetSite: string,
  ): Promise<{
    url: string;
    qualities: Array<{ label: string; url: string }>;
  }> {
    // 1. 号池取账号
    const poolManager = AccountPoolManager.getInstance();
    const account = await poolManager.getAvailableAccount(targetSite);

    if (!account) {
      throw new Error('号池中无可用账号，无法获取热链地址');
    }

    // 2. 调源站 play API
    const client = createClientFromAccount(account);
    const playResult = await client.getPlayUrl(Number(externalId), kind as 'gv' | 'mv' | 'tv');

    if (playResult.code !== '200' || !playResult.data?.url) {
      throw new Error(`源站返回异常: ${playResult.code} ${playResult.message ?? ''}`);
    }

    return {
      url: playResult.data.url,
      qualities: (playResult.data.qualities ?? []).map((q: { label: string; url: string }) => ({
        label: q.label,
        url: q.url,
      })),
    };
  }

  /**
   * 清除指定视频的播放地址缓存
   */
  invalidateCache(collectedVideoId: string): void {
    playUrlCache.delete(collectedVideoId);
  }

  /**
   * 缓存统计（用于 Dashboard 展示）
   */
  getCacheStats(): { size: number; hitRateWindow: number } {
    return { size: playUrlCache.size, hitRateWindow: 0 };
  }
}
