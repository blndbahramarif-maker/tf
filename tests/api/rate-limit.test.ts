import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as login } from '../../app/api/v1/auth/login/route';
import { POST as register } from '../../app/api/v1/auth/register/route';
import { consumeRateLimit, RATE_LIMITS } from '@/infra/redis/rate-limit';
import { getRedis } from '@/infra/redis/client';
import { callRoute, clearRateLimits, createTestUser, disconnect, hasDatabase } from './harness';

/**
 * Rate limiting.
 *
 * Note the deliberate FAIL-OPEN behaviour: if Redis is unavailable, requests
 * proceed rather than the whole site returning 429. Rate limiting is an abuse
 * control, not an authorization control — it must never be the only thing
 * between an attacker and an action, which is why per-account lockout backs it
 * up on the login path. Authentication and authorization fail CLOSED.
 */

describe.skipIf(!hasDatabase)('rate limiting', () => {
  beforeEach(async () => {
    await clearRateLimits();
  });

  afterAll(async () => {
    await disconnect();
  });

  describe('counter mechanics', () => {
    it('allows up to the limit, then refuses', async () => {
      const redis = getRedis();
      const rule = { name: 'test_rule', limit: 3, windowMs: 60_000 };
      const id = `probe-${Date.now()}`;

      const results = [];
      for (let i = 0; i < 5; i += 1) {
        results.push(await consumeRateLimit(redis, rule, id));
      }

      expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
      expect(results[0]?.remaining).toBe(2);
      expect(results[2]?.remaining).toBe(0);
    });

    it('tracks identifiers independently', async () => {
      const redis = getRedis();
      const rule = { name: 'test_isolated', limit: 1, windowMs: 60_000 };
      const stamp = Date.now();

      expect((await consumeRateLimit(redis, rule, `a-${stamp}`)).allowed).toBe(true);
      expect((await consumeRateLimit(redis, rule, `a-${stamp}`)).allowed).toBe(false);
      // A different caller is unaffected.
      expect((await consumeRateLimit(redis, rule, `b-${stamp}`)).allowed).toBe(true);
    });

    it('starts a fresh window once the old one elapses', async () => {
      const redis = getRedis();
      const rule = { name: 'test_window', limit: 1, windowMs: 1000 };
      const id = `window-${Date.now()}`;
      const t0 = new Date(1_000_000_000_000);

      expect((await consumeRateLimit(redis, rule, id, t0)).allowed).toBe(true);
      expect((await consumeRateLimit(redis, rule, id, t0)).allowed).toBe(false);
      // Next window.
      const t1 = new Date(t0.getTime() + 1000);
      expect((await consumeRateLimit(redis, rule, id, t1)).allowed).toBe(true);
    });

    it('FAILS OPEN when Redis is unreachable', async () => {
      // Deliberate: an abuse control must not become an outage.
      const { default: Redis } = await import('ioredis');
      const broken = new Redis('redis://127.0.0.1:6399', {
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
        enableOfflineQueue: false,
      });

      const result = await consumeRateLimit(broken, RATE_LIMITS.login, 'unreachable');
      expect(result.allowed).toBe(true);
      expect(result.degraded).toBe(true);

      broken.disconnect();
    });
  });

  describe('login endpoint', () => {
    it('returns 429 with rate-limit headers once the IP+account limit is exceeded', async () => {
      // Uses an address with NO account, so per-account lockout cannot fire and
      // the 429 can only have come from the rate limiter. (Lockout triggers at
      // 5 failures, before the limiter's 10, for accounts that do exist — that
      // precedence is asserted separately below.)
      const ghost = `ghost.${Date.now()}@example.test`;
      const ip = '203.0.113.44';
      let limited: Awaited<ReturnType<typeof callRoute>> | null = null;

      for (let attempt = 0; attempt < RATE_LIMITS.login.limit + 2; attempt += 1) {
        const result = await callRoute(login, '/api/v1/auth/login', {
          method: 'POST',
          body: { email: ghost, password: 'wrong password' },
          ip,
        });
        if (result.status === 429) {
          limited = result;
          break;
        }
        expect(result.status).toBe(401);
      }

      expect(limited).not.toBeNull();
      expect(limited!.headers.get('retry-after')).toBeTruthy();
      expect(limited!.headers.get('x-ratelimit-limit')).toBe(String(RATE_LIMITS.login.limit));
      expect(limited!.headers.get('x-ratelimit-remaining')).toBe('0');
    }, 90_000);

    it('applies per-account LOCKOUT before the IP rate limit for real accounts', async () => {
      // Defence in depth: lockout is per account and survives IP rotation,
      // so it must bite first. It returns 429 with Retry-After but no
      // x-ratelimit-limit header — that difference is how we tell them apart.
      const user = await createTestUser();
      let lockedAt = -1;

      for (let attempt = 1; attempt <= 8; attempt += 1) {
        const result = await callRoute(login, '/api/v1/auth/login', {
          method: 'POST',
          body: { email: user.email, password: 'wrong password' },
          // A different IP each time: the limiter cannot be what stops this.
          ip: `198.51.100.${attempt}`,
        });
        if (result.status === 429) {
          lockedAt = attempt;
          expect(result.headers.get('retry-after')).toBeTruthy();
          expect(result.headers.get('x-ratelimit-limit')).toBeNull();
          break;
        }
      }

      expect(lockedAt).toBeGreaterThan(0);
      expect(lockedAt).toBeLessThanOrEqual(RATE_LIMITS.login.limit);
    }, 90_000);

    it('keeps separate budgets per account from one IP', async () => {
      const ghostA = `ghost-a.${Date.now()}@example.test`;
      const ghostB = `ghost-b.${Date.now()}@example.test`;
      const ip = '203.0.113.55';

      for (let i = 0; i < RATE_LIMITS.login.limit + 1; i += 1) {
        await callRoute(login, '/api/v1/auth/login', {
          method: 'POST',
          body: { email: ghostA, password: 'wrong' },
          ip,
        });
      }

      const blockedForA = await callRoute(login, '/api/v1/auth/login', {
        method: 'POST',
        body: { email: ghostA, password: 'wrong' },
        ip,
      });
      expect(blockedForA.status).toBe(429);

      // A different account from the same IP still has its own budget. That is
      // why real accounts also get lockout — the limiter alone would let one
      // address spray many accounts.
      const forB = await callRoute(login, '/api/v1/auth/login', {
        method: 'POST',
        body: { email: ghostB, password: 'wrong' },
        ip,
      });
      expect(forB.status).toBe(401);
    }, 90_000);
  });

  describe('registration endpoint', () => {
    it('limits account creation per IP', async () => {
      const ip = '203.0.113.77';
      const statuses: number[] = [];

      for (let attempt = 0; attempt < RATE_LIMITS.register.limit + 2; attempt += 1) {
        const result = await callRoute(register, '/api/v1/auth/register', {
          method: 'POST',
          body: {
            email: `flood.${attempt}.${Date.now()}@example.test`,
            password: 'correct horse battery staple',
            displayName: 'Flood',
          },
          ip,
        });
        statuses.push(result.status);
        if (result.status === 429) break;
      }

      expect(statuses).toContain(429);
    }, 90_000);
  });
});
