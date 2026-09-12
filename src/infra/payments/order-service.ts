import { prisma } from '@/infra/db/client';
import {
  assertChargeIsSafe,
  computeOrderAmounts,
  isFeeOnly,
  type CommissionSnapshot,
  type OrderAmounts,
  type TransactionFlow,
} from '@/domain/payments/order-amounts';
import { orderExpiryFrom, type OrderStatus } from '@/domain/payments/order-status';

/**
 * Orders: creation, and reading one as a party to it.
 *
 * The rule that shapes every function here:
 *
 *   **The request supplies a listing id. Nothing else.**
 *
 * The price, the currency, the seller, the connected account, the transaction
 * flow, the category ceiling and the commission are all read from the database
 * inside this file. A browser that sends an amount, a `stripeAccountId` or a
 * commission is sending a field that is never read — not rejected with a
 * warning, simply absent from the code path.
 *
 * Loading follows the Phase 6 pattern: the viewer's id goes INTO the query, so
 * a non-party gets `null` and the caller answers 404 rather than 403.
 */

export interface OrderWithParties {
  readonly id: string;
  readonly orderNumber: string;
  readonly listingId: string;
  readonly buyerId: string;
  readonly sellerUserId: string;
  readonly sellerProfileId: string;
  readonly flowType: TransactionFlow;
  readonly status: OrderStatus;
  readonly totalMinor: bigint;
  readonly commissionAmountMinor: bigint;
  readonly sellerAmountMinor: bigint;
  readonly principalMinor: bigint | null;
  readonly currency: string;
  readonly listingTitle: string;
  /** Null for FEE_ONLY, where no connected account is involved at all. */
  readonly destinationAccountId: string | null;
  readonly expiresAt: Date | null;
}

/**
 * Loads an order only if the viewer is its buyer or the listing's seller.
 *
 * Returns null for "no such order" AND for "not yours", so the two are
 * indistinguishable at the data layer rather than only at the route.
 */
export async function loadOrderForParty(
  orderId: string,
  viewerId: string,
): Promise<OrderWithParties | null> {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      // The party test IS the query. There is no post-hoc comparison to skip.
      OR: [{ buyerId: viewerId }, { sellerProfile: { userId: viewerId } }],
    },
    select: {
      id: true,
      orderNumber: true,
      listingId: true,
      buyerId: true,
      sellerProfileId: true,
      flowType: true,
      status: true,
      totalMinor: true,
      commissionAmountMinor: true,
      sellerAmountMinor: true,
      principalMinor: true,
      currency: true,
      expiresAt: true,
      sellerProfile: { select: { userId: true, stripeAccountId: true } },
      listing: { select: { title: true } },
    },
  });

  if (order === null) return null;

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    listingId: order.listingId,
    buyerId: order.buyerId,
    sellerUserId: order.sellerProfile.userId,
    sellerProfileId: order.sellerProfileId,
    flowType: order.flowType as TransactionFlow,
    status: order.status as OrderStatus,
    totalMinor: order.totalMinor,
    commissionAmountMinor: order.commissionAmountMinor,
    sellerAmountMinor: order.sellerAmountMinor,
    principalMinor: order.principalMinor,
    currency: order.currency,
    listingTitle: order.listing.title,
    // Read from the SELLER PROFILE, never from a request. For FEE_ONLY it is
    // ignored entirely; see `resolveDestinationAccount`.
    destinationAccountId: isFeeOnly(order.flowType as TransactionFlow)
      ? null
      : order.sellerProfile.stripeAccountId,
    expiresAt: order.expiresAt,
  };
}

export type CreateOrderIssue =
  | 'listing_not_found'
  | 'own_listing'
  | 'seller_not_payable'
  | 'order_already_open'
  | 'not_purchasable'
  | 'no_price'
  | 'principal_required'
  | 'principal_not_positive'
  | 'amount_not_positive'
  | 'commission_exceeds_total'
  | 'above_online_ceiling'
  | 'currency_mismatch';

export type CreateOrderResult =
  | { readonly ok: true; readonly orderId: string; readonly amounts: OrderAmounts }
  | { readonly ok: false; readonly issue: CreateOrderIssue };

/**
 * The commission rule for a listing, resolved most-specific-first.
 *
 * Part 1 resolves SELLER → CATEGORY → PLATFORM. PROMO and COUNTRY scopes exist
 * in the schema and are not yet consulted; they are additive and belong with
 * the promotions work rather than here.
 */
async function resolveCommission(input: {
  categoryId: string;
  sellerProfileId: string;
  now: Date;
}): Promise<{ rule: CommissionSnapshot; ruleId: string | null }> {
  const active = {
    isActive: true,
    appliesTo: 'ORDER' as const,
    effectiveFrom: { lte: input.now },
    OR: [{ effectiveTo: null }, { effectiveTo: { gt: input.now } }],
  };

  const rule = await prisma.commissionRule.findFirst({
    where: {
      ...active,
      OR: [
        { scopeType: 'SELLER', sellerProfileId: input.sellerProfileId },
        { scopeType: 'CATEGORY', categoryId: input.categoryId },
        { scopeType: 'PLATFORM' },
      ],
    },
    // Most specific first, then the operator's explicit priority.
    orderBy: [{ scopeType: 'asc' }, { priority: 'desc' }, { effectiveFrom: 'desc' }],
    select: {
      id: true,
      percentBps: true,
      fixedMinor: true,
      minMinor: true,
      maxMinor: true,
      scopeType: true,
    },
  });

  /*
   * No rule at all is a CONFIGURATION FAILURE, not a zero-commission sale.
   * The seed guarantees a PLATFORM-scoped rule and one per category, so
   * reaching here means somebody deleted or expired them. Falling back to 0%
   * would quietly give the platform's margin away on every order until
   * somebody noticed in a monthly report.
   */
  if (rule === null) {
    throw new Error(
      `No active commission rule resolves for category ${input.categoryId}. ` +
        'Refusing to price an order at zero commission.',
    );
  }

  return {
    ruleId: rule.id,
    rule: {
      percentBps: rule.percentBps,
      fixedMinor: rule.fixedMinor,
      minMinor: rule.minMinor,
      maxMinor: rule.maxMinor,
    },
  };
}

let orderSequence = 0;

/** Human-readable and unique. Used in support and on receipts. */
function nextOrderNumber(now: Date): string {
  orderSequence += 1;
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0');
  return `KD-${stamp}-${random}${orderSequence % 100}`;
}

export interface CreateOrderInput {
  readonly listingId: string;
  readonly buyerId: string;
  /**
   * An accepted offer, when the order comes from one. Its amount replaces the
   * listing's asking price as the agreed price — but it is re-read from the
   * database here, not taken from the request.
   */
  readonly offerId?: string | null;
  readonly now?: Date;
}

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const now = input.now ?? new Date();

  const listing = await prisma.listing.findFirst({
    // Only a LIVE listing can be bought. A draft or paused one answers exactly
    // as a missing one does.
    where: { id: input.listingId, status: 'ACTIVE', deletedAt: null },
    select: {
      id: true,
      title: true,
      priceMinor: true,
      currency: true,
      categoryId: true,
      sellerProfileId: true,
      sellerProfile: {
        select: {
          id: true,
          userId: true,
          stripeAccountId: true,
          chargesEnabled: true,
          payoutsEnabled: true,
        },
      },
      category: {
        select: {
          transactionFlow: true,
          maxOnlineAmountMinor: true,
          allowsOnlinePayment: true,
        },
      },
    },
  });
  if (listing === null) return { ok: false, issue: 'listing_not_found' };

  // A seller buying their own listing is not a transaction.
  if (listing.sellerProfile.userId === input.buyerId) return { ok: false, issue: 'own_listing' };

  const flow = listing.category.transactionFlow as TransactionFlow;
  if (!listing.category.allowsOnlinePayment) return { ok: false, issue: 'not_purchasable' };

  /*
   * Seller eligibility, re-read from the database every time.
   *
   * FEE_ONLY needs NO connected account: Kurdora is charging for its own
   * service and there is no transfer leg. That is exactly why a high-value
   * seller can transact before they have onboarded at all.
   */
  if (!isFeeOnly(flow)) {
    const seller = listing.sellerProfile;
    if (seller.stripeAccountId === null || !seller.chargesEnabled || !seller.payoutsEnabled) {
      return { ok: false, issue: 'seller_not_payable' };
    }
  }

  // The agreed price: an accepted offer if there is one, otherwise the asking
  // price. Both are read from the database.
  let agreedPriceMinor = listing.priceMinor;
  let offerId: string | null = null;

  if (input.offerId) {
    const offer = await prisma.offer.findFirst({
      where: {
        id: input.offerId,
        // Scoped to this buyer and this listing, so an offer id belonging to
        // somebody else cannot set the price.
        buyerId: input.buyerId,
        listingId: listing.id,
        status: 'ACCEPTED',
      },
      select: { id: true, amountMinor: true, currency: true },
    });
    if (offer === null) return { ok: false, issue: 'listing_not_found' };
    if (offer.currency.toUpperCase() !== listing.currency.toUpperCase()) {
      return { ok: false, issue: 'currency_mismatch' };
    }
    agreedPriceMinor = offer.amountMinor;
    offerId = offer.id;
  }

  const { rule, ruleId } = await resolveCommission({
    categoryId: listing.categoryId,
    sellerProfileId: listing.sellerProfileId,
    now,
  });

  const computed = computeOrderAmounts({
    flow,
    agreedPriceMinor,
    currency: listing.currency,
    listingCurrency: listing.currency,
    commission: rule,
    maxOnlineAmountMinor: listing.category.maxOnlineAmountMinor,
  });
  if (!computed.ok) return { ok: false, issue: computed.issue };

  const amounts = computed.amounts;

  try {
    const created = await prisma.order.create({
      data: {
        orderNumber: nextOrderNumber(now),
        listingId: listing.id,
        buyerId: input.buyerId,
        sellerProfileId: listing.sellerProfileId,
        ...(offerId === null ? {} : { offerId }),
        flowType: flow,
        status: 'DRAFT',
        /*
         * `subtotal` equals the total because Part 1 has no shipping and no
         * tax. The Phase 2 CHECK `orders_total_is_sum_of_parts` requires
         * total = subtotal + shipping + tax, so this is not a shortcut — it is
         * the value that satisfies the existing invariant.
         */
        subtotalMinor: amounts.totalMinor,
        totalMinor: amounts.totalMinor,
        principalMinor: amounts.principalMinor,
        currency: amounts.currency,
        ...(ruleId === null ? {} : { commissionRuleId: ruleId }),
        commissionPercentBps: rule.percentBps,
        commissionFixedMinor: rule.fixedMinor,
        commissionAmountMinor: amounts.commissionAmountMinor,
        sellerAmountMinor: amounts.sellerAmountMinor,
        expiresAt: orderExpiryFrom(now),
        buyerSnapshot: { userId: input.buyerId } as never,
        listingSnapshot: {
          listingId: listing.id,
          title: listing.title,
          priceMinor: listing.priceMinor?.toString() ?? null,
          currency: listing.currency,
        } as never,
        items: {
          create: {
            listingId: listing.id,
            quantity: 1,
            unitPriceMinor: amounts.totalMinor,
            totalMinor: amounts.totalMinor,
            currency: amounts.currency,
            titleSnapshot: listing.title,
          },
        },
        events: {
          create: {
            fromStatus: null,
            toStatus: 'DRAFT',
            actorType: 'buyer',
            actorId: input.buyerId,
          },
        },
      },
      select: { id: true },
    });

    return { ok: true, orderId: created.id, amounts };
  } catch (error) {
    // One open order per (buyer, listing) is a Phase 2 partial unique index.
    if (isUniqueViolation(error, 'orders_one_open_per_buyer_listing')) {
      return { ok: false, issue: 'order_already_open' };
    }
    throw error;
  }
}

/**
 * The connected account a charge should pay, resolved from the ORDER.
 *
 * Returns null for FEE_ONLY, which has no transfer leg. Throws when a
 * marketplace order has no account — better a loud failure here than a charge
 * that silently keeps the seller's money on the platform.
 */
export function resolveDestinationAccount(order: OrderWithParties): string | null {
  if (isFeeOnly(order.flowType)) return null;
  if (order.destinationAccountId === null) {
    throw new Error('A marketplace order has no connected account to pay.');
  }
  return order.destinationAccountId;
}

/**
 * The final check before a charge is assembled.
 *
 * Re-derives the shape from the order row rather than trusting whatever the
 * caller assembled, then hands it to the domain assertion. Belt and braces on
 * purpose: this is the £50,000 mistake's last chance to be caught.
 */
export function chargeShapeForOrder(order: OrderWithParties): {
  amountMinor: bigint;
  destinationAccountId: string | null;
  applicationFeeMinor: bigint | null;
} {
  const destinationAccountId = resolveDestinationAccount(order);
  const applicationFeeMinor = destinationAccountId === null ? null : order.commissionAmountMinor;

  assertChargeIsSafe({
    flow: order.flowType,
    chargeAmountMinor: order.totalMinor,
    commissionAmountMinor: order.commissionAmountMinor,
    principalMinor: order.principalMinor,
    destinationAccountId,
    applicationFeeMinor,
  });

  return { amountMinor: order.totalMinor, destinationAccountId, applicationFeeMinor };
}

/**
 * Shape-checks a Prisma unique-constraint failure against a named constraint.
 *
 * Read structurally rather than by importing the generated error class. Prisma
 * reports the name under `meta.target` through its own engine and nested under
 * `meta.driverAdapterError` through a driver adapter, which is the path this
 * project uses; both are read.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; meta?: Record<string, unknown> };
  if (candidate.code !== 'P2002') return false;

  const target = candidate.meta?.target;
  if (typeof target === 'string' && target === constraint) return true;
  if (Array.isArray(target) && target.includes(constraint)) return true;

  const adapter = candidate.meta?.driverAdapterError as
    { cause?: { constraint?: { index?: unknown } } } | undefined;
  return adapter?.cause?.constraint?.index === constraint;
}
