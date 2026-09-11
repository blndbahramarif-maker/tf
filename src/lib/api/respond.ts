import { NextResponse } from 'next/server';
import type { ErrorCode } from '@/shared/api-contract';

/**
 * Response helpers for /api/v1.
 *
 * Every API response goes through these so the envelope stays consistent for
 * the web client and, later, the mobile clients.
 */

/** Status code per error code. Single place, so it cannot drift per-route. */
const STATUS_BY_CODE: Record<ErrorCode, number> = {
  validation_failed: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  idempotency_key_reused: 409,
  payment_required: 402,
  internal_error: 500,
  service_unavailable: 503,
};

export function requestId(request: Request): string {
  return (
    request.headers.get('x-request-id') ??
    request.headers.get('x-correlation-id') ??
    crypto.randomUUID()
  );
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function fail(
  code: ErrorCode,
  message: string,
  options: {
    request: Request;
    fields?: Array<{ path: string; message: string }>;
    status?: number;
  },
): NextResponse {
  const body = {
    error: {
      code,
      message,
      ...(options.fields ? { fields: options.fields } : {}),
      requestId: requestId(options.request),
    },
  };

  return NextResponse.json(body, { status: options.status ?? STATUS_BY_CODE[code] });
}
