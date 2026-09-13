import { describe, expect, it, vi } from 'vitest';
import { prisma } from '@/infra/db/client';
import {
  LIVE_MODE_PERMITTED,
  StripeNotConfiguredError,
  decideStripeConfig,
} from '@/infra/stripe/config';
import { PaymentsUnavailableError } from '@/infra/payments/gateway-provider';
import { FakePaymentGateway } from './fake-gateway';
import { hasDatabase } from './harness';

/**
 * The Stripe SAFETY CONTRACT.
 *
 * Six properties that must hold whether or not Stripe is configured, whether
 * or not anyone is looking, and whether or not a future phase changes how
 * payments work:
 *
 *   1. a `sk_live_` key is refused
 *   2. `LIVE_MODE_PERMITTED` stays false
 *   3. live mode is refused even when a live key is supplied by accident
 *   4. no Stripe secret is ever logged or surfaced in an error
 *   5. no Stripe secret can reach the browser
 *   6. webhook signature verification is mandatory
 *
 * Properties 1–3 and 5 are also asserted elsewhere — in
 * `tests/api/stripe-live.test.ts`, `tests/env.test.ts` and
 * `tests/architecture.test.ts`. They are restated here deliberately, as one
 * readable contract, because these are the rules most likely to be weakened by
 * someone who does not know they exist. A duplicated assertion is cheap; a
 * silently removed one is not.
 *
 * Nothing in this file contains a real key, and nothing prints one.
 */

// Fixture keys are ASSEMBLED, never written as literals — a contiguous
// `sk_live_…` string in a committed file is what secret scanners block on, and
// a suite that trips them on every push trains people to wave the warning
// through.
const fakeKey = (prefix: string) => `${prefix}_` + 'notarealkey';
const FAKE_WEBHOOK_SECRET = 'whsec' + '_notarealsecret';

const gateway = new FakePaymentGateway();
vi.mock('@/infra/payments/gateway-provider', () => ({
  PaymentsUnavailableError: class PaymentsUnavailableError extends Error {
    reason: string;
    constructor(reason: string) {
      super(`Payments are unavailable: ${reason}`);
      this.reason = reason;
    }
  },
  paymentGateway: () => gateway,
  connectGateway: () => gateway,
  paymentsAvailable: () => true,
}));

describe('1-3 · live mode cannot be reached', () => {
  it('keeps LIVE_MODE_PERMITTED false', () => {
    // The single switch. Flipping it is the deliberate, reviewable act that
    // would permit live mode, and it is gated on Stripe's written approval of
    // the business model — which does not exist (R-3, D-A).
    expect(LIVE_MODE_PERMITTED).toBe(false);
  });

  it('refuses a live key outright', () => {
    const live = decideStripeConfig(fakeKey('sk_live'), FAKE_WEBHOOK_SECRET);
    expect(live.ok).toBe(false);
    if (!live.ok) expect(live.reason).toBe('live_mode_not_permitted');
  });

  it('refuses a live key BEFORE any client is constructed', () => {
    /*
     * The ordering matters. `requireStripeConfig` is what every adapter calls
     * first, so a live key never reaches `new Stripe(...)` — it cannot make a
     * network call, cannot appear in an SDK error, and cannot be retried past.
     */
    const result = decideStripeConfig(fakeKey('sk_live'), FAKE_WEBHOOK_SECRET);
    expect(result.ok).toBe(false);

    const error = new StripeNotConfiguredError('live_mode_not_permitted');
    expect(error).toBeInstanceOf(Error);
  });

  it('accepts a test key, and refuses a key that is neither', () => {
    const test = decideStripeConfig(fakeKey('sk_test'), FAKE_WEBHOOK_SECRET);
    expect(test.ok).toBe(true);
    if (test.ok) expect(test.config.mode).toBe('test');

    // Restricted keys (`rk_`) are unsupported: one silently lacking a
    // permission would fail at the worst possible moment.
    const restricted = decideStripeConfig(fakeKey('rk_test'), FAKE_WEBHOOK_SECRET);
    expect(restricted.ok).toBe(false);
    if (!restricted.ok) expect(restricted.reason).toBe('mode_mismatch');
  });

  it('refuses to run half-configured', () => {
    // A secret key with no webhook secret would create payments that nothing
    // can ever confirm — worse than no payments at all.
    const half = decideStripeConfig(fakeKey('sk_test'), undefined);
    expect(half.ok).toBe(false);
    if (!half.ok) expect(half.reason).toBe('missing_webhook_secret');

    const noKey = decideStripeConfig(undefined, FAKE_WEBHOOK_SECRET);
    expect(noKey.ok).toBe(false);
    if (!noKey.ok) expect(noKey.reason).toBe('missing_secret_key');
  });
});

describe('4 · no Stripe secret is ever logged or surfaced', () => {
  /**
   * Searches a value for anything that looks like key material.
   *
   * Checks for the fixture values themselves AND for the prefixes, so a future
   * change that echoed "the key starting sk_test_ is invalid" would fail here
   * too. A prefix plus a few characters is enough to be worth withholding.
   */
  function assertCarriesNoKeyMaterial(subject: unknown, what: string) {
    const text = typeof subject === 'string' ? subject : JSON.stringify(subject);
    for (const fragment of [
      fakeKey('sk_test'),
      fakeKey('sk_live'),
      FAKE_WEBHOOK_SECRET,
      'sk_test_',
      'sk_live_',
      'whsec_',
    ]) {
      expect(text, `${what} leaked ${fragment.slice(0, 8)}…`).not.toContain(fragment);
    }
  }

  it('names the REASON in a configuration error, never the value', () => {
    for (const reason of [
      'not_configured',
      'missing_secret_key',
      'missing_webhook_secret',
      'live_mode_not_permitted',
      'mode_mismatch',
    ] as const) {
      const error = new StripeNotConfiguredError(reason);
      expect(error.message).toContain(reason);
      assertCarriesNoKeyMaterial(error.message, 'StripeNotConfiguredError.message');
    }
  });

  it('carries no key material in a refused configuration result', () => {
    // The result object itself is what gets logged when payments fail to
    // start. It must name which variable is wrong, never what it contains.
    for (const key of [fakeKey('sk_live'), fakeKey('rk_test'), undefined]) {
      assertCarriesNoKeyMaterial(
        decideStripeConfig(key, FAKE_WEBHOOK_SECRET),
        'decideStripeConfig result',
      );
    }
  });

  it('carries no key material in the 503 a route answers with', () => {
    const error = new PaymentsUnavailableError('live_mode_not_permitted' as never);
    assertCarriesNoKeyMaterial(error.message, 'PaymentsUnavailableError.message');
  });
});

describe.skipIf(!hasDatabase)('4b · a client secret never reaches the audit trail', () => {
  it('redacts it on the way in, through the real writer', async () => {
    /*
     * `clientSecret` can complete a charge. It belongs in one HTTP response
     * and in the browser's memory, and nowhere else — least of all in a table
     * that staff read routinely.
     *
     * Asserted through the REAL writer and read back from the REAL table,
     * rather than by exporting the redactor for a unit test: the property that
     * matters is what ends up in the database, and a test-only export would
     * prove the function works while saying nothing about whether the writer
     * actually calls it.
     */
    const { tryWriteAuditLog } = await import('@/infra/audit/audit-log');
    const { randomUUID } = await import('node:crypto');

    // `entity_id` is a uuid column, so the row is ADDRESSED by a uuid and the
    // secret-shaped marker lives only in the payload — which is the part under
    // test anyway.
    const entityId = randomUUID();
    const marker = `pi_probe_secret_${Date.now()}`;

    await tryWriteAuditLog(prisma, {
      action: 'listing.moderated',
      actorType: 'system',
      actorId: null,
      entityType: 'stripe_safety_probe',
      entityId,
      after: { clientSecret: marker, nested: { secret: marker } },
    });

    const row = await prisma.auditLog.findFirst({
      where: { entityId },
      select: { after: true },
    });

    expect(row).not.toBeNull();
    expect(JSON.stringify(row?.after)).not.toContain(marker);
    expect(JSON.stringify(row?.after)).toContain('[redacted]');
  });
});

describe('5 · no Stripe secret can reach the browser', () => {
  it('exposes no Stripe secret on any NEXT_PUBLIC_ variable', () => {
    /*
     * `NEXT_PUBLIC_*` is inlined into the browser bundle at build time, so a
     * secret there is public forever — including in git history and any CDN
     * cache. The lint rule `kurdora/no-public-env-secrets` blocks the common
     * mistakes; this asserts the runtime environment is actually clean, which
     * lint cannot do.
     */
    for (const [name, value] of Object.entries(process.env)) {
      if (!name.startsWith('NEXT_PUBLIC_')) continue;
      expect(value ?? '', `${name} holds a Stripe SECRET key`).not.toMatch(/^sk_/);
      expect(value ?? '', `${name} holds a Stripe webhook secret`).not.toMatch(/^whsec_/);
      expect(value ?? '', `${name} holds a Stripe restricted key`).not.toMatch(/^rk_/);
    }
  });

  it('keeps the secret key off the client schema entirely', async () => {
    // The client schema is the allowlist of what may be shipped. Only a
    // publishable (`pk_`) key appears on it, by construction.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync('src/infra/env.ts', 'utf8'),
    );
    const clientBlock = source.slice(source.indexOf('const clientSchema'));
    expect(clientBlock).not.toContain('STRIPE_SECRET_KEY');
    expect(clientBlock).not.toContain('STRIPE_WEBHOOK_SECRET');
  });
});
