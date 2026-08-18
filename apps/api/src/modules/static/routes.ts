import { Router } from 'express';
import { asyncHandler } from '../../core/respond.js';

export const staticRouter: Router = Router();

function escapeXml(input: string): string {
  return input.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * 占位封面生成器。
 *
 * 演示数据没有真实素材，直接返回 SVG：体积只有几百字节、无需依赖外部图床，
 * 而且用 hue 参数派生配色，同一条视频每次刷新颜色都一致。
 */
staticRouter.get(
  '/placeholder/:kind',
  asyncHandler(async (req, res) => {
    const kind = req.params.kind === 'banner' ? 'banner' : 'cover';
    const hue = Number(req.query.h ?? 210) % 360;
    const text = String(req.query.t ?? '').slice(0, 24);
    const ratio = String(req.query.r ?? (kind === 'banner' ? '21x9' : '16x9'));

    const [rw, rh] = ratio.split('x').map((n) => Number(n) || 1);
    const width = 800;
    const height = Math.round((width * rh) / rw);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue}, 16%, 93%)"/>
      <stop offset="100%" stop-color="hsl(${(hue + 40) % 360}, 14%, 84%)"/>
    </linearGradient>
    <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1" fill="hsl(${hue}, 12%, 70%)" opacity="0.5"/>
    </pattern>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#g)"/>
  <rect width="${width}" height="${height}" fill="url(#dots)"/>
  <circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) * 0.11}" fill="rgba(9,9,11,0.82)"/>
  <path d="M ${width / 2 - 10} ${height / 2 - 16} L ${width / 2 + 18} ${height / 2} L ${width / 2 - 10} ${height / 2 + 16} Z" fill="#fff"/>
  ${
    text
      ? `<text x="${width / 2}" y="${height - 34}" text-anchor="middle" font-family="system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif" font-size="22" font-weight="500" fill="hsl(${hue}, 12%, 32%)">${escapeXml(text)}</text>`
      : ''
  }
</svg>`;

    res.set({
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    res.send(svg);
  }),
);
