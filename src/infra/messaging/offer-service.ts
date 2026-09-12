import { prisma } from '@/infra/db/client';
import {
  canTransitionOffer,
  hasExpired,
  offerExpiryFrom,
  type OfferActor,
  type OfferStatus,
} from '@/domain/offers/offer-status';
import { validateOfferAmount } from '@/domain/offers/offer-amount';

/**
 * Offer persistence and transitions.
 *
 * The two rules that shape this file:
 *
 *   The SERVER decides who you are. `resolveActor` reads the buyer from the
 *   offer row and the seller from the listing's owner, then compares both
 *   against the viewer's id from the session. Nothing about role comes from
 *   the request, so a seller cannot withdraw a buyer's offer by claiming to be
 *   the buyer.
 *
 *   Every transition writes an `offer_events` row in the SAME transaction as
 *   the status change. The events table is append-only at the database level,
 *   so the history cannot be quietly rewritten later — which is the whole
 *   point of having one.
 */

export interface OfferWithParties {
  readonly id: string;
  readonly listingId: string;
  readonly conversationId: string | null;
  readonly buyerId: string;
  readonly sellerId: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly status: OfferStatus;
  readonly expiresAt: Date;
  readonly message: string | null;
  readonly listingTitle: string;
  readonly listingSlug: string;
}

/**
 * Loads an offer only if the viewer is the buyer or the listing's seller.
 *
 * Returns null for "no such offer" AND for "not a party to it". A third party
 * gets the same answer as someone using a made-up id.
 */
export async function loadOfferForParty(
  offerId: string,
  viewerId: string,
): Promise<OfferWithParties | null> {
  const offer = await prisma.offer.findFirst({
    where: {
      id: offerId,
      // The party test IS the query — there is no post-hoc comparison to skip.
      OR: [{ buyerId: viewerId }, { listing: { sellerProfile: { userId: viewerId } } }],
    },
    select: {
      id: true,
      listingId: true,
      conversationId: true,
      buyerId: true,
      amountMinor: true,
      currency: true,
      status: true,
      expiresAt: true,
      message: true,
      listing: {
        select: { title: true, slug: true, sellerProfile: { select: { userId: true } } },
      },
    },
  });

  if (offer === null) return null;

  return {
    id: offer.id,
    listingId: offer.listingId,
    conversationId: offer.conversationId,
    buyerId: offer.buyerId,
    sellerId: offer.listing.sellerProfile.userId,
    amountMinor: offer.amountMinor,
    currency: offer.currency,
    status: offer.status as OfferStatus,
    expiresAt: offer.expiresAt,
    message: offer.message,
    listingTitle: offer.listing.title,
    listingSlug: offer.listing.slug,
  };
}

/**
 * Which side of the offer the viewer is on.
 *
 * Derived from database rows, never from a request field. A viewer who is
 * neither party gets null and the caller answers 404.
 */
export function resolveActor(offer: OfferWithParties, viewerId: string): OfferActor | null {
  if (offer.buyerId === viewerId) return 'buyer';
  if (offer.sellerId === viewerId) return 'seller';
  return null;
}

export type CreateOfferResult =
  | { readonly ok: true; readonly offerId: string; readonly status: OfferStatus }
  | { readonly ok: false; readonly issue: string };

export interface CreateOfferInput {
  readonly listingId: string;
  readonly buyerId: string;
  readonly amountMinor: string;
  readonly currency: string;
  readonly message?: string;
  readonly expiresInDays?: number;
  readonly asDraft?: boolean;
  readonly conversationId?: string | null;
  readonly now?: Date;
}

export async function createOffer(input: CreateOfferInput): Promise<CreateOfferResult> {
  const now = input.now ?? new Date();

  const listing = await prisma.listing.findFirst({
    where: { id: input.listingId, status: 'ACTIVE', deletedAt: null },
    select: {
      id: true,
      priceMinor: true,
      currency: true,
      sellerProfile: { select: { userId: true } },
      category: {
        select: { transactionFlow: true, minPriceMinor: true, allowsOnlinePayment: true },
      },
    },
  });

  // Only a live listing can receive an offer, and a draft or paused one must
  // be indistinguishable from one that does not exist.
  if (listing === null) return { ok: false, issue: 'listing_not_found' };

  // A seller offering on their own listing is not a transaction, it is noise.
  if (listing.sellerProfile.userId === input.buyerId) {
    return { ok: false, issue: 'own_listing' };
  }

  /*
   * Every bound is re-derived HERE from the listing and its category row. The
   * request supplies a candidate amount and nothing else — no minimum, no
   * currency authority, no ceiling.
   */
  const amount = validateOfferAmount({
    amountMinor: input.amountMinor,
    currency: input.currency,
    listingPriceMinor: listing.priceMinor,
    listingCurrency: listing.currency,
    categoryMinimumMinor: listing.category.minPriceMinor,
  });
  if (!amount.ok) return { ok: false, issue: amount.issue };

  const status: OfferStatus = input.asDraft === true ? 'DRAFT' : 'SUBMITTED';

  let created;
  try {
    created = await createOfferRows(listing.id, input, status, amount, now);
  } catch (error) {
    /*
     * `offers_one_pending_per_buyer_listing` — a buyer may hold only one open
     * offer per listing, so they cannot bury a seller under simultaneous bids.
     *
     * Caught HERE rather than left to escape: an unhandled unique violation
     * becomes a 500, which tells an honest buyer the site is broken when in
     * fact they simply already have an offer open. The rule is enforced by the
     * database; this only translates it.
     */
    if (isUniqueViolation(error, 'offers_one_pending_per_buyer_listing')) {
      return { ok: false, issue: 'offer_already_open' };
    }
    throw error;
  }

  return { ok: true, offerId: created.id, status: created.status as OfferStatus };
}

/**
 * Shape-checks a Prisma unique-constraint failure against a named constraint.
 *
 * Read structurally rather than by importing the generated error class, and by
 * NAME rather than by assuming which index a create can violate — the answer
 * stays correct when another unique index is added to `offers`.
 *
 * Prisma reports the name in two different places depending on how it reached
 * the database: `meta.target` through its own engine, and nested under
 * `meta.driverAdapterError` through a driver adapter, which is the path this
 * project uses. Both are read, because the second is undocumented enough to
 * move and the first is what most deployments would see.
 */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; meta?: Record<string, unknown> };
  if (candidate.code !== 'P2002') return false;

  const target = candidate.meta?.target;
  if (typeof target === 'string' && target === constraint) return true;
  if (Array.isArray(target) && target.includes(constraint)) return true;

  const adapter = candidate.meta?.driverAdapterError as
    | { cause?: { constraint?: { index?: unknown; fields?: unknown } } }
    | undefined;
  return adapter?.cause?.constraint?.index === constraint;
}

async function createOfferRows(
  listingId: string,
  input: CreateOfferInput,
  status: OfferStatus,
  amount: { amountMinor: bigint; currency: string },
  now: Date,
) {
  return prisma.$transaction(async (tx) => {
    const offer = await tx.offer.create({
      data: {
        listingId,
        conversationId: input.conversationId ?? null,
        buyerId: input.buyerId,
        amountMinor: amount.amountMinor,
        currency: amount.currency,
        message: input.message ?? null,
        status,
        expiresAt: offerExpiryFrom(now, input.expiresInDays),
        ...(status === 'SUBMITTED' ? { submittedAt: now } : {}),
      },
      select: { id: true, status: true },
    });

    // Creation is itself an event. `fromStatus` is null because there was no
    // previous state — that is history, not a gap.
    await tx.offerEvent.create({
      data: {
        offerId: offer.id,
        fromStatus: null,
        toStatus: status,
        actorRole: 'buyer',
        actorId: input.buyerId,
        amountMinor: amount.amountMinor,
        currency: amount.currency,
      },
    });

    return offer;
  });
}

export type TransitionResult =
  | { readonly ok: true; readonly status: OfferStatus }
  | { readonly ok: false; readonly issue: string };

/**
 * Moves an offer, recording the move.
 *
 * The status change and its audit row are written in ONE transaction. A
 * history that can disagree with the current state is worse than no history,
 * because it will be believed.
 */
export async function transitionOffer(input: {
  offer: OfferWithParties;
  actor: OfferActor;
  actorId: string | null;
  to: OfferStatus;
  note?: string;
  now?: Date;
}): Promise<TransitionResult> {
  const now = input.now ?? new Date();

  /*
   * Expiry is evaluated lazily, on read, rather than by a job that may not
   * have run. An offer that is past its window cannot be accepted merely
   * because nothing swept it yet.
   */
  if (hasExpired(input.offer.status, input.offer.expiresAt, now)) {
    await expireOffer(input.offer, now);
    return { ok: false, issue: 'expired' };
  }

  const decision = canTransitionOffer(input.offer.status, input.to, input.actor);
  if (!decision.allowed) return { ok: false, issue: decision.reason };

  const timestamps: Record<string, Date> = {};
  if (input.to === 'SUBMITTED') timestamps.submittedAt = now;
  if (input.to === 'ACCEPTED') timestamps.acceptedAt = now;
  if (input.to === 'DECLINED') timestamps.declinedAt = now;
  if (input.to === 'WITHDRAWN') timestamps.withdrawnAt = now;
  if (input.to === 'CANCELLED') timestamps.cancelledAt = now;

  await prisma.$transaction(async (tx) => {
    /*
     * The update is guarded by the status we decided against. If another
     * request moved the offer in between — a seller accepting while the buyer
     * withdraws — this matches zero rows and the transaction below fails,
     * rather than both transitions appearing to succeed.
     */
    const updated = await tx.offer.updateMany({
      where: { id: input.offer.id, status: input.offer.status },
      data: { status: input.to, ...timestamps },
    });
    if (updated.count === 0) {
      throw new OfferConflictError('The offer changed before this could be applied.');
    }

    await tx.offerEvent.create({
      data: {
        offerId: input.offer.id,
        fromStatus: input.offer.status,
        toStatus: input.to,
        actorRole: input.actor,
        actorId: input.actor === 'system' ? null : input.actorId,
        amountMinor: input.offer.amountMinor,
        currency: input.offer.currency,
        note: input.note ?? null,
      },
    });
  });

  return { ok: true, status: input.to };
}

export class OfferConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfferConflictError';
  }
}

/** Records a system expiry. Idempotent: a second call matches no rows. */
export async function expireOffer(offer: OfferWithParties, now: Date): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.offer.updateMany({
      where: { id: offer.id, status: 'SUBMITTED' },
      data: { status: 'EXPIRED' },
    });
    if (updated.count === 0) return;

    await tx.offerEvent.create({
      data: {
        offerId: offer.id,
        fromStatus: 'SUBMITTED',
        toStatus: 'EXPIRED',
        // System transitions carry no actor; the database CHECK enforces that.
        actorRole: 'system',
        actorId: null,
        amountMinor: offer.amountMinor,
        currency: offer.currency,
        // Recorded at the evaluated time rather than the wall clock, so a
        // test that fixes `now` gets a deterministic trail.
        createdAt: now,
      },
    });
  });
}

export interface OfferSummary {
  readonly id: string;
  readonly listingId: string;
  readonly listingTitle: string;
  readonly listingSlug: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly status: OfferStatus;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly counterpartName: string;
  readonly viewerRole: 'buyer' | 'seller';
}

/**
 * Offers the viewer is a party to, newest first.
 *
 * Bounded by `take`, like every other list in this codebase. `role` narrows to
 * the offers a buyer made or a seller received.
 */
export async function loadOffersForUser(
  viewerId: string,
  options: { role?: 'buyer' | 'seller'; limit?: number } = {},
): Promise<readonly OfferSummary[]> {
  const limit = Math.min(options.limit ?? 50, 100);

  const partyFilter =
    options.role === 'buyer'
      ? { buyerId: viewerId }
      : options.role === 'seller'
        ? { listing: { sellerProfile: { userId: viewerId } } }
        : { OR: [{ buyerId: viewerId }, { listing: { sellerProfile: { userId: viewerId } } }] };

  const rows = await prisma.offer.findMany({
    where: partyFilter,
    select: {
      id: true,
      listingId: true,
      amountMinor: true,
      currency: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      buyerId: true,
      buyer: { select: { profile: { select: { displayName: true } } } },
      listing: {
        select: {
          title: true,
          slug: true,
          sellerProfile: { select: { userId: true, displayName: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return rows.map((row) => {
    const viewerRole = row.buyerId === viewerId ? 'buyer' : 'seller';
    return {
      id: row.id,
      listingId: row.listingId,
      listingTitle: row.listing.title,
      listingSlug: row.listing.slug,
      amountMinor: row.amountMinor,
      currency: row.currency,
      status: row.status as OfferStatus,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      counterpartName:
        viewerRole === 'buyer'
          ? row.listing.sellerProfile.displayName
          : (row.buyer.profile?.displayName ?? ''),
      viewerRole,
    };
  });
}

export interface OfferEventRow {
  readonly id: string;
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly actorRole: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly note: string | null;
  readonly createdAt: Date;
}

/** The audit trail for one offer, oldest first — it reads as a story. */
export async function loadOfferHistory(offerId: string): Promise<readonly OfferEventRow[]> {
  const rows = await prisma.offerEvent.findMany({
    where: { offerId },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      actorRole: true,
      amountMinor: true,
      currency: true,
      note: true,
      createdAt: true,
    },
  });
  return rows;
}
