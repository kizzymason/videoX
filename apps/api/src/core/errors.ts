/**
 * 业务错误码。前端按 code 分支处理，HTTP status 只表达传输层语义。
 * 约定：0 = 成功；1xxx 通用；2xxx 认证；3xxx 内容；4xxx 会员；5xxx 服务端。
 */
export const ErrorCode = {
  OK: 0,

  BAD_REQUEST: 1000,
  VALIDATION_FAILED: 1001,
  NOT_FOUND: 1002,
  CONFLICT: 1003,
  RATE_LIMITED: 1004,
  PAYLOAD_TOO_LARGE: 1005,

  UNAUTHORIZED: 2000,
  INVALID_CREDENTIALS: 2001,
  TOKEN_EXPIRED: 2002,
  TOKEN_INVALID: 2003,
  FORBIDDEN: 2004,
  ACCOUNT_BANNED: 2005,
  REGISTRATION_CLOSED: 2006,

  VIDEO_NOT_READY: 3000,
  VIDEO_UNAVAILABLE: 3001,
  UPLOAD_SESSION_INVALID: 3002,
  CHUNK_CHECKSUM_MISMATCH: 3003,
  TRANSCODE_FAILED: 3004,
  PLAY_TOKEN_INVALID: 3005,
  CONCURRENT_STREAM_LIMIT: 3006,

  VIP_REQUIRED: 4000,
  CODE_NOT_FOUND: 4001,
  CODE_ALREADY_USED: 4002,
  CODE_EXPIRED: 4003,
  CODE_DISABLED: 4004,

  INTERNAL_ERROR: 5000,
  STORAGE_ERROR: 5001,
  UPSTREAM_ERROR: 5002,
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  readonly code: ErrorCodeValue;
  readonly status: number;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(params: {
    message: string;
    code?: ErrorCodeValue;
    status?: number;
    details?: unknown;
    expose?: boolean;
    cause?: unknown;
  }) {
    super(params.message, { cause: params.cause });
    this.name = 'AppError';
    this.code = params.code ?? ErrorCode.BAD_REQUEST;
    this.status = params.status ?? 400;
    this.details = params.details;
    this.expose = params.expose ?? true;
  }

  static badRequest(message = '请求参数有误', details?: unknown) {
    return new AppError({ message, code: ErrorCode.BAD_REQUEST, status: 400, details });
  }

  static validation(message = '参数校验未通过', details?: unknown) {
    return new AppError({ message, code: ErrorCode.VALIDATION_FAILED, status: 422, details });
  }

  static unauthorized(message = '请先登录', code: ErrorCodeValue = ErrorCode.UNAUTHORIZED) {
    return new AppError({ message, code, status: 401 });
  }

  static forbidden(message = '没有操作权限', code: ErrorCodeValue = ErrorCode.FORBIDDEN) {
    return new AppError({ message, code, status: 403 });
  }

  /** 402 专门留给「需要开通会员」，前端据此弹出开通引导。 */
  static vipRequired(message = '该内容需要会员才能观看', details?: unknown) {
    return new AppError({ message, code: ErrorCode.VIP_REQUIRED, status: 402, details });
  }

  static notFound(message = '资源不存在') {
    return new AppError({ message, code: ErrorCode.NOT_FOUND, status: 404 });
  }

  static conflict(message = '资源冲突', code: ErrorCodeValue = ErrorCode.CONFLICT) {
    return new AppError({ message, code, status: 409 });
  }

  static tooMany(message = '操作过于频繁，请稍后再试') {
    return new AppError({ message, code: ErrorCode.RATE_LIMITED, status: 429 });
  }

  static internal(message = '服务器开小差了', cause?: unknown) {
    return new AppError({ message, code: ErrorCode.INTERNAL_ERROR, status: 500, expose: false, cause });
  }
}
