import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, ErrorCode } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { env } from '../config/env.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    code: ErrorCode.NOT_FOUND,
    message: `接口不存在：${req.method} ${req.path}`,
    data: null,
    traceId: req.traceId ?? '',
  });
};

function describeZodError(error: ZodError): { message: string; details: unknown } {
  const details = error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
    code: issue.code,
  }));
  const first = details[0];
  return {
    message: first ? `${first.field}: ${first.message}` : '参数校验未通过',
    details,
  };
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const traceId = req.traceId ?? '';

  if (err instanceof ZodError) {
    const { message, details } = describeZodError(err);
    res.status(422).json({ code: ErrorCode.VALIDATION_FAILED, message, data: null, traceId, details });
    return;
  }

  if (err instanceof AppError) {
    if (err.status >= 500) {
      logger.error({ err, traceId, path: req.path }, err.message);
    } else {
      logger.debug({ traceId, path: req.path, code: err.code }, err.message);
    }
    res.status(err.status).json({
      code: err.code,
      message: err.expose ? err.message : '服务器开小差了',
      data: null,
      traceId,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  // Express body-parser 的体积/JSON 解析错误
  const anyErr = err as { type?: string; status?: number; message?: string };
  if (anyErr?.type === 'entity.too.large') {
    res.status(413).json({ code: ErrorCode.PAYLOAD_TOO_LARGE, message: '请求体过大', data: null, traceId });
    return;
  }
  if (anyErr?.type === 'entity.parse.failed') {
    res.status(400).json({ code: ErrorCode.BAD_REQUEST, message: '请求体不是合法 JSON', data: null, traceId });
    return;
  }

  logger.error({ err, traceId, path: req.path, method: req.method }, '未捕获的异常');
  res.status(500).json({
    code: ErrorCode.INTERNAL_ERROR,
    message: '服务器开小差了',
    data: null,
    traceId,
    ...(env.isProd ? {} : { details: anyErr?.message }),
  });
};
