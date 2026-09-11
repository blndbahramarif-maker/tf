import type { Redis } from './client';

/**
 * Fixed-window rate limiting in Redis.
 *
 * Counters are incremented and given a TTL in one round trip. A fixed window
 * can allow up to 2× the limit across a window boundary; that is an accepted
 * trade for simplicity and is why auth limits are set conservatively. A
 * sliding-window or token-bucket implementation is a Phase 12 refinement.
 *
 * FAIL-OPEN is deliberate and documented: if Redis is unavailable the request
 * proceeds rather than the whole site returning 429. Rate limiting is an abuse
 * control, not an authorization control — it must never be the only thing
 * standing between an attacker and an action. Authentication and authorization
 * fail CLOSED.
 */

export interface RateLimitRule {
  /** Stable name, used in the key and in logs. */
  readonly name: string;
  readonly limit: number;
  readonly windowMs: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly resetAt: Date;
  /** True when the check could not run and the request was let through. */
  readonly degraded: boolean;
}

/** Conservative limits for the authentication surface. */
export const RATE_LIMITS = {
  login: { name: 'login', limit: 10, windowMs: 15 * 60_000 },
  register: { name: 'register', limit: 5, windowMs: 60 * 60_000 },
  refresh: { name: 'refresh', limit: 60, windowMs: 15 * 60_000 },
  verifyEmail: { name: 'verify_email', limit: 10, windowMs: 60 * 60_000 },
  stepUp: { name: 'step_up', limit: 10, windowMs: 15 * 60_000 },
  totp: { name: 'totp', limit: 10, windowMs: 15 * 60_000 },
  readApi: { name: 'read_api', limit: 300, windowMs: 60_000 },
  writeApi: { name: 'write_api', limit: 60, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export async function consumeRateLimit(
  redis: Redis,
  rule: RateLimitRule,
  identifier: string,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const window = Math.floor(now.getTime() / rule.windowMs);
  const key = `ratelimit:${rule.name}:${identifier}:${window}`;
  const resetAt = new Date((window + 1) * rule.windowMs);

  try {
    const results = await redis.multi().incr(key).pexpire(key, rule.windowMs).exec();

    const count = Number(results?.[0]?.[1] ?? 0);
    const allowed = count <= rule.limit;

    return {
      allowed,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - count),
      resetAt,
      degraded: false,
    };
  } catch {
    return { allowed: true, limit: rule.limit, remaining: rule.limit, resetAt, degraded: true };
  }
}

/** Clears a counter, e.g. after a successful login. */
export async function resetRateLimit(
  redis: Redis,
  rule: RateLimitRule,
  identifier: string,
  now: Date = new Date(),
): Promise<void> {
  const window = Math.floor(now.getTime() / rule.windowMs);
  try {
    await redis.del(`ratelimit:${rule.name}:${identifier}:${window}`);
  } catch {
    // Best effort. A stale counter expires on its own.
  }
}
