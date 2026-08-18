import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { PageMeta, Paginated } from '@videox/shared';
import { ErrorCode } from './errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      traceId: string;
    }
  }
}

export function ok<T>(res: Response, data: T, message = 'ok'): Response {
  return res.json({
    code: ErrorCode.OK,
    message,
    data,
    traceId: res.req.traceId ?? '',
  });
}

export function created<T>(res: Response, data: T, message = 'created'): Response {
  return res.status(201).json({
    code: ErrorCode.OK,
    message,
    data,
    traceId: res.req.traceId ?? '',
  });
}

export function noContent(res: Response): Response {
  return ok(res, null);
}

export function pageMeta(total: number, page: number, pageSize: number): PageMeta {
  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
  return { page, pageSize, total, totalPages, hasMore: page < totalPages };
}

export function paginated<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return { items, meta: pageMeta(total, page, pageSize) };
}

/**
 * Express 5 的 ParamsDictionary 把每个参数都放宽成 `string | string[]`（为了兼容
 * `*` 通配段），但本项目除 media 通配路由外都是普通命名参数，逐处收窄太吵，
 * 因此在这里统一按 string 处理。
 */
export type ApiRequest = Request<Record<string, string>>;

/**
 * Express 5 已经会转发 async handler 的 rejection，但显式包一层可以让
 * 类型推断更稳，也便于将来插入统一的耗时统计。
 */
export function asyncHandler(
  handler: (req: ApiRequest, res: Response, next: NextFunction) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req as unknown as ApiRequest, res, next)).catch(next);
  };
}
