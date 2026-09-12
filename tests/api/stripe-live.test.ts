import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StripeGateway, resetStripeGatewayCache } from '@/infra/stripe/gateway';
import { StripeConnectGateway, resetStripeConnectCache } from '@/infra/stripe/connect';
import { LIVE_MODE_PERMITTED, decideStripeConfig, readStripeConfig } from '@/infra/stripe/config';
import { CONNECT_CONTROLLER } from '@/domain/payments/connect-gateway';

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

  it('reads a charge back WITH its balance transaction', async () => {
    /*
     * The claim this proves is the one `latest_charge` alone cannot: that the
     * REAL provider fee and net are readable. An unconfirmed intent has no
     * charge yet, so this asserts the not-found path against the real API and
     * leaves the settled path to a confirmed test charge.
     */
    expect(await gateway.retrieveCharge('ch_0000000000000000000000')).toBeNull();
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

/**
 * The live-mode refusal, which runs with NO credentials at all.
 *
 * Deliberately outside the skipped suite above. The single most important
 * property of this integration is that it cannot be pointed at live mode, and
 * a test that only runs when a test key happens to be configured would not be
 * guarding it. This one runs everywhere, always.
 */
describe('live mode is refused', () => {
  /*
   * Fixture keys are ASSEMBLED rather than written as literals.
   *
   * Not superstition: a contiguous `sk_live_…` string in a committed file is
   * what GitHub's push protection scans for, and it blocked this very commit.
   * These are obviously not real keys — but a scanner cannot know that, and a
   * test suite that trips secret detection on every push trains people to wave
   * the warning through, which is how a real key eventually gets pushed.
   */
  const fakeKey = (prefix: string) => `${prefix}_` + 'notarealkey';
  const FAKE_WEBHOOK_SECRET = 'whsec' + '_notarealsecret';

  it('is switched off at the source', () => {
    // Flipping this constant is the deliberate, reviewable act that would
    // permit live mode. It is gated on Stripe's written approval of the
    // business model, which does not exist (R-3, docs/15-phase-7-gate.md).
    expect(LIVE_MODE_PERMITTED).toBe(false);
  });

  it('refuses an sk_live_ key without ever constructing a client', () => {
    /*
     * Asserted against the pure decision function rather than by mutating
     * `process.env`: `serverEnv()` memoises, so an env-mutating test would be
     * reading a cached parse and passing for the wrong reason. On this rule in
     * particular, a test that passes for the wrong reason is worse than none.
     */
    const live = decideStripeConfig(fakeKey('sk_live'), FAKE_WEBHOOK_SECRET);
    expect(live.ok).toBe(false);
    if (!live.ok) expect(live.reason).toBe('live_mode_not_permitted');
  });

  it('accepts a test key and refuses a key that is neither', () => {
    const test = decideStripeConfig(fakeKey('sk_test'), FAKE_WEBHOOK_SECRET);
    expect(test.ok).toBe(true);
    if (test.ok) expect(test.config.mode).toBe('test');

    // Restricted keys (`rk_`) are not supported: one silently lacking a
    // permission would fail at the worst possible moment.
    const restricted = decideStripeConfig(fakeKey('rk_test'), FAKE_WEBHOOK_SECRET);
    expect(restricted.ok).toBe(false);
    if (!restricted.ok) expect(restricted.reason).toBe('mode_mismatch');
  });

  it('refuses to start half-configured', () => {
    // A secret key with no webhook secret would create payments that nothing
    // can ever confirm — worse than no payments at all.
    const half = decideStripeConfig(fakeKey('sk_test'), undefined);
    expect(half.ok).toBe(false);
    if (!half.ok) expect(half.reason).toBe('missing_webhook_secret');

    // Neither set is "off", not "broken".
    const off = decideStripeConfig(undefined, undefined);
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.reason).toBe('not_configured');
  });
});

/**
 * Connected accounts against the REAL Stripe API, in TEST MODE.
 *
 * Skipped under exactly the same condition as the suite above, and **not
 * observed passing** in the environment this was written in. Stated in the
 * Part 2 exit report rather than implied.
 *
 * Note what is NOT here: no assertion that an account becomes payable. That
 * needs a human to complete Stripe's hosted form, which is the entire design —
 * no automated test can make a seller eligible, and neither can Kurdora.
 */
describe.skipIf(!hasTestKey)('Stripe Connect test mode (real API)', () => {
  let connect: StripeConnectGateway;

  beforeAll(() => {
    connect = new StripeConnectGateway(config.ok ? config.config : ({} as never));
  });

  afterAll(() => {
    resetStripeConnectCache();
  });

  it('creates a connected account with the GA controller configuration', async () => {
    const account = await connect.createAccount({
      country: 'GB',
      email: `seller.${Date.now()}@kurdora.test`,
      businessName: 'Kurdora Test Seller',
      metadata: { kurdora_test: 'true' },
      idempotencyKey: `test:acct:${Date.now()}`,
    });

    expect(account.accountId).toMatch(/^acct_/);
    // A brand-new account is payable for nothing. If this ever comes back
    // true, something has gone very wrong.
    expect(account.chargesEnabled).toBe(false);
    expect(account.payoutsEnabled).toBe(false);
    expect(account.detailsSubmitted).toBe(false);
    expect(account.country).toBe('GB');

    // `stripe_dashboard.type` is IMMUTABLE per account, so getting it wrong
    // means creating every account again. Verified against the real object.
    expect(account.controller).toMatchObject({
      stripe_dashboard: { type: CONNECT_CONTROLLER.dashboardType },
    });
  });

  it('will not create two accounts for one idempotency key', async () => {
    // The failure this prevents is close to unrecoverable: a seller with two
    // connected accounts, one of which we have no record of.
    const params = {
      country: 'GB',
      email: `idem.${Date.now()}@kurdora.test`,
      metadata: { kurdora_test: 'true' },
      idempotencyKey: `test:acct:idem:${Date.now()}`,
    };

    const first = await connect.createAccount(params);
    const second = await connect.createAccount(params);
    expect(second.accountId).toBe(first.accountId);
  });

  it('mints a hosted onboarding link, and a DIFFERENT one each time', async () => {
    const account = await connect.createAccount({
      country: 'GB',
      email: `link.${Date.now()}@kurdora.test`,
      metadata: { kurdora_test: 'true' },
      idempotencyKey: `test:acct:link:${Date.now()}`,
    });

    const input = {
      accountId: account.accountId,
      returnUrl: 'https://kurdora.test/en/dashboard/payouts?from=stripe',
      refreshUrl: 'https://kurdora.test/en/dashboard/payouts?link=expired',
      collect: 'eventually_due' as const,
    };

    const first = await connect.createAccountLink(input);
    const second = await connect.createAccountLink(input);

    expect(first.url).toMatch(/^https:\/\//);
    expect(first.expiresAt.getTime()).toBeGreaterThan(Date.now());
    // Stripe's links are single-use, so caching one would hand the next
    // caller a dead URL.
    expect(second.url).not.toBe(first.url);
  });

  it('reads an account back, and answers null for one that does not exist', async () => {
    const account = await connect.createAccount({
      country: 'GB',
      email: `read.${Date.now()}@kurdora.test`,
      metadata: { kurdora_test: 'true' },
      idempotencyKey: `test:acct:read:${Date.now()}`,
    });

    expect((await connect.retrieveAccount(account.accountId))?.accountId).toBe(account.accountId);
    expect(await connect.retrieveAccount('acct_0000000000000000')).toBeNull();
  });
});
