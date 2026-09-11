import { describe, expect, it } from 'vitest';
import { schemas } from '@/infra/env';

const baseline = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
};

describe('server environment schema', () => {
  it('accepts a minimal local configuration', () => {
    const result = schemas.server.safeParse(baseline);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.APP_ENV).toBe('local');
      expect(result.data.APP_URL).toBe('http://localhost:3000');
    }
  });

  it('requires a database URL', () => {
    const result = schemas.server.safeParse({ REDIS_URL: baseline.REDIS_URL });
    expect(result.success).toBe(false);
  });

  it('does not require Stripe keys before Phase 7', () => {
    expect(schemas.server.safeParse(baseline).success).toBe(true);
  });

  it('enforces stricter requirements in production', () => {
    const result = schemas.server.safeParse({ ...baseline, APP_ENV: 'production' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('AUTH_SECRET');
      expect(paths).toContain('S3_BUCKET');
    }
  });

  it('refuses to start production with a Stripe test key', () => {
    // Running live traffic against test keys silently produces fake payments.
    // This is the cheapest possible guard against that.
    const result = schemas.server.safeParse({
      ...baseline,
      APP_ENV: 'production',
      STRIPE_SECRET_KEY: 'sk_test_abc123',
      AUTH_SECRET: 'x'.repeat(32),
      S3_BUCKET: 'b',
      S3_ACCESS_KEY_ID: 'k',
      S3_SECRET_ACCESS_KEY: 's',
      MAIL_FROM: 'a@b.com',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('TEST key'))).toBe(true);
    }
  });

  it('rejects a secret key that is not a Stripe secret key', () => {
    const result = schemas.server.safeParse({ ...baseline, STRIPE_SECRET_KEY: 'pk_live_oops' });
    expect(result.success).toBe(false);
  });
});

describe('client environment schema', () => {
  it('only accepts a publishable Stripe key', () => {
    expect(
      schemas.client.safeParse({ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_1' }).success,
    ).toBe(true);
    // A secret key reaching the client bundle is a catastrophic leak.
    expect(
      schemas.client.safeParse({ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'sk_live_1' }).success,
    ).toBe(false);
  });
});
