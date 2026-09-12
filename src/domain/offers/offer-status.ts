/**
 * Offer lifecycle.
 *
 * The transition table is DATA, exactly as the listing lifecycle is: which
 * moves are legal, and who may make them, is a row rather than a branch. A new
 * transition adds an entry, not an `if`.
 *
 * Design notes, because the shape was chosen rather than inherited:
 *
 *   DRAFT is real but optional. A buyer composing an offer in a form does not
 *   need a database row, so the UI creates offers directly in SUBMITTED. DRAFT
 *   exists for the high-value categories, where an offer is prepared over time
 *   and may need to survive a closed tab. Making every composition a draft row
 *   would fill the table with abandoned junk.
 *
 *   SUBMITTED replaces the Phase 2 name PENDING. "Pending" describes a feeling;
 *   "submitted" describes an event that happened, which is what a state machine
 *   should record.
 *
 *   CANCELLED is distinct from WITHDRAWN. Withdrawn is the buyer pulling an
 *   offer the seller has not answered. Cancelled is an ACCEPTED offer being
 *   called off before it completes — a different thing, with different
 *   consequences once Phase 7 attaches money to acceptance.
 *
 *   COUNTERED and CONVERTED exist in the enum and have NO transitions here.
 *   Counter-offers are not implemented in Phase 6; CONVERTED belongs to the
 *   phase that turns an accepted offer into an order. Unreachable states are
 *   honest about what is not built; inventing transitions for them would not be.
 *
 * ACCEPTED is deliberately not terminal. Phase 7 will lock it once a fee has
 * been paid; until money exists, an accepted offer that falls through has to be
 * expressible or the data will lie.
 */

export const OFFER_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'ACCEPTED',
  'DECLINED',
  'COUNTERED',
  'WITHDRAWN',
  'EXPIRED',
  'CANCELLED',
  'CONVERTED',
] as const;

export type OfferStatus = (typeof OFFER_STATUSES)[number];

/**
 * Who is acting.
 *
 * `buyer` and `seller` are resolved from the database — the buyer is the
 * offer's `buyerId`, the seller is the listing's owner. Neither is ever taken
 * from the request.
 */
export type OfferActor = 'buyer' | 'seller' | 'system';

export interface OfferTransition {
  readonly from: OfferStatus;
  readonly to: OfferStatus;
  readonly actors: readonly OfferActor[];
  readonly description: string;
}

export const OFFER_TRANSITIONS: readonly OfferTransition[] = [
  { from: 'DRAFT', to: 'SUBMITTED', actors: ['buyer'], description: 'Send the offer' },
  { from: 'DRAFT', to: 'CANCELLED', actors: ['buyer'], description: 'Discard a draft' },

  { from: 'SUBMITTED', to: 'ACCEPTED', actors: ['seller'], description: 'Accept' },
  { from: 'SUBMITTED', to: 'DECLINED', actors: ['seller'], description: 'Decline' },
  {
    from: 'SUBMITTED',
    to: 'WITHDRAWN',
    actors: ['buyer'],
    description: 'Withdraw before an answer',
  },
  { from: 'SUBMITTED', to: 'EXPIRED', actors: ['system'], description: 'Offer window elapsed' },

  /*
   * Either party may call off an accepted offer while no money has changed
   * hands. Phase 7 will gate this on payment state; it must not be gated on
   * nothing in the meantime, or a deal that collapses has no way to be recorded.
   */
  {
    from: 'ACCEPTED',
    to: 'CANCELLED',
    actors: ['buyer', 'seller'],
    description: 'Call off an accepted offer',
  },
];

export const TERMINAL_STATUSES: readonly OfferStatus[] = [
  'DECLINED',
  'WITHDRAWN',
  'EXPIRED',
  'CANCELLED',
  'CONVERTED',
];

/** Statuses in which the offer is still awaiting the seller. */
export const OPEN_STATUSES: readonly OfferStatus[] = ['DRAFT', 'SUBMITTED'];

export function isTerminal(status: OfferStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export type OfferDecision =
  | { readonly allowed: true; readonly transition: OfferTransition }
  | { readonly allowed: false; readonly reason: 'unknown_transition' | 'wrong_actor' | 'no_op' };

export function canTransitionOffer(
  from: OfferStatus,
  to: OfferStatus,
  actor: OfferActor,
): OfferDecision {
  if (from === to) return { allowed: false, reason: 'no_op' };

  const candidates = OFFER_TRANSITIONS.filter(
    (transition) => transition.from === from && transition.to === to,
  );
  if (candidates.length === 0) return { allowed: false, reason: 'unknown_transition' };

  const permitted = candidates.find((transition) => transition.actors.includes(actor));
  // The transition exists but this actor may not make it. Distinguished from
  // "no such transition" so the caller can tell a seller trying to withdraw a
  // buyer's offer from a genuinely impossible move.
  if (!permitted) return { allowed: false, reason: 'wrong_actor' };

  return { allowed: true, transition: permitted };
}

/** Transitions available to one actor right now, for rendering controls. */
export function availableTransitions(
  from: OfferStatus,
  actor: OfferActor,
): readonly OfferTransition[] {
  return OFFER_TRANSITIONS.filter(
    (transition) => transition.from === from && transition.actors.includes(actor),
  );
}

/**
 * Default offer validity.
 *
 * Long enough that a seller in another timezone can answer, short enough that
 * a buyer is not bound indefinitely.
 */
export const DEFAULT_OFFER_TTL_DAYS = 7;
export const MAX_OFFER_TTL_DAYS = 30;

export function offerExpiryFrom(now: Date, days: number = DEFAULT_OFFER_TTL_DAYS): Date {
  const bounded = Math.min(Math.max(Math.trunc(days), 1), MAX_OFFER_TTL_DAYS);
  return new Date(now.getTime() + bounded * 24 * 60 * 60 * 1000);
}

/** True when a SUBMITTED offer has passed its expiry. */
export function hasExpired(status: OfferStatus, expiresAt: Date, now: Date): boolean {
  return status === 'SUBMITTED' && expiresAt.getTime() <= now.getTime();
}
