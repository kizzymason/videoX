import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';

type Source = 'body' | 'query' | 'params';

/**
 * 校验后把结果挂到 req.valid 上，而不是覆盖 req.query。
 * Express 5 的 req.query 是只读 getter，直接赋值会抛错。
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      valid: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

export function validate(schemas: Partial<Record<Source, ZodType>>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.valid ??= {};
      if (schemas.body) req.valid.body = schemas.body.parse(req.body ?? {});
      if (schemas.query) req.valid.query = schemas.query.parse(req.query ?? {});
      if (schemas.params) req.valid.params = schemas.params.parse(req.params ?? {});
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function body<T>(req: Request): T {
  return req.valid?.body as T;
}

export function query<T>(req: Request): T {
  return req.valid?.query as T;
}

export function params<T>(req: Request): T {
  return req.valid?.params as T;
}
