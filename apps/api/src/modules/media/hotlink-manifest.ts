// ========================================================================
// 热链视频的多清晰度清单
// ========================================================================
//
// 源站 play 接口一次给出整条码率阶梯（流畅 / 标清 / 高清），但每档都是独立的
// media playlist，没有 master。入库时只存了默认那档（450k 的流畅），于是所有
// 用户都只能看 480p。
//
// 这里在播放时按档位现拼一个 master，分档 URI 指回我们自己的
// /hls/:videoId/qN/index.m3u8：播放器每次取分档清单都会重新向源站换一次地址，
// 所以 token 不会因为页面开得久而失效；分片仍然由浏览器直连源站 CDN，零带宽成本。
//
// 实测（2026-11-01，ffprobe 首分片）：
//   450k → 854x480，900k → 1280x720，1800k → 1920x1080。
// 路径上的数字就是 kbps，源站不同片源会有 400/450 这类小差异。

export interface HotlinkQuality {
  label: string;
  url: string;
}

export interface HotlinkVariant {
  /** 分档在 qualities 数组里的下标，用作分档 URI 的后缀。 */
  index: number;
  label: string;
  /** 分档 URI 的目录名，形如 q0 / q1 / q2。 */
  name: string;
  width: number;
  height: number;
  bandwidth: number;
}

/** 从分档地址里取码率（源站把 kbps 写在路径上：.../1800/index.m3u8）。 */
export function bitrateKbpsOf(url: string): number {
  const match = /\/(\d+)\/index\.m3u8(?:[?#]|$)/.exec(url);
  const kbps = match ? Number(match[1]) : 0;
  return Number.isFinite(kbps) && kbps > 0 ? kbps : 0;
}

/** 档位标签优先，标签认不出时按码率兜底。 */
export function resolutionFor(label: string, kbps: number): { width: number; height: number } {
  if (/超清|高清|1080/.test(label)) return { width: 1920, height: 1080 };
  if (/标清|720/.test(label)) return { width: 1280, height: 720 };
  if (/流畅|480/.test(label)) return { width: 854, height: 480 };
  if (kbps >= 1500) return { width: 1920, height: 1080 };
  if (kbps >= 700) return { width: 1280, height: 720 };
  return { width: 854, height: 480 };
}

export function hotlinkVariants(qualities: HotlinkQuality[]): HotlinkVariant[] {
  return qualities.map((quality, index) => {
    const kbps = bitrateKbpsOf(quality.url);
    const { width, height } = resolutionFor(quality.label, kbps);
    return {
      index,
      label: quality.label,
      name: `q${index}`,
      width,
      height,
      // 拿不到码率时按分辨率估一个，够播放器排序用。
      bandwidth: kbps > 0 ? kbps * 1000 : Math.round(width * height * 0.15),
    };
  });
}

/**
 * 拼 master。低码率排在前面让起播更快，之后交给播放器 ABR 逐级升档；
 * 档位目录名（q0/q1/q2）保持原始下标，排序不会打乱对应关系。
 */
export function buildHotlinkMaster(qualities: HotlinkQuality[]): string {
  const variants = hotlinkVariants(qualities).sort((a, b) => a.bandwidth - b.bandwidth);
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-INDEPENDENT-SEGMENTS', ''];
  for (const variant of variants) {
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth},RESOLUTION=${variant.width}x${variant.height}`,
      `${variant.name}/index.m3u8`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * 把 media playlist 里的相对地址补成绝对地址。
 *
 * 源站的密钥 URI 是相对的（URI="key.key"），分片在不同 CDN 域名上；
 * 清单由我们转发，如果不补绝对地址，播放器会拿我们的域名去取分片。
 */
export function absolutizePlaylist(playlist: string, baseUrl: string): string {
  const abs = (uri: string) => (/^https?:/i.test(uri) ? uri : new URL(uri, baseUrl).toString());
  return playlist
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return trimmed.replace(/URI="([^"]+)"/g, (_match, uri: string) => `URI="${abs(uri)}"`);
      }
      return abs(trimmed);
    })
    .join('\n');
}
