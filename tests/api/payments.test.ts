import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as createOrderRoute } from '../../app/api/v1/orders/route';
import { GET as getOrder } from '../../app/api/v1/orders/[id]/route';
import { POST as beginPayment } from '../../app/api/v1/orders/[id]/payment/route';
import { prisma } from '@/infra/db/client';
import { createPaymentForOrder } from '@/infra/payments/payment-service';
import { loadOrderForParty } from '@/infra/payments/order-service';
import { processEvent, recordEvent } from '@/infra/payments/webhook-service';
import { FakePaymentGateway, fakeEventBody } from './fake-gateway';
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
 * Payments, through the real routes, the real guards and the real database.
 *
 * The PROVIDER is a labelled fake (`FakePaymentGateway`) — this environment has
 * no Stripe credentials, and `tests/api/stripe-live.test.ts` covers the real
 * API when a `sk_test_` key is present. Everything else here is production
 * code: the routes, the permission checks, the ownership checks, the amount
 * computation, the state machines, the constraints and the ledger.
 *
 * The fake records every create, which is how the fee-only tests prove what
 * WOULD have been sent to Stripe rather than merely asserting a database row.
 */

// The payment route reaches for the configured gateway. Substituting it here
// is the one mock in this file, and it is the provider — not our own code.
const gateway = new FakePaymentGateway();
vi.mock('@/infra/payments/gateway-provider', () => ({
  PaymentsUnavailableError: class PaymentsUnavailableError extends Error {},
  paymentGateway: () => gateway,
  paymentsAvailable: () => true,
}));

describe.skipIf(!hasDatabase)('payments', () => {
  let seller: TestUser;
  let buyer: TestUser;
  let stranger: TestUser;
  /** BUY_NOW: mobile-electronics, 6% commission, £200.00. */
  let buyNowListingId: string;

  beforeAll(async () => {
    seller = await createTestUser({ roles: ['seller'], withSellerProfile: true, stepUp: true });
    buyer = await createTestUser({ roles: ['buyer'], stepUp: true });
    stranger = await createTestUser({ roles: ['buyer'], stepUp: true });

    /*
     * A BUY_NOW seller must be payable: a connected account with charges and
     * payouts enabled. Set directly here because onboarding is Part 2 — and
     * these are the exact fields that a webhook would mirror, never a client.
     */
    await prisma.sellerProfile.update({
      where: { id: seller.sellerProfileId! },
      data: {
        stripeAccountId: `acct_test_${Date.now()}`,
        chargesEnabled: true,
        payoutsEnabled: true,
      },
    });

    buyNowListingId = (
      await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        categorySlug: 'mobile-electronics',
        status: 'ACTIVE',
        withReadyImage: true,
        priceMinor: 20_000n,
        title: 'Payments fixture phone',
      })
    ).id;
  }, 120_000);

  beforeEach(async () => {
    await clearRateLimits(seller.id, buyer.id, stranger.id);
    gateway.creates.length = 0;
  });

  /** Creates an order through the real route, failing loudly if it did not. */
  async function createOrder(user: TestUser, listingId: string): Promise<string> {
    const result = await callRoute(createOrderRoute, '/api/v1/orders', {
      method: 'POST',
      token: user.accessToken,
      body: { listingId },
    });
    if (result.status !== 201) {
      throw new Error(`order creation failed: ${result.status} ${result.raw}`);
    }
    return result.body.id as string;
  }

  function pay(user: TestUser, orderId: string) {
    return callRoute(beginPayment, `/api/v1/orders/${orderId}/payment`, {
      method: 'POST',
      token: user.accessToken,
      params: { id: orderId },
    });
  }

  /** A fresh listing, so the one-open-order-per-listing rule does not collide. */
  async function freshListing(slug: string, priceMinor: bigint): Promise<string> {
    const listing = await createTestListing({
      ownerSellerProfileId: seller.sellerProfileId!,
      categorySlug: slug,
      status: 'ACTIVE',
      withReadyImage: true,
      priceMinor,
    });
    return listing.id;
  }

  // ── Order creation ────────────────────────────────────────────────────────

  describe('creating an order', () => {
    it('computes the amount, commission and split entirely server-side', async () => {
      const listingId = await freshListing('mobile-electronics', 20_000n);
      const result = await callRoute(createOrderRoute, '/api/v1/orders', {
        method: 'POST',
        token: buyer.accessToken,
        body: { listingId },
      });

      expect(result.status).toBe(201);
      // £200.00 at 6% = £12.00 commission, £188.00 to the seller.
      expect(result.body.totalMinor).toBe('20000');
      expect(result.body.commissionAmountMinor).toBe('1200');
      expect(result.body.currency).toBe('GBP');
      // Money as strings, never JSON numbers (ADR-0004).
      expect(typeof result.body.totalMinor).toBe('string');

      const row = await prisma.order.findUniqueOrThrow({
        where: { id: result.body.id as string },
        select: {
          totalMinor: true,
          commissionAmountMinor: true,
          sellerAmountMinor: true,
          buyerId: true,
          status: true,
        },
      });
      expect(row.totalMinor).toBe(20_000n);
      expect(row.sellerAmountMinor).toBe(18_800n);
      // The buyer is the token subject, never a request field.
      expect(row.buyerId).toBe(buyer.id);
      expect(row.status).toBe('DRAFT');
    });

    it('records the principal for FEE_ONLY and charges only the fee', async () => {
      const listingId = await freshListing('cars', 5_000_000n);
      const result = await callRoute(createOrderRoute, '/api/v1/orders', {
        method: 'POST',
        token: buyer.accessToken,
        body: { listingId },
      });

      expect(result.status).toBe(201);
      // £50,000.00 sale, 0.5% = £250.00 charged.
      expect(result.body.totalMinor).toBe('25000');
      expect(result.body.principalMinor).toBe('5000000');

      const row = await prisma.order.findUniqueOrThrow({
        where: { id: result.body.id as string },
        select: {
          totalMinor: true,
          commissionAmountMinor: true,
          sellerAmountMinor: true,
          principalMinor: true,
        },
      });
      // THE INVARIANT, as stored.
      expect(row.totalMinor).toBe(row.commissionAmountMinor);
      expect(row.sellerAmountMinor).toBe(0n);
      expect(row.principalMinor).toBe(5_000_000n);
    });

    it('refuses an unauthenticated caller', async () => {
      const result = await callRoute(createOrderRoute, '/api/v1/orders', {
        method: 'POST',
        body: { listingId: buyNowListingId },
      });
      expect(result.status).toBe(401);
    });

    it('refuses buying your own listing', async () => {
      const result = await callRoute(createOrderRoute, '/api/v1/orders', {
        method: 'POST',
        token: seller.accessToken,
        body: { listingId: buyNowListingId },
      });
      expect(result.status).toBe(409);
    });

    it('404s a listing that is not live, exactly as a missing one', async () => {
      const draft = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        status: 'DRAFT',
      });
      const hidden = await callRoute(createOrderRoute, '/api/v1/orders', {
        method: 'POST',
        token: buyer.accessToken,
        body: { listingId: draft.id },
      });
      const missing = await callRoute(createOrderRoute, '/api/v1/orders', {
        method: 'POST',
        token: buyer.accessToken,
        body: { listingId: orphanId() },
      });
      expect(hidden.status).toBe(404);
      expect(missing.status).toBe(404);
    });

    it('refuses a BUY_NOW order when the seller cannot be paid', async () => {
      const other = await createTestUser({
        roles: ['seller'],
        withSellerProfile: true,
        stepUp: true,
      });
      // No connected account: onboarding not finished.
      const listing = await createTestListing({
        ownerSellerProfileId: other.sellerProfileId!,
        categorySlug: 'mobile-electronics',
        status: 'ACTIVE',
        priceMinor: 5_000n,
      });

      const result = await callRoute(createOrderRoute, '/api/v1/orders', {
        method: 'POST',
        token: buyer.accessToken,
        body: { listingId: listing.id },
      });
      expect(result.status).toBe(409);
      expect(await prisma.order.count({ where: { listingId: listing.id } })).toBe(0);
    });

    it('allows a FEE_ONLY order from a seller with NO connected account', async () => {
      // The point of fee-only: a high-value seller transacts on day one,
      // because there is no transfer leg to be onboarded for.
      const other = await createTestUser({
        roles: ['seller'],
        withSellerProfile: true,
        stepUp: true,
      });
      const listing = await createTestListing({
        ownerSellerProfileId: other.sellerProfileId!,
        categorySlug: 'cars',
        status: 'ACTIVE',
        priceMinor: 3_000_000n,
      });

      const result = await callRoute(createOrderRoute, '/api/v1/orders', {
        method: 'POST',
        token: buyer.accessToken,
        body: { listingId: listing.id },
      });
      expect(result.status).toBe(201);
    });
  });

  // ── Forged input ──────────────────────────────────────────────────────────

  describe('forged input changes nothing', () => {
    it('ignores a forged amount, currency, commission, principal and seller', async () => {
      const listingId = await freshListing('mobile-electronics', 20_000n);
      const other = await createTestUser({
        roles: ['seller'],
        withSellerProfile: true,
        stepUp: true,
      });

      const result = await callRoute(createOrderRoute, '/api/v1/orders', {
        method: 'POST',
        token: buyer.accessToken,
        body: {
          listingId,
          // Every one of these is absent from the schema, so `z.object`'s
          // stripping means they never reach the handler at all.
          totalMinor: '1',
          amountMinor: '1',
          currency: 'USD',
          commissionAmountMinor: '0',
          commissionPercentBps: 0,
          principalMinor: '1',
          sellerProfileId: other.sellerProfileId,
          sellerId: other.id,
          stripeAccountId: 'acct_attacker',
          buyerId: stranger.id,
        },
      });

      expect(result.status).toBe(201);
      const row = await prisma.order.findUniqueOrThrow({
        where: { id: result.body.id as string },
        select: {
          totalMinor: true,
          currency: true,
          commissionAmountMinor: true,
          commissionPercentBps: true,
          principalMinor: true,
          sellerProfileId: true,
          buyerId: true,
        },
      });

      expect(row.totalMinor).toBe(20_000n);
      expect(row.currency).toBe('GBP');
      expect(row.commissionAmountMinor).toBe(1_200n);
      expect(row.commissionPercentBps).toBe(600);
      expect(row.principalMinor).toBeNull();
      // The seller is the LISTING's owner, not the one named in the request.
      expect(row.sellerProfileId).toBe(seller.sellerProfileId);
      // The buyer is the token subject.
      expect(row.buyerId).toBe(buyer.id);
    });

    it('ignores a forged offer belonging to somebody else', async () => {
      const listingId = await freshListing('mobile-electronics', 20_000n);

      // An accepted offer from a DIFFERENT buyer, at a giveaway price.
      const conversationless = await prisma.offer.create({
        data: {
          listingId,
          buyerId: stranger.id,
          amountMinor: 1n,
          currency: 'GBP',
          status: 'ACCEPTED',
          expiresAt: new Date(Date.now() + 86_400_000),
        },
        select: { id: true },
      });

      const result = await callRoute(createOrderRoute, '/api/v1/orders', {
        method: 'POST',
        token: buyer.accessToken,
        body: { listingId, offerId: conversationless.id },
      });

      // The offer is re-read SCOPED to this buyer, so it resolves to nothing.
      expect(result.status).toBe(404);
      expect(await prisma.order.count({ where: { listingId } })).toBe(0);
    });

    it('refuses a forged destination account at the payment step', async () => {
      const listingId = await freshListing('mobile-electronics', 20_000n);
      const orderId = await createOrder(buyer, listingId);

      const result = await callRoute(beginPayment, `/api/v1/orders/${orderId}/payment`, {
        method: 'POST',
        token: buyer.accessToken,
        params: { id: orderId },
        body: {
          destinationAccountId: 'acct_attacker',
          applicationFeeMinor: '0',
          amountMinor: '1',
        },
      });
      expect(result.status).toBe(201);

      // What WOULD have gone to Stripe. The seller's real account, the real
      // amount, the real fee.
      const sent = gateway.lastCreate()!;
      expect(sent.destinationAccountId).not.toBe('acct_attacker');
      expect(sent.destinationAccountId).toMatch(/^acct_test_/);
      expect(sent.amountMinor).toBe(20_000n);
      expect(sent.applicationFeeMinor).toBe(1_200n);
    });
  });

  // ── BUY_NOW payment ───────────────────────────────────────────────────────

  describe('BUY_NOW payment', () => {
    it('creates a destination charge with the application fee and the right seller', async () => {
      const listingId = await freshListing('mobile-electronics', 20_000n);
      const orderId = await createOrder(buyer, listingId);

      const result = await pay(buyer, orderId);
      expect(result.status).toBe(201);
      expect(result.body.clientSecret).toBeTruthy();
      expect(result.body.amountMinor).toBe('20000');
      expect(result.body.currency).toBe('GBP');
      // Impossible to mistake a sandbox charge for a real one.
      expect(result.body.testMode).toBe(true);

      const sent = gateway.lastCreate()!;
      expect(sent.amountMinor).toBe(20_000n);
      expect(sent.currency).toBe('GBP');
      expect(sent.applicationFeeMinor).toBe(1_200n);
      expect(sent.destinationAccountId).toMatch(/^acct_test_/);
      expect(sent.transferGroup).toBe(`order_${orderId}`);
      expect(sent.metadata.kurdora_order_id).toBe(orderId);

      const payment = await prisma.payment.findFirstOrThrow({
        where: { orderId },
        select: {
          amountMinor: true,
          applicationFeeAmountMinor: true,
          destinationAccountId: true,
          flowType: true,
          status: true,
          idempotencyKey: true,
        },
      });
      expect(payment.amountMinor).toBe(20_000n);
      expect(payment.applicationFeeAmountMinor).toBe(1_200n);
      expect(payment.flowType).toBe('BUY_NOW');
      expect(payment.status).toBe('REQUIRES_PAYMENT_METHOD');
      expect(payment.idempotencyKey).toBe(`order:${orderId}:pi:v1`);

      // The order moved to PENDING_PAYMENT — and NOT to PAID.
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('PENDING_PAYMENT');
    });

    it('is idempotent: a repeated request returns the same PaymentIntent', async () => {
      const listingId = await freshListing('mobile-electronics', 20_000n);
      const orderId = await createOrder(buyer, listingId);

      const first = await pay(buyer, orderId);
      const second = await pay(buyer, orderId);
      const third = await pay(buyer, orderId);

      expect(first.status).toBe(201);
      // 200, not 201: an existing payment was returned rather than created.
      expect(second.status).toBe(200);
      expect(third.status).toBe(200);
      expect(second.body.paymentId).toBe(first.body.paymentId);
      expect(third.body.paymentId).toBe(first.body.paymentId);

      // Exactly ONE financial object, however many times it was asked for.
      expect(await prisma.payment.count({ where: { orderId } })).toBe(1);
    });

    it('is idempotent even when our DB row is the only thing stopping it', async () => {
      // Stripe prunes idempotency keys after 24 hours. Simulated by clearing
      // the fake's memory: the provider would happily create a second intent,
      // and our unique index is what refuses.
      const listingId = await freshListing('mobile-electronics', 20_000n);
      const orderId = await createOrder(buyer, listingId);
      await pay(buyer, orderId);

      const forgetful = new FakePaymentGateway();
      const order = await loadOrderForParty(orderId, buyer.id);
      const again = await createPaymentForOrder({ order: order!, gateway: forgetful });

      expect(again.ok).toBe(true);
      if (again.ok) expect(again.reused).toBe(true);
      // The forgetful provider was never called: our row answered first.
      expect(forgetful.creates.length).toBe(0);
      expect(await prisma.payment.count({ where: { orderId } })).toBe(1);
    });

    it('refuses a seller starting a payment on their buyer’s order', async () => {
      const listingId = await freshListing('mobile-electronics', 20_000n);
      const orderId = await createOrder(buyer, listingId);

      const result = await pay(seller, orderId);
      // 404, never 403: the order's existence is not confirmed.
      expect(result.status).toBe(404);
      expect(await prisma.payment.count({ where: { orderId } })).toBe(0);
    });
  });

  // ── FEE_ONLY ──────────────────────────────────────────────────────────────

  describe('FEE_ONLY never charges the principal', () => {
    it('sends the fee to the provider and nothing else', async () => {
      const listingId = await freshListing('cars', 5_000_000n);
      const orderId = await createOrder(buyer, listingId);

      const result = await pay(buyer, orderId);
      expect(result.status).toBe(201);

      const sent = gateway.lastCreate()!;
      // £250.00 — the fee. NOT £50,000.00.
      expect(sent.amountMinor).toBe(25_000n);
      expect(sent.amountMinor).not.toBe(5_000_000n);
      expect(sent.amountMinor).toBeLessThan(5_000_000n);
      // No transfer leg at all. Nothing to get wrong.
      expect(sent.destinationAccountId).toBeUndefined();
      expect(sent.applicationFeeMinor).toBeUndefined();
      // The buyer's statement says what the charge is FOR.
      expect(sent.statementDescriptorSuffix).toBe('MARKETPLACE FEE');

      const payment = await prisma.payment.findFirstOrThrow({ where: { orderId } });
      expect(payment.amountMinor).toBe(25_000n);
      expect(payment.destinationAccountId).toBeNull();
      expect(payment.applicationFeeAmountMinor).toBeNull();
      expect(payment.flowType).toBe('FEE_ONLY');
    });

    it('never sends the principal at any sale price', async () => {
      for (const price of [1_000_000n, 5_000_000n, 20_000_000n]) {
        const listingId = await freshListing('cars', price);
        const orderId = await createOrder(buyer, listingId);
        await pay(buyer, orderId);

        const sent = gateway.lastCreate()!;
        expect(sent.amountMinor, price.toString()).toBe(price / 200n); // 0.5%
        expect(sent.amountMinor, price.toString()).toBeLessThan(price);
      }
    });

    it('is refused by the DATABASE if code ever tried to charge the principal', async () => {
      // The application guard is not the only line. This writes directly,
      // bypassing every TypeScript check, and Postgres refuses it.
      const listingId = await freshListing('cars', 5_000_000n);
      const orderId = await createOrder(buyer, listingId);

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE orders SET total_minor = 5000000, subtotal_minor = 5000000 WHERE id = $1::uuid`,
          orderId,
        ),
      ).rejects.toThrow();

      const row = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(row.totalMinor).toBe(25_000n);
    });

    it('is refused by the DATABASE if a fee-only payment grew a transfer leg', async () => {
      const listingId = await freshListing('cars', 5_000_000n);
      const orderId = await createOrder(buyer, listingId);
      await pay(buyer, orderId);
      const payment = await prisma.payment.findFirstOrThrow({ where: { orderId } });

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE payments SET destination_account_id = 'acct_x', application_fee_amount_minor = 1 WHERE id = $1::uuid`,
          payment.id,
        ),
      ).rejects.toThrow();
    });
  });

  // ── Snapshot immutability ─────────────────────────────────────────────────

  describe('the money snapshot is immutable once the order leaves DRAFT', () => {
    it('refuses to rewrite the commission after payment has begun', async () => {
      const listingId = await freshListing('mobile-electronics', 20_000n);
      const orderId = await createOrder(buyer, listingId);
      await pay(buyer, orderId); // DRAFT -> PENDING_PAYMENT

      // "Changing a commission rule tomorrow must NEVER rewrite yesterday's
      // orders" — now a trigger, not only a comment.
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE orders SET commission_amount_minor = 0, seller_amount_minor = 20000 WHERE id = $1::uuid`,
          orderId,
        ),
      ).rejects.toThrow(/immutable/i);

      const row = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(row.commissionAmountMinor).toBe(1_200n);
    });

    it('still allows a DRAFT order to be corrected', async () => {
      const listingId = await freshListing('mobile-electronics', 20_000n);
      const orderId = await createOrder(buyer, listingId);

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE orders SET commission_amount_minor = 1000, seller_amount_minor = 19000 WHERE id = $1::uuid`,
          orderId,
        ),
      ).resolves.toBeDefined();
    });
  });

  // ── IDOR ──────────────────────────────────────────────────────────────────

  describe('IDOR against orders and payments', () => {
    let orderId: string;

    beforeAll(async () => {
      const listingId = await freshListing('mobile-electronics', 20_000n);
      orderId = await createOrder(buyer, listingId);
    });

    it('gives a stranger the same 404 for a real order as for a made-up id', async () => {
      const real = await callRoute(getOrder, `/api/v1/orders/${orderId}`, {
        token: stranger.accessToken,
        params: { id: orderId },
      });
      const fake = await callRoute(getOrder, `/api/v1/orders/${orphanId()}`, {
        token: stranger.accessToken,
        params: { id: orphanId() },
      });

      expect(real.status).toBe(404);
      expect(fake.status).toBe(404);

      // Compared without `requestId`, which is unique per request by design.
      const shape = (body: Record<string, unknown>) => {
        const error = body.error as { code: string; message: string };
        return { code: error.code, message: error.message };
      };
      expect(shape(real.body)).toEqual(shape(fake.body));
    });

    it('refuses a stranger starting a payment on someone else’s order', async () => {
      const result = await pay(stranger, orderId);
      expect(result.status).toBe(404);
      expect(await prisma.payment.count({ where: { orderId } })).toBe(0);
    });

    it('lets both parties read the order, and nobody else', async () => {
      for (const party of [buyer, seller]) {
        const result = await callRoute(getOrder, `/api/v1/orders/${orderId}`, {
          token: party.accessToken,
          params: { id: orderId },
        });
        expect(result.status).toBe(200);
      }
    });

    it('404s an unparseable id rather than leaking a database error', async () => {
      const read = await callRoute(getOrder, '/api/v1/orders/not-a-uuid', {
        token: buyer.accessToken,
        params: { id: 'not-a-uuid' },
      });
      const paid = await callRoute(beginPayment, '/api/v1/orders/not-a-uuid/payment', {
        method: 'POST',
        token: buyer.accessToken,
        params: { id: 'not-a-uuid' },
      });
      expect(read.status).toBe(404);
      expect(paid.status).toBe(404);
    });
  });

  // ── Webhooks ──────────────────────────────────────────────────────────────

  describe('webhooks are the only way an order becomes PAID', () => {
    async function paidOrderFixture(slug: string, price: bigint) {
      const listingId = await freshListing(slug, price);
      const orderId = await createOrder(buyer, listingId);
      const result = await pay(buyer, orderId);
      const payment = await prisma.payment.findFirstOrThrow({ where: { orderId } });
      return { orderId, paymentId: payment.id, intentId: payment.providerPaymentIntentId, result };
    }

    it('marks the order paid and posts a balanced ledger group', async () => {
      const { orderId, intentId } = await paidOrderFixture('mobile-electronics', 20_000n);

      const body = fakeEventBody({
        type: 'payment_intent.succeeded',
        intentId,
        status: 'succeeded',
        latestChargeId: `ch_fake_${Date.now()}`,
        amountMinor: 20_000n,
      });
      const event = gateway.constructEvent(body, 'valid-signature');

      expect(await recordEvent(event)).toEqual({ ok: true, duplicate: false });
      expect(await processEvent(event.id, gateway)).toBe('processed');

      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('PAID');
      expect(order.paidAt).not.toBeNull();

      const entries = await prisma.ledgerEntry.findMany({ where: { orderId } });
      expect(entries.length).toBe(3);
      // The zero-sum trigger already verified this at COMMIT; asserting it
      // here says what the recipe MEANS.
      const sum = entries.reduce(
        (total, entry) =>
          total + (entry.direction === 'DEBIT' ? entry.amountMinor : -entry.amountMinor),
        0n,
      );
      expect(sum).toBe(0n);

      const events = await prisma.orderEvent.findMany({
        where: { orderId, toStatus: 'PAID' },
        select: { actorType: true, actorId: true },
      });
      // The audit trail says who really did it.
      expect(events[0]?.actorType).toBe('stripe_webhook');
      expect(events[0]?.actorId).toBeNull();
    });

    it('posts NO seller payable for a fee-only order', async () => {
      const { orderId, intentId } = await paidOrderFixture('cars', 5_000_000n);

      const event = gateway.constructEvent(
        fakeEventBody({
          type: 'payment_intent.succeeded',
          intentId,
          status: 'succeeded',
          latestChargeId: `ch_fake_fee_${Date.now()}`,
          amountMinor: 25_000n,
        }),
        'valid-signature',
      );
      await recordEvent(event);
      expect(await processEvent(event.id, gateway)).toBe('processed');

      const entries = await prisma.ledgerEntry.findMany({ where: { orderId } });
      // Kurdora never holds the sale price, so it owes the seller nothing.
      expect(entries.some((entry) => entry.account === 'SELLER_PAYABLE')).toBe(false);
      expect(entries.every((entry) => entry.amountMinor === 25_000n)).toBe(true);
    });

    it('refuses an event whose signature does not verify', async () => {
      const { intentId } = await paidOrderFixture('mobile-electronics', 20_000n);
      const body = fakeEventBody({
        type: 'payment_intent.succeeded',
        intentId,
        status: 'succeeded',
      });
      expect(() => gateway.constructEvent(body, 'INVALID-signature')).toThrow();
      expect(() => gateway.constructEvent(body, '')).toThrow();
    });

    it('ignores a duplicate delivery of the same event', async () => {
      const { orderId, intentId } = await paidOrderFixture('mobile-electronics', 20_000n);
      const body = fakeEventBody({
        id: `evt_dupe_${Date.now()}`,
        type: 'payment_intent.succeeded',
        intentId,
        status: 'succeeded',
        latestChargeId: `ch_dupe_${Date.now()}`,
      });

      const first = gateway.constructEvent(body, 'valid');
      await recordEvent(first);
      expect(await processEvent(first.id, gateway)).toBe('processed');

      // Byte-identical redelivery. The primary key IS the event id.
      const second = gateway.constructEvent(body, 'valid');
      expect(await recordEvent(second)).toEqual({ ok: true, duplicate: true });

      // Exactly one ledger group, not two.
      const entries = await prisma.ledgerEntry.findMany({ where: { orderId } });
      expect(new Set(entries.map((entry) => entry.entryGroupId)).size).toBe(1);
    });

    it('ignores a SEMANTIC duplicate — a different event id, same change', async () => {
      const { orderId, intentId } = await paidOrderFixture('mobile-electronics', 20_000n);
      const charge = `ch_sem_${Date.now()}`;

      const first = gateway.constructEvent(
        fakeEventBody({
          id: `evt_sem_a_${Date.now()}`,
          type: 'payment_intent.succeeded',
          intentId,
          status: 'succeeded',
          latestChargeId: charge,
        }),
        'valid',
      );
      await recordEvent(first);
      expect(await processEvent(first.id, gateway)).toBe('processed');

      // Stripe: "in some cases, two separate Event objects are generated and
      // sent". Different id, same (type, object) — the PK cannot catch it.
      const second = gateway.constructEvent(
        fakeEventBody({
          id: `evt_sem_b_${Date.now()}`,
          type: 'payment_intent.succeeded',
          intentId,
          status: 'succeeded',
          latestChargeId: charge,
        }),
        'valid',
      );
      expect(await recordEvent(second)).toEqual({ ok: true, duplicate: false });
      expect(await processEvent(second.id, gateway)).toBe('duplicate');

      const entries = await prisma.ledgerEntry.findMany({ where: { orderId } });
      expect(new Set(entries.map((entry) => entry.entryGroupId)).size).toBe(1);
    });

    it('defers an out-of-order event instead of failing it', async () => {
      // A webhook for an intent we have no payment row for yet. Expected, not
      // exceptional: left PENDING for a retry, never dropped.
      const event = gateway.constructEvent(
        fakeEventBody({
          type: 'payment_intent.succeeded',
          intentId: `pi_unknown_${Date.now()}`,
          status: 'succeeded',
        }),
        'valid',
      );
      await recordEvent(event);
      expect(await processEvent(event.id, gateway)).toBe('deferred');

      const row = await prisma.paymentEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect(row.status).toBe('PENDING');
      expect(row.attempts).toBe(1);
    });

    it('records an unhandled event type without acting on it', async () => {
      const event = gateway.constructEvent(
        fakeEventBody({
          type: 'customer.subscription.created',
          intentId: `sub_${Date.now()}`,
          status: 'active',
        }),
        'valid',
      );
      await recordEvent(event);
      expect(await processEvent(event.id, gateway)).toBe('ignored');
    });

    it('never acts on an event recorded as unverified', async () => {
      const { intentId } = await paidOrderFixture('mobile-electronics', 20_000n);
      const id = `evt_unverified_${Date.now()}`;

      // Written directly with signatureVerified=false, which no code path
      // produces today — the column exists so the rule stays enforceable.
      await prisma.paymentEvent.create({
        data: {
          id,
          type: 'payment_intent.succeeded',
          signatureVerified: false,
          payload: JSON.parse(
            fakeEventBody({ type: 'payment_intent.succeeded', intentId, status: 'succeeded' }),
          ),
          relatedObjectId: intentId,
          status: 'PENDING',
        },
      });

      expect(await processEvent(id, gateway)).toBe('failed');
    });

    it('a failed payment leaves the order unpaid', async () => {
      const { orderId, intentId } = await paidOrderFixture('mobile-electronics', 20_000n);

      const event = gateway.constructEvent(
        fakeEventBody({
          type: 'payment_intent.payment_failed',
          intentId,
          status: 'requires_payment_method',
          lastPaymentError: { code: 'card_declined', message: 'Your card was declined.' },
        }),
        'valid',
      );
      await recordEvent(event);
      await processEvent(event.id, gateway);

      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('PENDING_PAYMENT');
      expect(await prisma.ledgerEntry.count({ where: { orderId } })).toBe(0);
    });
  });

  // ── The browser is never the source of truth ──────────────────────────────

  describe('the browser return never marks an order paid', () => {
    it('reports the order unpaid until a webhook says otherwise', async () => {
      const listingId = await freshListing('mobile-electronics', 20_000n);
      const orderId = await createOrder(buyer, listingId);
      await pay(buyer, orderId);

      /*
       * This is what the return-from-Stripe page reads. The buyer has "come
       * back from checkout" and may have appended anything they like to the
       * URL — the answer comes from the order row, which only a verified
       * webhook can move.
       */
      const result = await callRoute(getOrder, `/api/v1/orders/${orderId}`, {
        token: buyer.accessToken,
        params: { id: orderId },
        searchParams: {
          payment_intent: 'pi_whatever',
          redirect_status: 'succeeded',
          status: 'PAID',
        },
      });

      expect(result.status).toBe(200);
      const order = result.body.order as { status: string };
      expect(order.status).toBe('PENDING_PAYMENT');
      expect(order.status).not.toBe('PAID');

      const row = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(row.status).toBe('PENDING_PAYMENT');
      expect(row.paidAt).toBeNull();
    });
  });
});
