import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  POST as startSubscription,
  GET as getSubscription,
} from '../../app/api/v1/listings/[id]/subscription/route';
import { POST as listingTransition } from '../../app/api/v1/listings/[id]/status/route';
import { prisma } from '@/infra/db/client';
import { applyProviderSubscription } from '@/infra/billing/subscription-service';
import { processBillingEvent, recordBillingEvent } from '@/infra/billing/webhook-service';
import type { ProviderSubscription } from '@/domain/billing/billing-gateway';
import type { SubscriptionStatus } from '@/domain/billing/subscription-status';
import type * as BillingPolicy from '@/infra/billing/listing-billing-policy';
import { FakePaymentGateway } from './fake-gateway';
import {
  callRoute,
  clearRateLimits,
  createTestListing,
  createTestUser,
  hasDatabase,
  orphanId,
  type TestUser,
} from './harness';

/**
 * Kurdora's OWN service billing, through the real routes and database.
 *
 * The PROVIDER is a labelled fake — this environment has no Stripe
 * credentials. Everything else is production code.
 *
 * What these tests are really about is what a seller CANNOT do. There is no
 * request field for a price, a status or a Stripe id anywhere in this
 * feature, so most of the "cannot forge it" tests assert the ABSENCE of a
 * path rather than its rejection — which is the stronger property.
 */

// ─── A labelled fake billing provider ───────────────────────────────────────

function providerSubscription(over: Partial<ProviderSubscription> = {}): ProviderSubscription {
  return {
    subscriptionId: 'sub_fake_1',
    customerId: 'cus_fake_1',
    status: 'ACTIVE',
    currentPeriodEnd: new Date('2026-10-13T00:00:00Z'),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    latestInvoiceId: 'in_fake_1',
    updatedAt: new Date('2026-09-13T12:00:00Z'),
    livemode: false,
    ...over,
  };
}

/** ### MOCK — not Stripe, and does not talk to Stripe. */
class FakeBillingGateway {
  readonly isTestMode = true;
  readonly checkouts: unknown[] = [];
  private readonly subscriptions = new Map<string, ProviderSubscription>();
  private customerCounter = 0;
  private sessionCounter = 0;

  async ensureCustomer(): Promise<string> {
    this.customerCounter += 1;
    return `cus_fake_${this.customerCounter}`;
  }

  async createCheckoutSession(input: unknown) {
    this.checkouts.push(input);
    this.sessionCounter += 1;
    return {
      id: `cs_fake_${this.sessionCounter}`,
      url: `https://checkout.stripe.test/${this.sessionCounter}`,
    };
  }

  async retrieveSubscription(id: string): Promise<ProviderSubscription | null> {
    return this.subscriptions.get(id) ?? null;
  }

  async cancelAtPeriodEnd(id: string): Promise<ProviderSubscription | null> {
    const existing = this.subscriptions.get(id);
    if (existing === undefined) return null;
    const updated = { ...existing, cancelAtPeriodEnd: true };
    this.subscriptions.set(id, updated);
    return updated;
  }

  /** Declares what the provider reports for a subscription. */
  setSubscription(subscription: ProviderSubscription): void {
    this.subscriptions.set(subscription.subscriptionId, subscription);
  }
}

const billing = new FakeBillingGateway();
const payments = new FakePaymentGateway();

/**
 * Whether subscriptions are required, controlled PER TEST.
 *
 * Deliberately not the real `listing.subscription_required` setting row. That
 * is global state in a database these suites share across parallel workers, so
 * flipping it here would reach into other test files mid-run and fail them —
 * which it did, before this was changed.
 *
 * Only the SETTING LOOKUP is stubbed. `checkListingBilling` below still reads
 * the real subscription row and still runs the real domain rule, so what is
 * under test is the enforcement path, not a mock of it. The setting lookup
 * itself is covered separately, against the real row.
 */
type BillingPolicyModule = typeof BillingPolicy;

let subscriptionRequired = false;

vi.mock('@/infra/billing/listing-billing-policy', async (importOriginal) => {
  const actual = await importOriginal<BillingPolicyModule>();
  const { prisma: db } = await import('@/infra/db/client');
  const { listingMayBeVisible } = await import('@/domain/billing/subscription-status');

  return {
    ...actual,
    listingSubscriptionRequired: async () => subscriptionRequired,
    checkListingBilling: async (listingId: string) => {
      if (!subscriptionRequired) return { required: false, status: null, allowed: true };
      const row = await db.listingSubscription.findUnique({
        where: { listingId },
        select: { status: true },
      });
      const status = (row?.status ?? null) as never;
      return {
        required: true,
        status,
        allowed: listingMayBeVisible({ subscriptionRequired: true, status }),
      };
    },
  };
});

vi.mock('@/infra/payments/gateway-provider', () => ({
  PaymentsUnavailableError: class PaymentsUnavailableError extends Error {},
  paymentGateway: () => payments,
  billingGateway: () => billing,
  paymentsAvailable: () => true,
}));

function setSubscriptionRequired(required: boolean) {
  subscriptionRequired = required;
}

describe.skipIf(!hasDatabase)('Kurdora service billing', () => {
  let seller: TestUser;
  let otherSeller: TestUser;

  beforeAll(async () => {
    seller = await createTestUser({ roles: ['seller'], withSellerProfile: true, stepUp: true });
    otherSeller = await createTestUser({
      roles: ['seller'],
      withSellerProfile: true,
      stepUp: true,
    });

    // Give the seeded plan a Stripe Price so checkout is possible.
    await prisma.servicePlan.updateMany({
      where: { key: 'listing_monthly' },
      data: { stripePriceId: 'price_fake_listing_monthly' },
    });
  });

  beforeEach(async () => {
    await clearRateLimits(seller.id, otherSeller.id);
    setSubscriptionRequired(false);
  });

  const ownListing = (status: 'DRAFT' | 'ACTIVE' = 'ACTIVE', owner = seller) =>
    createTestListing({
      ownerSellerProfileId: owner.sellerProfileId!,
      status,
      withReadyImage: true,
    });

  describe('the subscription-required setting itself', () => {
    it('defaults to OFF, and reads the real setting row', async () => {
      /*
       * Covered directly because the stub above bypasses this lookup. It
       * matters that the default is FALSE: charging for listings must be a
       * deliberate act, not something that starts the moment this code ships.
       */
      const actual = await vi.importActual<BillingPolicyModule>(
        '@/infra/billing/listing-billing-policy',
      );

      const row = await prisma.setting.findFirstOrThrow({
        where: { key: actual.SUBSCRIPTION_REQUIRED_SETTING, scope: 'GLOBAL' },
        select: { value: true },
      });
      expect(row.value).toBe(false);
      expect(await actual.listingSubscriptionRequired()).toBe(false);
    });
  });

  // ── 1 · publishing and contact need no Stripe Connect ────────────────────

  describe('1 · a seller needs no connected account', () => {
    it('publishes a listing with no Stripe anything', async () => {
      const listing = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        status: 'DRAFT',
        withReadyImage: true,
      });

      const result = await callRoute(listingTransition, `/api/v1/listings/${listing.id}/status`, {
        method: 'POST',
        token: seller.accessToken,
        params: { id: listing.id },
        body: { to: 'ACTIVE' },
      });

      expect(result.status).toBe(200);

      // No connected account, no subscription, no billing customer — and the
      // listing is live anyway. This is the contact-only model working.
      const profile = await prisma.sellerProfile.findUniqueOrThrow({
        where: { id: seller.sellerProfileId! },
        select: { stripeAccountId: true, chargesEnabled: true, payoutsEnabled: true },
      });
      expect(profile).toEqual({
        stripeAccountId: null,
        chargesEnabled: false,
        payoutsEnabled: false,
      });
      expect(await prisma.listingSubscription.count({ where: { listingId: listing.id } })).toBe(0);
    });
  });

  // ── 8-11 · no marketplace payment path exists at all ─────────────────────

  describe('8-11 · a buyer cannot pay the seller through Kurdora', () => {
    it('has no order, payment, payout or transfer surface', async () => {
      /*
       * Asserted structurally rather than by calling an endpoint and expecting
       * 404: the point is that the CODE for a marketplace payment does not
       * exist, not that one route happens to be unrouted.
       */
      const { readdirSync, existsSync } = await import('node:fs');

      for (const gone of [
        'app/api/v1/orders',
        'app/api/v1/connect',
        'src/infra/payments/order-service.ts',
        'src/infra/payments/payment-service.ts',
        'src/infra/stripe/connect.ts',
        'src/domain/payments/connect-gateway.ts',
      ]) {
        expect(existsSync(gone), gone).toBe(false);
      }

      // And no route file anywhere can begin a sale payment.
      const routes = readdirSync('app/api/v1');
      expect(routes).not.toContain('orders');
      expect(routes).not.toContain('connect');
    });

    it('cannot express a destination charge, application fee or transfer', async () => {
      // The gateway's INPUT TYPE has no such fields, so this is a compile-time
      // guarantee as well as a runtime one. Asserted on the source because a
      // type cannot be interrogated at runtime.
      const { readFileSync } = await import('node:fs');
      const port = readFileSync('src/domain/payments/payment-gateway.ts', 'utf8');

      for (const gone of [
        'destinationAccountId',
        'applicationFeeMinor',
        'transferGroup',
        'transferId',
      ]) {
        expect(port, gone).not.toContain(gone);
      }
    });

    it('creates no payout, ledger entry or commission when a listing goes live', async () => {
      const before = {
        payouts: await prisma.payout.count(),
        ledger: await prisma.ledgerEntry.count(),
        orders: await prisma.order.count(),
      };

      const listing = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        status: 'DRAFT',
        withReadyImage: true,
      });
      await callRoute(listingTransition, `/api/v1/listings/${listing.id}/status`, {
        method: 'POST',
        token: seller.accessToken,
        params: { id: listing.id },
        body: { to: 'ACTIVE' },
      });

      // The Phase 7 tables are RETAINED but dormant. Nothing writes to them.
      expect(await prisma.payout.count()).toBe(before.payouts);
      expect(await prisma.ledgerEntry.count()).toBe(before.ledger);
      expect(await prisma.order.count()).toBe(before.orders);
    });
  });

  // ── checkout ─────────────────────────────────────────────────────────────

  describe('starting a subscription', () => {
    it('takes no body, and prices from the PLAN', async () => {
      const listing = await ownListing();

      const result = await callRoute(
        startSubscription,
        `/api/v1/listings/${listing.id}/subscription`,
        {
          method: 'POST',
          token: seller.accessToken,
          params: { id: listing.id },
          // A forged price, status and subscription id, all at once.
          body: {
            amountMinor: '1',
            priceId: 'price_attacker',
            status: 'ACTIVE',
            stripeSubscriptionId: 'sub_attacker',
          },
        },
      );

      expect(result.status).toBe(201);

      const row = await prisma.listingSubscription.findUniqueOrThrow({
        where: { listingId: listing.id },
        select: { status: true, amountMinor: true, stripeSubscriptionId: true, currency: true },
      });

      // 7 · the price is the PLAN's, not the one in the body.
      const plan = await prisma.servicePlan.findFirstOrThrow({ where: { key: 'listing_monthly' } });
      expect(row.amountMinor).toBe(plan.amountMinor);
      expect(row.currency).toBe(plan.currency);
      // 5 · and the status is INCOMPLETE — the only one Kurdora may write.
      expect(row.status).toBe('INCOMPLETE');
      // 6 · the forged subscription id went nowhere.
      expect(row.stripeSubscriptionId).toBeNull();
    });

    it('refuses to subscribe somebody else’s listing', async () => {
      // 15 · IDOR. Ownership is the query, so this is indistinguishable from
      // a listing that does not exist.
      const foreign = await ownListing('ACTIVE', otherSeller);

      const result = await callRoute(
        startSubscription,
        `/api/v1/listings/${foreign.id}/subscription`,
        { method: 'POST', token: seller.accessToken, params: { id: foreign.id } },
      );
      expect(result.status).toBe(404);

      const missing = await callRoute(
        startSubscription,
        `/api/v1/listings/${orphanId()}/subscription`,
        { method: 'POST', token: seller.accessToken, params: { id: orphanId() } },
      );
      expect(missing.status).toBe(404);
      expect(await prisma.listingSubscription.count({ where: { listingId: foreign.id } })).toBe(0);
    });

    it('will not read somebody else’s subscription', async () => {
      const foreign = await ownListing('ACTIVE', otherSeller);
      await callRoute(startSubscription, `/api/v1/listings/${foreign.id}/subscription`, {
        method: 'POST',
        token: otherSeller.accessToken,
        params: { id: foreign.id },
      });

      const result = await callRoute(
        getSubscription,
        `/api/v1/listings/${foreign.id}/subscription`,
        {
          token: seller.accessToken,
          params: { id: foreign.id },
        },
      );
      expect(result.status).toBe(404);
    });
  });

  // ── 2-4 · the access rule ────────────────────────────────────────────────

  describe('2-4 · the subscription gate', () => {
    async function subscribedListing(status: SubscriptionStatus, subId = `sub_${Date.now()}`) {
      const listing = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        status: 'DRAFT',
        withReadyImage: true,
      });
      await callRoute(startSubscription, `/api/v1/listings/${listing.id}/subscription`, {
        method: 'POST',
        token: seller.accessToken,
        params: { id: listing.id },
      });
      // Only a provider object can move it out of INCOMPLETE.
      await applyProviderSubscription({
        provider: providerSubscription({ subscriptionId: subId, status }),
        providerEventId: null,
      });
      return listing;
    }

    it('2 · refuses to publish an unpaid listing when subscriptions are required', async () => {
      setSubscriptionRequired(true);
      const listing = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        status: 'DRAFT',
        withReadyImage: true,
      });

      const result = await callRoute(listingTransition, `/api/v1/listings/${listing.id}/status`, {
        method: 'POST',
        token: seller.accessToken,
        params: { id: listing.id },
        body: { to: 'ACTIVE' },
      });

      expect(result.status).toBe(409);
      const after = await prisma.listing.findUniqueOrThrow({
        where: { id: listing.id },
        select: { status: true },
      });
      expect(after.status).toBe('DRAFT');
    });

    it('3 · lets an ACTIVE subscription publish', async () => {
      setSubscriptionRequired(true);
      const listing = await subscribedListing('ACTIVE');

      const result = await callRoute(listingTransition, `/api/v1/listings/${listing.id}/status`, {
        method: 'POST',
        token: seller.accessToken,
        params: { id: listing.id },
        body: { to: 'ACTIVE' },
      });
      expect(result.status).toBe(200);
    });

    it('4 · takes a live listing down when the subscription lapses', async () => {
      setSubscriptionRequired(true);
      const subId = `sub_lapse_${Date.now()}`;
      const listing = await subscribedListing('ACTIVE', subId);
      await callRoute(listingTransition, `/api/v1/listings/${listing.id}/status`, {
        method: 'POST',
        token: seller.accessToken,
        params: { id: listing.id },
        body: { to: 'ACTIVE' },
      });

      // Stripe gave up. Access is revoked, per Stripe's own guidance.
      await applyProviderSubscription({
        provider: providerSubscription({
          subscriptionId: subId,
          status: 'UNPAID',
          updatedAt: new Date('2026-09-14T12:00:00Z'),
        }),
        providerEventId: null,
      });

      const after = await prisma.listing.findUniqueOrThrow({
        where: { id: listing.id },
        select: { status: true },
      });
      /*
       * PAUSED, not REMOVED. A seller whose card expired has not done anything
       * wrong: their work, images and history survive, and paying republishes.
       * Removal is a moderation outcome and must not be confused with a
       * billing one.
       */
      expect(after.status).toBe('PAUSED');
    });

    it('keeps a PAST_DUE listing up while Stripe is still retrying', async () => {
      setSubscriptionRequired(true);
      const subId = `sub_pastdue_${Date.now()}`;
      const listing = await subscribedListing('ACTIVE', subId);
      await callRoute(listingTransition, `/api/v1/listings/${listing.id}/status`, {
        method: 'POST',
        token: seller.accessToken,
        params: { id: listing.id },
        body: { to: 'ACTIVE' },
      });

      await applyProviderSubscription({
        provider: providerSubscription({
          subscriptionId: subId,
          status: 'PAST_DUE',
          updatedAt: new Date('2026-09-14T12:00:00Z'),
        }),
        providerEventId: null,
      });

      const after = await prisma.listing.findUniqueOrThrow({
        where: { id: listing.id },
        select: { status: true },
      });
      expect(after.status).toBe('ACTIVE');
    });
  });

  // ── 12-14 · webhooks ─────────────────────────────────────────────────────

  describe('12-14 · webhook integrity', () => {
    function subscriptionEventBody(over: { id?: string; type?: string; subId: string }) {
      return JSON.stringify({
        id: over.id ?? `evt_${Math.random().toString(36).slice(2)}`,
        type: over.type ?? 'customer.subscription.updated',
        data: { object: { id: over.subId, object: 'subscription' } },
      });
    }

    async function deliver(body: string) {
      const event = payments.constructEvent(body, 'v1=fake');
      const recorded = await recordBillingEvent(event);
      if (recorded.duplicate) return 'duplicate' as const;
      return processBillingEvent(event.id, billing);
    }

    it('12 · rejects a forged signature before recording anything', async () => {
      const body = subscriptionEventBody({ subId: 'sub_forged' });
      // The fake mirrors the real adapter: it THROWS on a bad signature, so
      // nothing downstream ever sees the event.
      expect(() => payments.constructEvent(body, 'INVALID-sig')).toThrow();
      expect(await prisma.paymentEvent.count({ where: { relatedObjectId: 'sub_forged' } })).toBe(0);
    });

    it('13 · is idempotent for a replayed event id', async () => {
      const subId = `sub_dup_${Date.now()}`;
      const listing = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        status: 'DRAFT',
      });
      await callRoute(startSubscription, `/api/v1/listings/${listing.id}/subscription`, {
        method: 'POST',
        token: seller.accessToken,
        params: { id: listing.id },
      });
      billing.setSubscription(providerSubscription({ subscriptionId: subId }));

      const eventId = `evt_dup_${Date.now()}`;
      const body = subscriptionEventBody({ id: eventId, subId });

      expect(await deliver(body)).toBe('processed');
      // The same event id again: a primary-key conflict, absorbed.
      expect(await deliver(body)).toBe('duplicate');

      // And only one status change was recorded.
      const sub = await prisma.listingSubscription.findUniqueOrThrow({
        where: { listingId: listing.id },
        select: { id: true },
      });
      const changes = await prisma.subscriptionEvent.count({
        where: { subscriptionId: sub.id, toStatus: 'ACTIVE' },
      });
      expect(changes).toBe(1);
    });

    it('14 · cannot be rolled backwards by a stale event', async () => {
      const subId = `sub_stale_${Date.now()}`;
      const listing = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        status: 'DRAFT',
      });
      await callRoute(startSubscription, `/api/v1/listings/${listing.id}/subscription`, {
        method: 'POST',
        token: seller.accessToken,
        params: { id: listing.id },
      });

      // Newest state first: cancelled.
      await applyProviderSubscription({
        provider: providerSubscription({
          subscriptionId: subId,
          status: 'CANCELED',
          updatedAt: new Date('2026-09-14T12:00:00Z'),
        }),
        providerEventId: null,
      });

      // Then an OLDER "active" arrives, as Stripe's unordered delivery allows.
      const outcome = await applyProviderSubscription({
        provider: providerSubscription({
          subscriptionId: subId,
          status: 'ACTIVE',
          updatedAt: new Date('2026-09-13T12:00:00Z'),
        }),
        providerEventId: null,
      });

      expect(outcome).toBe('stale');
      const row = await prisma.listingSubscription.findUniqueOrThrow({
        where: { listingId: listing.id },
        select: { status: true },
      });
      // Still cancelled. A stale event must never re-grant a paid service.
      expect(row.status).toBe('CANCELED');
    });

    it('refuses to reopen a CANCELED subscription even with a NEWER event', async () => {
      // Belt and braces: terminal is terminal regardless of timestamps.
      const subId = `sub_terminal_${Date.now()}`;
      const listing = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        status: 'DRAFT',
      });
      await callRoute(startSubscription, `/api/v1/listings/${listing.id}/subscription`, {
        method: 'POST',
        token: seller.accessToken,
        params: { id: listing.id },
      });

      await applyProviderSubscription({
        provider: providerSubscription({
          subscriptionId: subId,
          status: 'CANCELED',
          updatedAt: new Date('2026-09-13T12:00:00Z'),
        }),
        providerEventId: null,
      });

      const outcome = await applyProviderSubscription({
        provider: providerSubscription({
          subscriptionId: subId,
          status: 'ACTIVE',
          updatedAt: new Date('2026-09-20T12:00:00Z'),
        }),
        providerEventId: null,
      });

      expect(outcome).toBe('refused');
      const row = await prisma.listingSubscription.findUniqueOrThrow({
        where: { listingId: listing.id },
        select: { status: true },
      });
      expect(row.status).toBe('CANCELED');
    });
  });

  // ── 16 · suspension still wins ───────────────────────────────────────────

  describe('16 · a suspended seller bypasses nothing', () => {
    it('cannot publish even with an ACTIVE subscription', async () => {
      setSubscriptionRequired(true);
      const suspended = await createTestUser({
        roles: ['seller'],
        withSellerProfile: true,
        stepUp: true,
      });
      const listing = await createTestListing({
        ownerSellerProfileId: suspended.sellerProfileId!,
        status: 'DRAFT',
        withReadyImage: true,
      });
      await callRoute(startSubscription, `/api/v1/listings/${listing.id}/subscription`, {
        method: 'POST',
        token: suspended.accessToken,
        params: { id: listing.id },
      });
      await applyProviderSubscription({
        provider: providerSubscription({ subscriptionId: `sub_susp_${Date.now()}` }),
        providerEventId: null,
      });

      await prisma.user.update({ where: { id: suspended.id }, data: { status: 'SUSPENDED' } });

      const result = await callRoute(listingTransition, `/api/v1/listings/${listing.id}/status`, {
        method: 'POST',
        token: suspended.accessToken,
        params: { id: listing.id },
        body: { to: 'ACTIVE' },
      });

      // 403 from the GUARD, before any billing logic runs. Paying does not buy
      // past moderation.
      expect(result.status).toBe(403);
    });
  });
});
