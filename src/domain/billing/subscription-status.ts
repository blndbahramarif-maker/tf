/**
 * Listing subscriptions: Kurdora charging for KURDORA'S OWN service.
 *
 * This is not Stripe Connect and is not a marketplace payment. A seller pays
 * Kurdora to keep a listing active; the sale of the listed item happens
 * directly between buyer and seller, outside Kurdora (ADR-0014). There is no
 * connected account, no transfer, no application fee and no payout.
 *
 * The rule that shapes this file is the sibling of the one in the old payment
 * code, and it survives the business-model change intact:
 *
 *   **Only a signature-verified provider event may make a subscription grant
 *   access.** No route, no Server Action, no form field and no redirect can.
 *
 * Statuses mirror Stripe's own rather than inventing a parallel vocabulary,
 * because a translation layer between two status sets is somewhere for the two
 * to silently disagree. Verified against Stripe's subscription documentation
 * on 2026-09-13.
 */

export const SUBSCRIPTION_STATUSES = [
  /** No checkout has completed yet. Stripe's `incomplete`. */
  'INCOMPLETE',
  /** The first payment never arrived. Terminal. Stripe's `incomplete_expired`. */
  'INCOMPLETE_EXPIRED',
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  /** Retries exhausted; Stripe keeps the subscription but stops charging. */
  'UNPAID',
  'PAUSED',
  /** Terminal. Stripe: "a terminal state that can't be updated". */
  'CANCELED',
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * Stripe's status → ours.
 *
 * Returns null for anything unrecognised rather than guessing. An unknown
 * status must never be mapped to something plausible: the plausible guess is
 * `ACTIVE`, and being wrong about that gives away the service for free.
 */
export function subscriptionStatusFromProvider(status: string): SubscriptionStatus | null {
  switch (status) {
    case 'incomplete':
      return 'INCOMPLETE';
    case 'incomplete_expired':
      return 'INCOMPLETE_EXPIRED';
    case 'trialing':
      return 'TRIALING';
    case 'active':
      return 'ACTIVE';
    case 'past_due':
      return 'PAST_DUE';
    case 'unpaid':
      return 'UNPAID';
    case 'paused':
      return 'PAUSED';
    case 'canceled':
      return 'CANCELED';
    default:
      return null;
  }
}

/**
 * Statuses that let a paid listing stay visible.
 *
 * `TRIALING` and `ACTIVE` come straight from Stripe's guidance: trialing means
 * "you can safely provision your product", active means "in good standing".
 *
 * `PAST_DUE` is the judgement call, and it is deliberate. Stripe retries a
 * failed payment for days, and most past-due subscriptions recover. Taking a
 * seller's listing down the moment a card expires — then putting it back three
 * days later with its position and its enquiries lost — punishes an
 * administrative slip far harder than the £5 at stake. Access continues while
 * Stripe is still trying.
 *
 * Access stops at `UNPAID`, which is Stripe's explicit instruction ("Revoke
 * access to your product when the subscription is `unpaid` because payments
 * were already attempted and retried while `past_due`"), and at `CANCELED`.
 */
const ACCESS_GRANTING: readonly SubscriptionStatus[] = ['TRIALING', 'ACTIVE', 'PAST_DUE'];

export function grantsListingAccess(status: SubscriptionStatus): boolean {
  return ACCESS_GRANTING.includes(status);
}

/**
 * Terminal statuses. A later event must not walk these back.
 *
 * `CANCELED` is Stripe's own terminal state. `INCOMPLETE_EXPIRED` is terminal
 * too: Stripe voids the invoice and generates no more.
 */
export const TERMINAL_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'CANCELED',
  'INCOMPLETE_EXPIRED',
];

export type SubscriptionActor =
  /** Kurdora recording that it started a checkout. The ONLY platform move. */
  | 'platform'
  /** A signature-verified Stripe event. */
  | 'provider';

export type SubscriptionDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: 'no_op' | 'terminal' | 'provider_only' | 'unknown_transition';
    };

/**
 * Whether a status change is permitted.
 *
 * The platform may create a subscription record in `INCOMPLETE` and nothing
 * else. Every other move belongs to the provider — which is what makes a
 * forged request worthless: there is no actor value a request can supply, and
 * `platform` cannot reach any access-granting status.
 */
export function canTransitionSubscription(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
  actor: SubscriptionActor,
): SubscriptionDecision {
  if (from === to) return { allowed: false, reason: 'no_op' };
  if (TERMINAL_SUBSCRIPTION_STATUSES.includes(from)) return { allowed: false, reason: 'terminal' };
  if (actor !== 'provider') return { allowed: false, reason: 'provider_only' };

  // Every non-terminal status can reach every other: Stripe moves a
  // subscription between them freely, and a table that tried to enumerate the
  // legal pairs would be a list of guesses about another system's internals.
  // The protections that matter are the terminal check above and the
  // out-of-order check below, both of which are about OUR state, not Stripe's.
  return { allowed: true };
}

/**
 * Out-of-order protection.
 *
 * Stripe does not guarantee event ordering, so an older description of a
 * subscription can arrive after a newer one. Applying it would roll the
 * subscription backwards — and the expensive direction is the one that
 * re-grants access after a cancellation.
 *
 * The provider's own timestamp for the object is the comparator, never our
 * received-at time and never the event's `created`: two events generated in
 * the same second can arrive in either order, but the object's updated-at
 * moves monotonically with the change itself.
 */
export function isStaleProviderUpdate(input: {
  readonly lastAppliedAt: Date | null;
  readonly eventObjectUpdatedAt: Date;
}): boolean {
  if (input.lastAppliedAt === null) return false;
  return input.eventObjectUpdatedAt.getTime() < input.lastAppliedAt.getTime();
}

/**
 * What a listing's visibility should be, given its subscription.
 *
 * A single function so that the publish path, the webhook path and any future
 * sweep all reach the same answer. Deliberately takes plain values rather than
 * a database row: it is a rule, and a rule with no I/O is a rule that can be
 * tested exhaustively.
 */
export function listingMayBeVisible(input: {
  /** Whether this listing needs a paid subscription at all. */
  readonly subscriptionRequired: boolean;
  /** Null when no subscription record exists. */
  readonly status: SubscriptionStatus | null;
}): boolean {
  if (!input.subscriptionRequired) return true;
  if (input.status === null) return false;
  return grantsListingAccess(input.status);
}
