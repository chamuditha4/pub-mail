// Typed application errors. Route handlers translate these into the public error
// envelope (CLAUDE.md §9). Messages here must never reveal whether an
// inaccessible resource exists — use `not_found` / `unauthorized` uniformly.

export type ErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limit_exceeded'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'internal_error';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limit_exceeded: 429,
  payload_too_large: 413,
  unsupported_media_type: 415,
  internal_error: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export const notFound = (message = 'Resource not found.'): AppError =>
  new AppError('not_found', message);

export const unauthorized = (message = 'Authentication required.'): AppError =>
  new AppError('unauthorized', message);

export const forbidden = (message = 'Not permitted.'): AppError =>
  new AppError('forbidden', message);

export const validationError = (message: string, details?: unknown): AppError =>
  new AppError('validation_error', message, details);

export const conflict = (message: string): AppError => new AppError('conflict', message);
