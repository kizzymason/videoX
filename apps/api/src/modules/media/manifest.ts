import { PLAY_TOKEN_PARAM } from './play-token.js';

/**
 * 给 m3u8 中的每一条相对 URI 追加播放凭证。
 *
 * 这样做的意义在于：即便有人拿到了 master.m3u8 的内容，里面的分片地址也是
 * 带签名且会过期的，无法长期外链。播放器在续签时会重新拉取 manifest。
 */
export function injectTokenIntoPlaylist(playlist: string, token: string): string {
  const append = (uri: string): string => {
    // 绝对地址（CDN 直链）不动，签名由 CDN 侧策略负责。
    if (/^https?:\/\//i.test(uri)) return uri;
    const [pathPart, hashPart] = uri.split('#');
    const separator = pathPart.includes('?') ? '&' : '?';
    const withToken = `${pathPart}${separator}${PLAY_TOKEN_PARAM}=${encodeURIComponent(token)}`;
    return hashPart ? `${withToken}#${hashPart}` : withToken;
  };

  return playlist
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      // 属性型标签里的 URI="..."（EXT-X-KEY / EXT-X-MAP / EXT-X-MEDIA / I-FRAME 流）
      if (trimmed.startsWith('#')) {
        if (!trimmed.includes('URI="')) return line;
        return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => `URI="${append(uri)}"`);
      }

      // 裸行即媒体/子播放列表地址
      return append(trimmed);
    })
    .join('\n');
}

/**
 * 把 #EXT-X-KEY 的密钥地址改写到当前请求的视频 id 上。
 *
 * 转码时写进 playlist 的是产出那一刻的 videoId；秒传克隆出来的视频复用同一份
 * playlist，如果不改写，播放器就会拿着克隆视频的票据去请求源视频的密钥接口，
 * 被 videoId 绑定校验挡下来。
 */
export function rewriteKeyUri(playlist: string, videoId: string): string {
  return playlist.replace(
    /(URI=")([^"]*\/media\/hls\/)[0-9a-f-]{36}(\/key[^"]*)(")/gi,
    (_m, p1: string, p2: string, p3: string, p4: string) => `${p1}${p2}${videoId}${p3}${p4}`,
  );
}

/**
 * master.m3u8 里只列出已经转码完成的档位。
 * 首档就绪即可播放，后续档位补齐后重写此文件，播放器下次拉取就能看到。
 */
export interface MasterVariant {
  name: string;
  width: number;
  height: number;
  bandwidth: number;
  averageBandwidth?: number;
  codecs?: string;
  frameRate?: number;
}

export function buildMasterPlaylist(variants: MasterVariant[]): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS', ''];

  // 从低到高排列，让播放器的默认起播档位落在低码率上，首屏更快。
  const sorted = [...variants].sort((a, b) => a.bandwidth - b.bandwidth);

  for (const v of sorted) {
    const attrs = [
      `BANDWIDTH=${v.bandwidth}`,
      `AVERAGE-BANDWIDTH=${v.averageBandwidth ?? Math.round(v.bandwidth * 0.85)}`,
      `RESOLUTION=${v.width}x${v.height}`,
      `CODECS="${v.codecs ?? 'avc1.640028,mp4a.40.2'}"`,
    ];
    if (v.frameRate) attrs.push(`FRAME-RATE=${v.frameRate.toFixed(3)}`);
    lines.push(`#EXT-X-STREAM-INF:${attrs.join(',')}`);
    lines.push(`${v.name}/index.m3u8`);
  }

  return `${lines.join('\n')}\n`;
}

/** manifest 不允许被缓存，否则续签逻辑会拿到旧 token。 */
export const MANIFEST_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  Pragma: 'no-cache',
} as const;

/**
 * 分片本身内容不可变，可以长缓存；但因为 URL 上带了会过期的 token，
 * 实际有效期不会超过 token 寿命，所以标成 private 且时长取较小值。
 */
export const SEGMENT_CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=600, immutable',
} as const;
