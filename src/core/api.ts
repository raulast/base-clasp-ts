import type { Response } from './router.ts';

export interface PageMeta {
  page: number;
  perPage: number;
  total: number;
  pages: number;
}

export interface SuccessEnvelope {
  ok: true;
  status: number;
  data: unknown;
  meta?: PageMeta;
}

export interface ErrorEnvelope {
  ok: false;
  status: number;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export class HttpError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function ok(data: unknown, meta?: PageMeta): Response {
  const body: SuccessEnvelope = meta === undefined ? { ok: true, status: 200, data } : { ok: true, status: 200, data, meta };
  return { status: 200, body };
}

export function created(data: unknown): Response {
  const body: SuccessEnvelope = { ok: true, status: 201, data };
  return { status: 201, body };
}

export function fail(status: number, code: string, message: string, details?: Record<string, unknown>): Response {
  const body: ErrorEnvelope =
    details === undefined ? { ok: false, status, error: { code, message } } : { ok: false, status, error: { code, message, details } };
  return { status, body };
}

export function isEnvelope(body: unknown): body is SuccessEnvelope | ErrorEnvelope {
  if (typeof body !== 'object' || body === null) {
    return false;
  }
  const candidate = body as { ok?: unknown };
  return candidate.ok === true || candidate.ok === false;
}

export function notFound(message: string, details?: Record<string, unknown>): HttpError {
  return new HttpError(404, 'NOT_FOUND', message, details);
}

export function forbidden(message: string, details?: Record<string, unknown>): HttpError {
  return new HttpError(403, 'FORBIDDEN', message, details);
}

export function unauthenticated(message: string, details?: Record<string, unknown>): HttpError {
  return new HttpError(401, 'UNAUTHENTICATED', message, details);
}

export function validationError(details: Record<string, unknown>): HttpError {
  return new HttpError(422, 'VALIDATION_ERROR', 'Validation error', details);
}

export function conflict(message: string, details?: Record<string, unknown>): HttpError {
  return new HttpError(409, 'CONFLICT', message, details);
}
