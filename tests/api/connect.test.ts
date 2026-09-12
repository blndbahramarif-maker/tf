import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/infra/db/client';
import {
  accountIdempotencyKey,
  applyAccountState,
  loadOnboardingSnapshot,
  loadSellerEligibility,
  readRequirements,
  startOnboarding,
} from '@/infra/payments/onboarding-service';
import { createOrder } from '@/infra/payments/order-service';
import { processEvent, recordEvent } from '@/infra/payments/webhook-service';
import type { ProviderAccountState } from '@/domain/payments/onboarding-status';
import type {
  AccountLink,
  ConnectGateway,
  CreateAccountInput,
  CreateAccountLinkInput,
} from '@/domain/payments/connect-gateway';
import { FakePaymentGateway } from './fake-gateway';
import {
  clearRateLimits,
  createTestListing,
  createTestUser,
  hasDatabase,
  type TestUser,
} from './harness';

/**
 * Connected-account onboarding, end to end through the real services, the real
 * state machine, the real database and the real constraints.
 *
 * The PROVIDER is a labelled fake. This environment has no Stripe credentials,
 * so the real API is covered by `tests/api/stripe-live.test.ts` and skipped
 * without a `sk_test_` key. Everything else here is production code.
 *
 * The fake records every call, which is how these tests prove what WOULD be
 * sent to Stripe — the idempotency key, the fact that a fresh link is minted
 * every time — rather than only asserting a database row afterwards.
 */

// ─── A labelled fake Connect provider ───────────────────────────────────────

function providerAccount(overrides: Partial<ProviderAccountState> = {}): ProviderAccountState {
  return {
    accountId: 'acct_fake_default',
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    currentlyDue: [],
    eventuallyDue: [],
    pastDue: [],
    pendingVerification: [],
    disabledReason: null,
    currentDeadline: null,
    capabilities: {},
    country: 'GB',
    payoutDelayDays: null,
    controller: {},
    ...overrides,
  };
}

/** ### MOCK — not Stripe, and does not talk to Stripe. */
class FakeConnectGateway implements ConnectGateway {
  readonly isTestMode = true;
  readonly creates: CreateAccountInput[] = [];
  readonly links: CreateAccountLinkInput[] = [];

  private nextAccountNumber = 0;
  private readonly accounts = new Map<string, ProviderAccountState>();
  /** Mirrors Stripe's own behaviour: one key, one account, forever. */
  private readonly byIdempotencyKey = new Map<string, string>();

  async createAccount(input: CreateAccountInput): Promise<ProviderAccountState> {
    this.creates.push(input);

    const seen = this.byIdempotencyKey.get(input.idempotencyKey);
    if (seen !== undefined) return this.accounts.get(seen)!;

    this.nextAccountNumber += 1;
    const accountId = `acct_fake_${this.nextAccountNumber}`;
    const account = providerAccount({ accountId, country: input.country });
    this.accounts.set(accountId, account);
    this.byIdempotencyKey.set(input.idempotencyKey, accountId);
    return account;
  }

  async createAccountLink(input: CreateAccountLinkInput): Promise<AccountLink> {
    this.links.push(input);
    return {
      // A DIFFERENT url every call, because Stripe's links are single-use.
      url: `https://connect.stripe.test/setup/${this.links.length}`,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    };
  }

  async retrieveAccount(accountId: string): Promise<ProviderAccountState | null> {
    return this.accounts.get(accountId) ?? null;
  }

  /** Declares what the provider now reports for an account. */
  setAccount(account: ProviderAccountState): void {
    this.accounts.set(account.accountId, account);
  }
}

const connect = new FakeConnectGateway();
const payments = new FakePaymentGateway();

vi.mock('@/infra/payments/gateway-provider', () => ({
  PaymentsUnavailableError: class PaymentsUnavailableError extends Error {},
  paymentGateway: () => payments,
  connectGateway: () => connect,
  paymentsAvailable: () => true,
}));

/** Builds an `account.updated` body the fake `constructEvent` will accept. */
function accountEventBody(account: Partial<ProviderAccountState> & { accountId: string }): string {
  return JSON.stringify({
    id: `evt_fake_acct_${Math.random().toString(36).slice(2)}`,
    type: 'account.updated',
    data: {
      object: {
        id: account.accountId,
        object: 'account',
        charges_enabled: account.chargesEnabled ?? false,
        payouts_enabled: account.payoutsEnabled ?? false,
        details_submitted: account.detailsSubmitted ?? false,
        country: account.country ?? 'GB',
        requirements: {
          currently_due: account.currentlyDue ?? [],
          eventually_due: account.eventuallyDue ?? [],
          past_due: account.pastDue ?? [],
          pending_verification: account.pendingVerification ?? [],
          disabled_reason: account.disabledReason ?? null,
          current_deadline: null,
        },
        capabilities: account.capabilities ?? {},
        controller: account.controller ?? {},
      },
    },
  });
}

/** Records and processes an event exactly as the webhook route would. */
async function deliverEvent(body: string) {
  const event = payments.constructEvent(body, 'v1=fake');
  const recorded = await recordEvent(event);
  if (recorded.duplicate) return 'duplicate' as const;
  return processEvent(event.id, payments);
}

describe.skipIf(!hasDatabase)('connected-account onboarding', () => {
  let seller: TestUser;
  let otherSeller: TestUser;

  beforeAll(async () => {
    seller = await createTestUser({ roles: ['seller'], withSellerProfile: true, stepUp: true });
    otherSeller = await createTestUser({
      roles: ['seller'],
      withSellerProfile: true,
      stepUp: true,
    });
  });

  beforeEach(async () => {
    await clearRateLimits(seller.id, otherSeller.id);
  });

  describe('starting onboarding', () => {
    it('creates the account from the PROFILE, never from a request', async () => {
      const result = await startOnboarding({
        userId: seller.id,
        gateway: connect,
        returnUrl: 'https://kurdora.test/en/dashboard/payouts?from=stripe',
        refreshUrl: 'https://kurdora.test/en/dashboard/payouts?link=expired',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const create = connect.creates.at(-1)!;

      // The country came from the seller's own profile row. There is no
      // parameter on `startOnboarding` through which a caller could name one.
      const profile = await prisma.sellerProfile.findUniqueOrThrow({
        where: { id: seller.sellerProfileId! },
        select: {
          stripeAccountId: true,
          onboardingStatus: true,
          country: { select: { code: true } },
        },
      });
      expect(create.country).toBe(profile.country.code);

      // Our ids travel as metadata — echoed back on every event, never
      // treated as authority.
      expect(create.metadata.kurdora_seller_profile_id).toBe(seller.sellerProfileId);
      expect(create.metadata.kurdora_user_id).toBe(seller.id);

      // Persisted BEFORE the link was minted.
      expect(profile.stripeAccountId).toBe(result.accountId);
      expect(profile.onboardingStatus).toBe('ONBOARDING_STARTED');
    });

    it('uses a deterministic idempotency key so a retry cannot make two accounts', async () => {
      const before = connect.creates.length;

      const first = await startOnboarding({
        userId: otherSeller.id,
        gateway: connect,
        returnUrl: 'https://kurdora.test/r',
        refreshUrl: 'https://kurdora.test/x',
      });
      // A second call — the same seller, as a retry after a timeout would be.
      const second = await startOnboarding({
        userId: otherSeller.id,
        gateway: connect,
        returnUrl: 'https://kurdora.test/r',
        refreshUrl: 'https://kurdora.test/x',
      });

      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;

      expect(second.accountId).toBe(first.accountId);
      expect(first.created).toBe(true);
      // The account id was already on the row, so no second create was even
      // attempted — the key protects the case where it is.
      expect(second.created).toBe(false);
      expect(connect.creates.length).toBe(before + 1);
      expect(connect.creates.at(-1)!.idempotencyKey).toBe(
        accountIdempotencyKey(otherSeller.sellerProfileId!),
      );
    });

    it('mints a FRESH link every time, because Stripe links are single-use', async () => {
      const first = await startOnboarding({
        userId: seller.id,
        gateway: connect,
        returnUrl: 'https://kurdora.test/r',
        refreshUrl: 'https://kurdora.test/x',
      });
      const second = await startOnboarding({
        userId: seller.id,
        gateway: connect,
        returnUrl: 'https://kurdora.test/r',
        refreshUrl: 'https://kurdora.test/x',
      });

      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      expect(second.url).not.toBe(first.url);

      // Collected up front: one trip through the form, and a seller who will
      // not provide information reveals it before they have listings.
      expect(connect.links.at(-1)!.collect).toBe('eventually_due');
    });

    it('refuses a seller Stripe has REJECTED', async () => {
      const rejected = await createTestUser({
        roles: ['seller'],
        withSellerProfile: true,
        stepUp: true,
      });
      await prisma.sellerProfile.update({
        where: { id: rejected.sellerProfileId! },
        data: { onboardingStatus: 'REJECTED' },
      });

      const result = await startOnboarding({
        userId: rejected.id,
        gateway: connect,
        returnUrl: 'https://kurdora.test/r',
        refreshUrl: 'https://kurdora.test/x',
      });

      expect(result).toEqual({ ok: false, issue: 'already_rejected' });
    });
  });

  describe('applying provider state', () => {
    let subject: TestUser;
    let accountId: string;

    beforeEach(async () => {
      subject = await createTestUser({
        roles: ['seller'],
        withSellerProfile: true,
        stepUp: true,
      });
      const started = await startOnboarding({
        userId: subject.id,
        gateway: connect,
        returnUrl: 'https://kurdora.test/r',
        refreshUrl: 'https://kurdora.test/x',
      });
      if (!started.ok) throw new Error('setup failed');
      accountId = started.accountId;
    });

    it('becomes ACTIVE only on the provider’s say-so', async () => {
      const settled = await applyAccountState(
        subject.sellerProfileId!,
        providerAccount({
          accountId,
          chargesEnabled: true,
          payoutsEnabled: true,
          detailsSubmitted: true,
          payoutDelayDays: 7,
        }),
        new Date(),
      );

      expect(settled).toBe('ACTIVE');

      const snapshot = await loadOnboardingSnapshot(subject.id);
      expect(snapshot).toMatchObject({
        status: 'ACTIVE',
        chargesEnabled: true,
        payoutsEnabled: true,
        payoutDelayDays: 7,
      });
      // Deliberately absent: a seller has no use for `acct_…`, and keeping it
      // out of the snapshot keeps it out of page source and screenshots.
      expect(snapshot).not.toHaveProperty('accountId');
    });

    it('will not let a STALE event re-enable a rejected seller', async () => {
      /*
       * The out-of-order attack, and the reason the transition table exists.
       * Stripe does not guarantee ordering, so a healthy-looking payload can
       * legitimately arrive after a rejection. It must not resurrect them.
       */
      await applyAccountState(
        subject.sellerProfileId!,
        providerAccount({ accountId, disabledReason: 'rejected.fraud' }),
        new Date(),
      );

      const settled = await applyAccountState(
        subject.sellerProfileId!,
        providerAccount({
          accountId,
          chargesEnabled: true,
          payoutsEnabled: true,
          detailsSubmitted: true,
        }),
        new Date(),
      );

      // The status is HELD at REJECTED…
      expect(settled).toBe('REJECTED');
      const row = await prisma.sellerProfile.findUniqueOrThrow({
        where: { id: subject.sellerProfileId! },
        select: { onboardingStatus: true, chargesEnabled: true },
      });
      expect(row.onboardingStatus).toBe('REJECTED');
      // …while the newest FACTS are still recorded, because a reviewer needs
      // to see what the provider actually said.
      expect(row.chargesEnabled).toBe(true);
    });

    it('records outstanding requirements as KEYS and nothing more', async () => {
      await applyAccountState(
        subject.sellerProfileId!,
        providerAccount({
          accountId,
          detailsSubmitted: true,
          currentlyDue: ['individual.verification.document'],
          pastDue: ['external_account'],
        }),
        new Date(),
      );

      const snapshot = await loadOnboardingSnapshot(subject.id);
      expect(snapshot?.currentlyDue).toEqual(['individual.verification.document']);
      expect(snapshot?.pastDue).toEqual(['external_account']);
    });
  });

  describe('the account.updated webhook', () => {
    it('mirrors provider state onto the right seller and nobody else', async () => {
      const target = await createTestUser({
        roles: ['seller'],
        withSellerProfile: true,
        stepUp: true,
      });
      const bystander = await createTestUser({
        roles: ['seller'],
        withSellerProfile: true,
        stepUp: true,
      });

      const started = await startOnboarding({
        userId: target.id,
        gateway: connect,
        returnUrl: 'https://kurdora.test/r',
        refreshUrl: 'https://kurdora.test/x',
      });
      if (!started.ok) throw new Error('setup failed');

      const bystanderBefore = await loadOnboardingSnapshot(bystander.id);

      expect(
        await deliverEvent(
          accountEventBody({
            accountId: started.accountId,
            chargesEnabled: true,
            payoutsEnabled: true,
            detailsSubmitted: true,
          }),
        ),
      ).toBe('processed');

      expect((await loadOnboardingSnapshot(target.id))?.status).toBe('ACTIVE');
      // The other seller is untouched. The account id is the only link, and it
      // is looked up rather than trusted from anywhere else.
      expect(await loadOnboardingSnapshot(bystander.id)).toEqual(bystanderBefore);
    });

    it('defers rather than drops an event for an account we have not stored yet', async () => {
      // Out-of-order: the webhook beats our own write. Dropping it would lose
      // a capability change permanently.
      const outcome = await deliverEvent(
        accountEventBody({ accountId: 'acct_fake_never_seen', chargesEnabled: true }),
      );
      expect(outcome).toBe('deferred');
    });

    it('does NOT treat a second account.updated as a semantic duplicate', async () => {
      /*
       * The bug this guards against would be invisible and expensive: an
       * account emits one of these every time a requirement changes, so
       * deduping on (type, account id) would silently discard the event that
       * says a seller has been restricted.
       */
      const subject = await createTestUser({
        roles: ['seller'],
        withSellerProfile: true,
        stepUp: true,
      });
      const started = await startOnboarding({
        userId: subject.id,
        gateway: connect,
        returnUrl: 'https://kurdora.test/r',
        refreshUrl: 'https://kurdora.test/x',
      });
      if (!started.ok) throw new Error('setup failed');

      expect(
        await deliverEvent(
          accountEventBody({
            accountId: started.accountId,
            chargesEnabled: true,
            payoutsEnabled: true,
            detailsSubmitted: true,
          }),
        ),
      ).toBe('processed');
      expect((await loadOnboardingSnapshot(subject.id))?.status).toBe('ACTIVE');

      // A SECOND, different event about the same account — Stripe restricting
      // them. It must be processed, not discarded.
      expect(
        await deliverEvent(
          accountEventBody({
            accountId: started.accountId,
            chargesEnabled: false,
            payoutsEnabled: false,
            detailsSubmitted: true,
            disabledReason: 'requirements.past_due',
            pastDue: ['external_account'],
          }),
        ),
      ).toBe('processed');

      expect((await loadOnboardingSnapshot(subject.id))?.status).toBe('RESTRICTED');
    });
  });

  describe('seller eligibility for BUY_NOW', () => {
    async function payableSeller() {
      const user = await createTestUser({
        roles: ['seller'],
        withSellerProfile: true,
        stepUp: true,
      });
      await applyAccountState(
        user.sellerProfileId!,
        providerAccount({
          // A RANDOM suffix, not one derived from the user id: UUIDv7's
          // leading characters are a millisecond timestamp, so ids minted in
          // the same window share them and would collide on the unique index.
          accountId: `acct_fake_eligible_${randomUUID()}`,
          chargesEnabled: true,
          payoutsEnabled: true,
          detailsSubmitted: true,
        }),
        new Date(),
      );
      return user;
    }

    it('accepts an order from a fully onboarded seller', async () => {
      const payable = await payableSeller();
      const buyer = await createTestUser({ roles: ['buyer'], stepUp: true });
      const listing = await createTestListing({
        ownerSellerProfileId: payable.sellerProfileId!,
        status: 'ACTIVE',
      });

      const result = await createOrder({ listingId: listing.id, buyerId: buyer.id });
      expect(result.ok).toBe(true);
    });

    it('refuses a BUY_NOW order while requirements are outstanding', async () => {
      /*
       * The subtle one. `charges_enabled` stays TRUE until Stripe's deadline
       * passes, so a check that trusted it alone would take the buyer's money
       * and then have nowhere to send the seller's share.
       */
      const payable = await payableSeller();
      const buyer = await createTestUser({ roles: ['buyer'], stepUp: true });
      const listing = await createTestListing({
        ownerSellerProfileId: payable.sellerProfileId!,
        status: 'ACTIVE',
      });

      await prisma.sellerProfile.update({
        where: { id: payable.sellerProfileId! },
        data: {
          requirementsDue: {
            currently_due: ['individual.verification.document'],
            past_due: [],
          } as never,
        },
      });

      const result = await createOrder({ listingId: listing.id, buyerId: buyer.id });
      expect(result).toEqual({ ok: false, issue: 'seller_not_payable' });
    });

    it('still requires NOTHING of a FEE_ONLY seller', async () => {
      /*
       * The Part 1 invariant, re-asserted now that eligibility has grown
       * teeth. A Cars seller has no connected account, no capabilities and no
       * onboarding at all, and must still be able to transact — there is no
       * transfer leg, so there is nothing to be eligible for.
       */
      const unonboarded = await createTestUser({
        roles: ['seller'],
        withSellerProfile: true,
        stepUp: true,
      });
      const buyer = await createTestUser({ roles: ['buyer'], stepUp: true });

      const profile = await prisma.sellerProfile.findUniqueOrThrow({
        where: { id: unonboarded.sellerProfileId! },
        select: { stripeAccountId: true, chargesEnabled: true, payoutsEnabled: true },
      });
      expect(profile).toEqual({
        stripeAccountId: null,
        chargesEnabled: false,
        payoutsEnabled: false,
      });

      const listing = await createTestListing({
        ownerSellerProfileId: unonboarded.sellerProfileId!,
        categorySlug: 'cars',
        status: 'ACTIVE',
        priceMinor: 5_000_000n,
        /*
         * Values chosen to sit OUTSIDE every band the listing-search tests
         * assert exact counts for. The suites share one database across
         * parallel workers, so an ACTIVE fixture here is visible to them; a
         * mileage of 40,000 would have joined their `max:50000` result set and
         * broken a test in a different file.
         */
        attributes: { make: 'Toyota', model: 'Corolla', year: '2019', mileage: '188000' },
      });

      const result = await createOrder({ listingId: listing.id, buyerId: buyer.id });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // The invariant itself, unchanged by anything in Part 2.
      const order = await prisma.order.findUniqueOrThrow({
        where: { id: result.orderId },
        select: {
          flowType: true,
          totalMinor: true,
          commissionAmountMinor: true,
          sellerAmountMinor: true,
          principalMinor: true,
          sellerProfile: { select: { stripeAccountId: true } },
        },
      });
      expect(order.flowType).toBe('FEE_ONLY');
      expect(order.totalMinor).toBe(order.commissionAmountMinor);
      expect(order.sellerAmountMinor).toBe(0n);
      expect(order.principalMinor).toBe(5_000_000n);
      expect(order.totalMinor).toBeLessThan(order.principalMinor!);
      // No connected account is involved, so there is nothing to transfer to.
      expect(order.sellerProfile.stripeAccountId).toBeNull();
    });

    it('reads eligibility from the database, issue by issue', async () => {
      const payable = await payableSeller();
      expect(
        await loadSellerEligibility({
          sellerProfileId: payable.sellerProfileId!,
          categoryRequiresVerifiedSeller: false,
        }),
      ).toEqual({ eligible: true });

      // Our own gate, not Stripe's: category data, editable by an admin.
      const gated = await loadSellerEligibility({
        sellerProfileId: payable.sellerProfileId!,
        categoryRequiresVerifiedSeller: true,
      });
      expect(gated.eligible).toBe(false);
      if (!gated.eligible) expect(gated.issues).toContain('not_verified_seller');
    });
  });

  describe('the requirements parser', () => {
    it('yields empty lists rather than undefined for anything unexpected', () => {
      // It parses a provider payload, so it is parsed and not cast: a shape
      // change at Stripe must not put `undefined` into an eligibility decision.
      for (const value of [null, undefined, 'string', 42, [], {}, { currently_due: 'no' }]) {
        expect(readRequirements(value)).toEqual({ currentlyDue: [], pastDue: [] });
      }

      expect(readRequirements({ currently_due: ['a', 7, 'b'], past_due: ['c'] })).toEqual({
        currentlyDue: ['a', 'b'],
        pastDue: ['c'],
      });
    });
  });
});
