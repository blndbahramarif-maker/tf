import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StripeGateway, resetStripeGatewayCache } from '@/infra/stripe/gateway';
import { readStripeConfig } from '@/infra/stripe/config';

/**
 * The REAL Stripe API, in TEST MODE.
 *
 * Skipped unless `STRIPE_SECRET_KEY` is a `sk_test_` key. The environment this
 * was written in has no Stripe credentials, so **these tests have not been
 * observed passing** — that is stated plainly in the Part 1 exit report rather
 * than implied by their existence.
 *
 * They exist so the moment a test key is configured, the real adapter is
 * exercised against the real API with no further work: `pnpm test` runs them.
 * Everything they cover — the SDK call shape, real HMAC signature
 * verification, Stripe's own idempotency — is the part a fake cannot prove.
 *
 * **TEST MODE ONLY.** `readStripeConfig` refuses a live key outright
 * (`LIVE_MODE_PERMITTED = false`), so this suite cannot run against live mode
 * even if somebody exported a live key by mistake.
 */

const config = readStripeConfig();
const hasTestKey = config.ok && config.config.mode === 'test';

if (!hasTestKey) {
  // Visible in the test output, so a skipped suite is never mistaken for a
  // passing one.
  console.warn(
    '[stripe-live] SKIPPED: no sk_test_ key configured. ' +
      'The real Stripe API was NOT exercised in this run.',
  );
}

describe.skipIf(!hasTestKey)('Stripe test mode (real API)', () => {
  /*
   * Built LAZILY. Constructing a `Stripe` client at describe scope runs even
   * when the suite is skipped, and `new Stripe(undefined)` throws — which
   * failed the whole file rather than skipping it.
   */
  let gateway: StripeGateway;

  beforeAll(() => {
    gateway = new StripeGateway(config.ok ? config.config : ({} as never));
  });

  afterAll(() => {
    resetStripeGatewayCache();
  });

  it('is in test mode, and says so', () => {
    expect(gateway.isTestMode).toBe(true);
  });

  it('creates a plain fee-only style PaymentIntent with no transfer leg', async () => {
    const intent = await gateway.createPaymentIntent({
      amountMinor: 25_000n,
      currency: 'GBP',
      idempotencyKey: `test:feeonly:${Date.now()}`,
      statementDescriptorSuffix: 'MARKETPLACE FEE',
      metadata: { kurdora_flow: 'FEE_ONLY', kurdora_test: 'true' },
    });

    expect(intent.id).toMatch(/^pi_/);
    expect(intent.amountMinor).toBe(25_000n);
    expect(intent.currency).toBe('GBP');
    expect(intent.clientSecret).toBeTruthy();
    // The whole point of the flow, verified against the real API.
    expect(intent.destinationAccountId).toBeNull();
    expect(intent.applicationFeeMinor).toBeNull();
    // Never live, whatever else happens.
    expect(intent.livemode).toBe(false);
  });

  it('honours Stripe’s own idempotency key within its retention window', async () => {
    const key = `test:idem:${Date.now()}`;
    const params = {
      amountMinor: 1_000n,
      currency: 'GBP',
      idempotencyKey: key,
      metadata: { kurdora_test: 'true' },
    };

    const first = await gateway.createPaymentIntent(params);
    const second = await gateway.createPaymentIntent(params);
    expect(second.id).toBe(first.id);
  });

  it('retrieves an intent it just created, and null for one that does not exist', async () => {
    const created = await gateway.createPaymentIntent({
      amountMinor: 1_000n,
      currency: 'GBP',
      idempotencyKey: `test:retrieve:${Date.now()}`,
      metadata: { kurdora_test: 'true' },
    });

    const found = await gateway.retrievePaymentIntent(created.id);
    expect(found?.id).toBe(created.id);

    expect(await gateway.retrievePaymentIntent('pi_0000000000000000000000')).toBeNull();
  });

  it('refuses a forged webhook signature — REAL HMAC verification', async () => {
    const body = JSON.stringify({ id: 'evt_test', type: 'payment_intent.succeeded', data: {} });

    // No signature, a junk signature, and a well-formed but wrong one.
    expect(() => gateway.constructEvent(body, '')).toThrow();
    expect(() => gateway.constructEvent(body, 'not-a-signature')).toThrow();
    expect(() =>
      gateway.constructEvent(body, `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`),
    ).toThrow();
  });

  it('refuses to create an intent with a malformed transfer leg', async () => {
    // The domain guard runs before the network call, so this never reaches
    // Stripe at all.
    await expect(
      gateway.createPaymentIntent({
        amountMinor: 1_000n,
        currency: 'GBP',
        idempotencyKey: `test:bad:${Date.now()}`,
        destinationAccountId: 'acct_missing_fee',
        metadata: {},
      }),
    ).rejects.toThrow(/together or not at all/i);
  });
});
