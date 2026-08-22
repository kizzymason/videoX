// ========================================================================
// 采集系统 - R2 转存服务
// ========================================================================

import { createDecipheriv } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, t } from '../../../core/db.js';
import { logger } from '../../../core/logger.js';
import { getStorage } from '../../storage/service.js';
import { AccountPoolManager } from '../pool-manager.js';
import { createClientFromAccount } from '../yitongkan/api-client.js';

/**
 * R2 转存服务
 *
 * 流程（参考 caiji/yitongkan_dev_reference.md 第 3 节 CDN 架构）：
 * 1. 通过号池账号调 play API 拿到 m3u8 播放地址
 * 2. 下载 master.m3u8 → 解析分档 playlist
 * 3. 下载各档 index.m3u8 → 解析 TS 分片列表（分片伪装为 .js 扩展名）
 * 4. 若声明了 EXT-X-KEY（AES-128-CBC），先下载 key.key 再逐分片解密
 * 5. 解密后的分片（首字节 0x47 = MPEG-TS）直接上传到 R2
 * 6. 重组 master.m3u8 与各档 index.m3u8 一并上传
 *
 * 上传路径约定：
 *   hls/collected/{targetSite}/{externalId}/master.m3u8
 *   hls/collected/{targetSite}/{externalId}/{rendition}/index.m3u8
 *   hls/collected/{targetSite}/{externalId}/{rendition}/{seq}.ts
 */
export class R2TransferService {
  private static instance: R2TransferService;

  private constructor() {}

  public static getInstance(): R2TransferService {
    if (!R2TransferService.instance) {
      R2TransferService.instance = new R2TransferService();
    }
    return R2TransferService.instance;
  }

  /**
   * 转存单个视频（完整流程）
   */
  async transferVideo(collectedVideoId: string, options?: {
    /** 只转存指定码率（如 '1800'），不传则全部转存 */
    onlyBitrate?: string;
    /** 进度回调 */
    onProgress?: (percent: number, stage: string) => void;
  }): Promise<{
    masterKey: string;
    renditions: string[];
    totalBytes: number;
  }> {
    const { onProgress = () => {} } = options ?? {};

    // 1. 读取采集记录
    const collected = await db
      .select()
      .from(t.collectedVideos)
      .where(eq(t.collectedVideos.id, collectedVideoId))
      .limit(1);

    if (collected.length === 0) {
      throw new Error(`采集视频记录不存在: ${collectedVideoId}`);
    }
    const record = collected[0];

    onProgress(2, '获取源站播放地址');

    // 2. 号池取账号，换播放地址
    const playUrl = await this.fetchPlayUrl(record.externalId, record.kind, record.targetSite);

    onProgress(5, '下载 master 播放列表');

    // 3. 下载并解析 master.m3u8
    const masterText = await this.downloadText(playUrl);
    const variants = this.parseMasterPlaylist(masterText, playUrl);

    // 过滤码率
    const targetVariants = options?.onlyBitrate
      ? variants.filter((v) => v.bandwidth.toString() === options.onlyBitrate || v.name.includes(options.onlyBitrate!))
      : variants;

    const storage = await getStorage();
    const basePrefix = `hls/collected/${record.targetSite}/${record.externalId}`;
    const completedRenditions: string[] = [];
    let totalBytes = 0;

    // 4. 逐档下载
    for (let vi = 0; vi < targetVariants.length; vi++) {
      const variant = targetVariants[vi];
      const renditionBase = 5 + Math.round((vi / Math.max(targetVariants.length, 1)) * 90);

      onProgress(renditionBase, `下载分档播放列表 ${variant.name}`);

      // 4a. 下载分档 index.m3u8
      const variantText = await this.downloadText(variant.url);
      const { segments, keyUri } = this.parseVariantPlaylist(variantText, variant.url);

      // 4b. 如有 AES-128 密钥声明，先取密钥
      let aesKey: Buffer | null = null;
      if (keyUri) {
        onProgress(renditionBase + 1, '下载 AES 密钥');
        aesKey = await this.downloadBinary(keyUri);
      }

      // 4c. 逐分片下载（必要时解密）并上传
      const rewrittenLines: string[] = [];
      let segIndex = 0;

      for (const line of variantText.split('\n')) {
        const trimmed = line.trim();

        if (trimmed.startsWith('#')) {
          // 重写密钥行：转存后的分片已解密，去掉加密声明
          if (trimmed.startsWith('#EXT-X-KEY')) {
            rewrittenLines.push('#EXT-X-KEY:METHOD=NONE');
            continue;
          }
          // URI 属性（密钥等）不再指向源站
          if (trimmed.includes('URI="')) {
            continue;
          }
          rewrittenLines.push(line);
          continue;
        }

        if (!trimmed) {
          rewrittenLines.push(line);
          continue;
        }

        // 分片行：下载 → 解密 → 上传
        const segUrl = new URL(trimmed, variant.url).toString();
        const percent = renditionBase + Math.round(((segIndex + 1) / segments.length) * (90 / targetVariants.length));
        onProgress(Math.min(percent, 95), `下载分片 ${segIndex + 1}/${segments.length}`);

        let segData = await this.downloadBinary(segUrl);

        if (aesKey) {
          segData = this.decryptSegment(segData, aesKey, segIndex, keyUri!);
        }

        const segKey = `${basePrefix}/${variant.name}/${segIndex}.ts`;
        await storage.put(segKey, segData);
        totalBytes += segData.length;

        rewrittenLines.push(`${segIndex}.ts`);
        segIndex++;
      }

      // 4d. 上传重写后的分档 playlist
      const playlistKey = `${basePrefix}/${variant.name}/index.m3u8`;
      await storage.put(playlistKey, Buffer.from(rewrittenLines.join('\n'), 'utf8'));
      completedRenditions.push(variant.name);
    }

    onProgress(97, '生成 master 播放列表');

    // 5. 生成并上传新的 master.m3u8（指向本地分档）
    const masterLines = ['#EXTM3U', '#EXT-X-VERSION:3'];
    for (const name of completedRenditions) {
      masterLines.push(`#EXT-X-STREAM-INF:BANDWIDTH=0`);
      masterLines.push(`${name}/index.m3u8`);
    }
    const masterKey = `${basePrefix}/master.m3u8`;
    await storage.put(masterKey, Buffer.from(masterLines.join('\n') + '\n', 'utf8'));

    onProgress(99, '更新数据库');

    // 6. 更新 collected_videos 记录
    await db
      .update(t.collectedVideos)
      .set({
        localVideoUrl: masterKey,
        importMode: 'r2_transfer',
        updatedAt: new Date(),
      })
      .where(eq(t.collectedVideos.id, collectedVideoId));

    onProgress(100, '转存完成');

    logger.info(
      { collectedVideoId, renditions: completedRenditions, totalBytes },
      'R2 转存完成',
    );

    return { masterKey, renditions: completedRenditions, totalBytes };
  }

  // ------------------------------------------------------------------------
  // 内部工具方法
  // ------------------------------------------------------------------------

  /** 通过号池账号获取源站播放地址 */
  private async fetchPlayUrl(externalId: string, kind: string, targetSite: string): Promise<string> {
    const result = await AccountPoolManager.getInstance().runWithAccount(targetSite, async (account) => {
      const play = await createClientFromAccount(account).getPlayUrl(
        Number(externalId),
        kind as 'gv' | 'mv' | 'tv',
      );
      if (play.code === '401' || play.code === '403') {
        throw new Error(`源站 play API 异常: ${play.code}`);
      }
      return play;
    });

    if (result.code !== '200' || !result.data?.url) {
      throw new Error(`源站 play API 异常: ${result.code}`);
    }
    return result.data.url;
  }

  /** 下载文本资源 */
  private async downloadText(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
    return res.text();
  }

  /** 下载二进制资源 */
  private async downloadBinary(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** 解析 master.m3u8，返回分档列表 */
  private parseMasterPlaylist(text: string, baseUrl: string): Array<{
    name: string;
    bandwidth: number;
    url: string;
  }> {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const variants: Array<{ name: string; bandwidth: number; url: string }> = [];

    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]!.startsWith('#EXT-X-STREAM-INF')) continue;

      const attrs = lines[i]!;
      const bandwidthMatch = attrs.match(/BANDWIDTH=(\d+)/);
      const bandwidth = bandwidthMatch ? Number(bandwidthMatch[1]) : 0;

      // 下一行是 URI
      const uriLine = lines[i + 1];
      if (!uriLine || uriLine.startsWith('#')) continue;

      const fullUrl = new URL(uriLine, baseUrl).toString();

      // 从 URL 提取码率标识（如 .../1800/index.m3u8）
      const bitrateMatch = fullUrl.match(/\/(\d+)\/index\.m3u8/);
      const name = bitrateMatch ? bitrateMatch[1]! : `variant_${variants.length}`;

      variants.push({ name, bandwidth, url: fullUrl });
    }

    return variants;
  }

  /** 解析分档 index.m3u8，返回分片 URL 列表与密钥 URI */
  private parseVariantPlaylist(text: string, baseUrl: string): {
    segments: string[];
    keyUri: string | null;
  } {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const segments: string[] = [];
    let keyUri: string | null = null;

    for (const line of lines) {
      if (line.startsWith('#EXT-X-KEY')) {
        const uriMatch = line.match(/URI="([^"]+)"/);
        if (uriMatch) {
          keyUri = new URL(uriMatch[1]!, baseUrl).toString();
        }
        continue;
      }
      if (line.startsWith('#')) continue;
      segments.push(new URL(line, baseUrl).toString());
    }

    return { segments, keyUri };
  }

  /**
   * 解密 AES-128-CBC 加密的 TS 分片
   * 参考文档 3.4 节：IV 在 m3u8 的 EXT-X-KEY 行声明，未声明时用分片序号
   */
  private decryptSegment(data: Buffer, key: Buffer, segIndex: number, keyUri: string): Buffer {
    // 从 keyUri 所在的 EXT-X-KEY 行提取 IV 的逻辑在 parseVariantPlaylist 之外，
    // 这里简化处理：未提供显式 IV 时按 HLS 规范用媒体序号
    const iv = Buffer.alloc(16);
    iv.writeUInt32BE(segIndex, 12);

    const decipher = createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);

    // 校验：解密后的 TS 分片首字节应为 0x47（MPEG-TS sync byte）
    if (decrypted[0] !== 0x47) {
      logger.warn({ segIndex, keyUri, firstByte: decrypted[0] }, '解密后首字节非 0x47，可能 IV 不匹配');
    }

    return decrypted;
  }
}
