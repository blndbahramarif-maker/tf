import { prisma } from '@/infra/db/client';
import type { BillingGateway, ProviderSubscription } from '@/domain/billing/billing-gateway';
import {
  canTransitionSubscription,
  isStaleProviderUpdate,
  listingMayBeVisible,
  type SubscriptionStatus,
} from '@/domain/billing/subscription-status';

/**
 * Listing subscriptions: Kurdora's own service billing.
 *
 * Two rules shape every function here.
 *
 *   **The seller names a LISTING and nothing else.** The plan, the price, the
 *   currency and the Stripe customer are all read from the database. There is
 *   no `amount`, no `priceId`, no `status` and no `stripeSubscriptionId`
 *   parameter anywhere — so a forged one has nowhere to arrive.
 *
 *   **Only `applyProviderSubscription` may change payability**, and it takes a
 *   `ProviderSubscription`, which only the Stripe adapter can produce from a
 *   real object or a signature-verified event.
 */

export type CheckoutIssue =
  'no_seller_profile' | 'listing_not_found' | 'plan_unavailable' | 'already_subscribed';

export type StartCheckoutResult =
  | { readonly ok: true; readonly url: string; readonly subscriptionId: string }
  | { readonly ok: false; readonly issue: CheckoutIssue };

/** Deterministic. A retried checkout must not create a second subscription. */
export function subscriptionIdempotencyKey(listingId: string): string {
  return `listing:${listingId}:sub:v1`;
}

/** The plan a listing is billed under. Data, not a constant. */
export const LISTING_PLAN_KEY = 'listing_monthly';

export async function loadActivePlan(key = LISTING_PLAN_KEY) {
  return prisma.servicePlan.findFirst({
    where: { key, isActive: true },
    select: {
      id: true,
      key: true,
      name: true,
      amountMinor: true,
      currency: true,
      interval: true,
      stripePriceId: true,
    },
  });
}

/**
 * Starts a Checkout Session for one listing.
 *
 * The listing is loaded SCOPED BY the caller's user id, so a seller cannot
 * start a subscription against somebody else's listing — the ownership test is
 * the query, not a comparison afterwards.
 */
export async function startListingCheckout(input: {
  userId: string;
  listingId: string;
  gateway: BillingGateway;
  successUrl: string;
  cancelUrl: string;
}): Promise<StartCheckoutResult> {
  const listing = await prisma.listing.findFirst({
    where: { id: input.listingId, deletedAt: null, sellerProfile: { userId: input.userId } },
    select: {
      id: true,
      sellerProfileId: true,
      subscription: { select: { id: true, status: true } },
      sellerProfile: { select: { id: true, user: { select: { id: true, email: true } } } },
    },
  });
  if (listing === null) return { ok: false, issue: 'listing_not_found' };

  /*
   * Already subscribed, in a state that is doing something. INCOMPLETE counts:
   * the seller has a Checkout Session open, and minting a second would create
   * two subscriptions for one listing if they completed both.
   */
  const existing = listing.subscription;
  if (
    existing !== null &&
    existing.status !== 'CANCELED' &&
    existing.status !== 'INCOMPLETE_EXPIRED'
  ) {
    return { ok: false, issue: 'already_subscribed' };
  }

  const plan = await loadActivePlan();
  // A plan with no Stripe Price cannot be billed. Refusing is the safe answer:
  // the alternative is a checkout that fails in Stripe's UI.
  if (plan === null || plan.stripePriceId === null) return { ok: false, issue: 'plan_unavailable' };

  const customerId = await ensureBillingCustomer({
    userId: listing.sellerProfile.user.id,
    email: listing.sellerProfile.user.email,
    gateway: input.gateway,
  });

  const customer = await prisma.billingCustomer.findUniqueOrThrow({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });

  const session = await input.gateway.createCheckoutSession({
    customerId,
    priceId: plan.stripePriceId,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    metadata: { kurdora_listing_id: listing.id, kurdora_plan_key: plan.key },
    idempotencyKey: subscriptionIdempotencyKey(listing.id),
  });

  /*
   * Recorded as INCOMPLETE — the ONLY status the platform may ever write.
   * It grants nothing: `grantsListingAccess` excludes it, and a CHECK
   * constraint refuses an access-granting status without a provider id.
   */
  const subscription = await prisma.listingSubscription.upsert({
    where: { listingId: listing.id },
    create: {
      listingId: listing.id,
      sellerProfileId: listing.sellerProfileId,
      billingCustomerId: customer.id,
      planId: plan.id,
      status: 'INCOMPLETE',
      stripeCheckoutSessionId: session.id,
      // SNAPSHOT of the price at checkout. The plan can be re-priced later;
      // what this seller agreed to must not change under them.
      amountMinor: plan.amountMinor,
      currency: plan.currency,
      idempotencyKey: subscriptionIdempotencyKey(listing.id),
    },
    update: { stripeCheckoutSessionId: session.id, planId: plan.id, status: 'INCOMPLETE' },
    select: { id: true },
  });

  await prisma.subscriptionEvent.create({
    data: { subscriptionId: subscription.id, toStatus: 'INCOMPLETE', reason: 'checkout_started' },
  });

  return { ok: true, url: session.url, subscriptionId: subscription.id };
}

/** Finds or creates the Stripe Customer for a user, once. */
async function ensureBillingCustomer(input: {
  userId: string;
  email: string;
  gateway: BillingGateway;
}): Promise<string> {
  const existing = await prisma.billingCustomer.findUnique({
    where: { userId: input.userId },
    select: { stripeCustomerId: true },
  });
  if (existing !== null) return existing.stripeCustomerId;

  const stripeCustomerId = await input.gateway.ensureCustomer({
    email: input.email,
    metadata: { kurdora_user_id: input.userId },
    idempotencyKey: `user:${input.userId}:cus:v1`,
  });

  await prisma.billingCustomer.create({ data: { userId: input.userId, stripeCustomerId } });
  return stripeCustomerId;
}

export type ApplyOutcome = 'applied' | 'stale' | 'refused' | 'not_found';

/**
 * Writes a provider subscription onto our row.
 *
 * **The only function that may change a listing's payability.**
 *
 * Three independent protections, and they guard different things:
 *
 *   1. TERMINAL — a `CANCELED` subscription is never reopened by a later
 *      event, because Stripe says canceled "can't be updated" and a
 *      re-granting event after a cancellation is the expensive direction.
 *   2. STALE — Stripe does not guarantee ordering, so an older description
 *      arriving after a newer one is refused by timestamp.
 *   3. The status is derived from the PROVIDER object, never from a request.
 *
 * The listing's visibility is updated in the SAME transaction, so there is no
 * window in which a lapsed subscription leaves a paid listing live.
 */
export async function applyProviderSubscription(input: {
  provider: ProviderSubscription;
  providerEventId: string | null;
}): Promise<ApplyOutcome> {
  const row = await prisma.listingSubscription.findFirst({
    where: {
      OR: [
        { stripeSubscriptionId: input.provider.subscriptionId },
        { billingCustomer: { stripeCustomerId: input.provider.customerId }, status: 'INCOMPLETE' },
      ],
    },
    select: {
      id: true,
      listingId: true,
      status: true,
      providerUpdatedAt: true,
      stripeSubscriptionId: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  if (row === null) return 'not_found';

  const from = row.status as SubscriptionStatus;
  const to = input.provider.status;

  if (
    isStaleProviderUpdate({
      lastAppliedAt: row.providerUpdatedAt,
      eventObjectUpdatedAt: input.provider.updatedAt,
    })
  ) {
    return 'stale';
  }

  const decision = canTransitionSubscription(from, to, 'provider');
  // `no_op` still refreshes the mirrored facts below; only a REFUSED move
  // (terminal) holds the status back.
  if (!decision.allowed && decision.reason === 'terminal') return 'refused';

  const nextStatus = decision.allowed ? to : from;

  await prisma.$transaction(async (tx) => {
    await tx.listingSubscription.update({
      where: { id: row.id },
      data: {
        status: nextStatus,
        stripeSubscriptionId: input.provider.subscriptionId,
        stripeLatestInvoiceId: input.provider.latestInvoiceId,
        currentPeriodEnd: input.provider.currentPeriodEnd,
        cancelAtPeriodEnd: input.provider.cancelAtPeriodEnd,
        canceledAt: input.provider.canceledAt,
        providerUpdatedAt: input.provider.updatedAt,
      },
    });

    if (nextStatus !== from) {
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: row.id,
          fromStatus: from,
          toStatus: nextStatus,
          providerEventId: input.providerEventId,
        },
      });
    }

    /*
     * The listing follows the subscription, in the same transaction.
     *
     * A lapsed subscription PAUSES the listing rather than removing it: the
     * seller's work, images and history survive, and paying again republishes.
     * Removal is a moderation outcome and must not be confused with a billing
     * one — a seller whose card expired has not done anything wrong.
     */
    const visible = listingMayBeVisible({ subscriptionRequired: true, status: nextStatus });

    if (!visible) {
      await tx.listing.updateMany({
        where: { id: row.listingId, status: 'ACTIVE' },
        data: { status: 'PAUSED' },
      });
    }
  });

  return 'applied';
}

/** What to show a seller about their listing's subscription. */
export async function loadSubscriptionForOwner(listingId: string, userId: string) {
  return prisma.listingSubscription.findFirst({
    // Ownership is the QUERY. A listing id belonging to someone else resolves
    // to nothing, and the caller answers 404.
    where: { listingId, listing: { sellerProfile: { userId }, deletedAt: null } },
    select: {
      id: true,
      status: true,
      amountMinor: true,
      currency: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
      plan: { select: { key: true, name: true, interval: true } },
    },
  });
}
