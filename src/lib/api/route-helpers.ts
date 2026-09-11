import type { NextResponse } from 'next/server';
import type { ZodType } from 'zod';
import { getRedis } from '@/infra/redis/client';
import { consumeRateLimit, type RateLimitRule } from '@/infra/redis/rate-limit';
import { clientIp } from './guards';
import { fail } from './respond';

/** Parses and validates a JSON body, returning a 422 response on failure. */
export async function parseBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<{ ok: true; value: T } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: fail('validation_failed', 'Request body must be valid JSON.', { request }),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: fail('validation_failed', 'Request body is invalid.', {
        request,
        fields: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      }),
    };
  }

  return { ok: true, value: parsed.data };
}

/**
 * Applies a rate limit, keyed by IP and optionally by an account identifier.
 *
 * Keying on BOTH matters: IP-only lets an attacker rotate addresses to keep
 * guessing one account, and account-only lets one address spray many accounts.
 */
export async function enforceRateLimit(
  request: Request,
  rule: RateLimitRule,
  extraIdentifier?: string,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const identifier = extraIdentifier
    ? `${clientIp(request) ?? 'unknown'}|${extraIdentifier}`
    : (clientIp(request) ?? 'unknown');

  const result = await consumeRateLimit(getRedis(), rule, identifier);

  if (!result.allowed) {
    const response = fail('rate_limited', 'Too many requests. Try again later.', { request });
    response.headers.set(
      'retry-after',
      String(Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)),
    );
    response.headers.set('x-ratelimit-limit', String(result.limit));
    response.headers.set('x-ratelimit-remaining', '0');
    return { ok: false, response };
  }

  return { ok: true };
}

/** Standard headers for any response carrying credentials. */
export function noStore(response: NextResponse): NextResponse {
  response.headers.set('cache-control', 'no-store');
  response.headers.set('pragma', 'no-cache');
  return response;
}
