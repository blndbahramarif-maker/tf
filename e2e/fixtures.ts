import { test as base } from '@playwright/test';
import Redis from 'ioredis';

/**
 * E2E test fixture.
 *
 * Clears the rate-limit counters before each test. Every test drives the same
 * browser from the same address, so within one run they look like one IP
 * hammering registration — and registration is capped at five per hour per IP,
 * which is correct in production and fatal for a test suite.
 *
 * The limits themselves are NOT relaxed and no test-only bypass exists in the
 * application: the counters are simply reset from outside, the way a clock
 * advancing an hour would. `rate-limit.test.ts` still proves the limiter works.
 */
export const test = base.extend<{ cleanRateLimits: void }>({
  cleanRateLimits: [
    // eslint-disable-next-line no-empty-pattern -- Playwright's fixture signature
    async ({}, use) => {
      const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
      const redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
      try {
        await redis.connect();
        const keys = await redis.keys('ratelimit:*');
        if (keys.length > 0) await redis.del(...keys);
      } catch {
        // A run without Redis will fail elsewhere with a clearer message than
        // anything this fixture could produce.
      } finally {
        redis.disconnect();
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
