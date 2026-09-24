import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { ADMIN_PATH_MAX } from '@videox/shared';
import { getSiteSettings } from './service.js';

export const internalRouter = Router();

function sameSegment(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * 后台入口判定，供 nginx 的 auth_request 调用。
 *
 * 只回 204 / 403，任何情况下都不回显真实入口路径，也不写日志（见 app.ts 的 autoLogging 忽略表）。
 * 刻意不挂在 /api 下：nginx 对外只反代 /api /media /static /health，
 * 这条路径从公网打不进来，只有同一 docker 网络里的子请求能到。
 * 站点设置有 30s 进程内缓存，所以这个子请求不会真的落到数据库。
 */
internalRouter.get('/admin-entry', async (req, res) => {
  const seg = typeof req.query.seg === 'string' ? req.query.seg : '';
  if (!seg || seg.length > ADMIN_PATH_MAX) {
    res.status(403).end();
    return;
  }
  try {
    const settings = await getSiteSettings();
    // getSiteSettings 一定会补上 adminPath，这里的兜底只为满足可选类型。
    res.status(sameSegment(seg, settings.adminPath ?? '') ? 204 : 403).end();
  } catch {
    // 设置读不出来时按「不是入口」处理：nginx 会退回前台页面，不暴露异常。
    res.status(403).end();
  }
});
