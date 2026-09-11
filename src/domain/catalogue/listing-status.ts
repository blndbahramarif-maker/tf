/**
 * Listing lifecycle.
 *
 * The transition table is DATA, checked by a pure function. No route branches
 * on a category name or hand-rolls a status check — a listing can only move
 * between states the table permits, and only for an actor the table allows.
 *
 * See docs/06-transaction-flows.md.
 */

export type ListingStatus =
  'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'PAUSED' | 'SOLD' | 'EXPIRED' | 'REJECTED' | 'REMOVED';

/** Who is attempting the transition. */
export type ListingActor = 'owner' | 'moderator' | 'system';

export interface ListingTransition {
  readonly from: ListingStatus;
  readonly to: ListingStatus;
  /** Actors permitted to make this move. */
  readonly actors: readonly ListingActor[];
  readonly description: string;
}

/**
 * Every permitted move. Anything absent is forbidden.
 *
 * Note what the owner CANNOT do: they cannot approve their own listing out of
 * PENDING_REVIEW, and they cannot bring back a listing a moderator REMOVED.
 * Those are the two places where self-service would defeat moderation.
 */
export const LISTING_TRANSITIONS: readonly ListingTransition[] = [
  {
    from: 'DRAFT',
    to: 'PENDING_REVIEW',
    actors: ['owner'],
    description: 'Submit for review (category requires approval)',
  },
  {
    from: 'DRAFT',
    to: 'ACTIVE',
    actors: ['owner'],
    description: 'Publish directly (no approval required)',
  },
  { from: 'DRAFT', to: 'REMOVED', actors: ['owner', 'moderator'], description: 'Discard a draft' },

  { from: 'PENDING_REVIEW', to: 'ACTIVE', actors: ['moderator'], description: 'Approve' },
  {
    from: 'PENDING_REVIEW',
    to: 'REJECTED',
    actors: ['moderator'],
    description: 'Reject with a reason',
  },
  {
    from: 'PENDING_REVIEW',
    to: 'DRAFT',
    actors: ['owner'],
    description: 'Withdraw from review to edit',
  },

  { from: 'REJECTED', to: 'DRAFT', actors: ['owner'], description: 'Edit and resubmit' },
  {
    from: 'REJECTED',
    to: 'REMOVED',
    actors: ['owner', 'moderator'],
    description: 'Give up on a rejected listing',
  },

  { from: 'ACTIVE', to: 'PAUSED', actors: ['owner'], description: 'Temporarily hide' },
  { from: 'ACTIVE', to: 'SOLD', actors: ['owner', 'system'], description: 'Mark sold' },
  { from: 'ACTIVE', to: 'EXPIRED', actors: ['system'], description: 'Listing duration elapsed' },
  { from: 'ACTIVE', to: 'REMOVED', actors: ['moderator'], description: 'Removed by moderation' },
  { from: 'ACTIVE', to: 'DRAFT', actors: ['owner'], description: 'Unpublish back to draft' },

  { from: 'PAUSED', to: 'ACTIVE', actors: ['owner'], description: 'Resume' },
  { from: 'PAUSED', to: 'DRAFT', actors: ['owner'], description: 'Unpublish back to draft' },
  {
    from: 'PAUSED',
    to: 'EXPIRED',
    actors: ['system'],
    description: 'Listing duration elapsed while paused',
  },
  { from: 'PAUSED', to: 'REMOVED', actors: ['owner', 'moderator'], description: 'Remove' },

  { from: 'EXPIRED', to: 'DRAFT', actors: ['owner'], description: 'Renew by editing' },
  { from: 'EXPIRED', to: 'ACTIVE', actors: ['owner'], description: 'Renew directly' },
  { from: 'EXPIRED', to: 'REMOVED', actors: ['owner', 'moderator'], description: 'Remove' },

  {
    from: 'SOLD',
    to: 'REMOVED',
    actors: ['owner', 'moderator'],
    description: 'Remove a sold listing',
  },
];

/** Statuses visible to the public. */
export const PUBLICLY_VISIBLE: readonly ListingStatus[] = ['ACTIVE'];

/** Statuses the owner may still edit. */
export const EDITABLE_STATUSES: readonly ListingStatus[] = [
  'DRAFT',
  'REJECTED',
  'PAUSED',
  'EXPIRED',
];

export type TransitionRejection = 'not_permitted' | 'actor_not_allowed' | 'same_status';

export type TransitionDecision =
  | { readonly allowed: true; readonly transition: ListingTransition }
  | { readonly allowed: false; readonly reason: TransitionRejection };

export function canTransition(
  from: ListingStatus,
  to: ListingStatus,
  actor: ListingActor,
): TransitionDecision {
  if (from === to) return { allowed: false, reason: 'same_status' };

  const candidates = LISTING_TRANSITIONS.filter((t) => t.from === from && t.to === to);
  if (candidates.length === 0) return { allowed: false, reason: 'not_permitted' };

  const permitted = candidates.find((t) => t.actors.includes(actor));
  if (!permitted) return { allowed: false, reason: 'actor_not_allowed' };

  return { allowed: true, transition: permitted };
}

export function isEditable(status: ListingStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

export function isPubliclyVisible(status: ListingStatus): boolean {
  return PUBLICLY_VISIBLE.includes(status);
}

/** Transitions available to an actor from a given status, for building a UI. */
export function availableTransitions(
  from: ListingStatus,
  actor: ListingActor,
): readonly ListingTransition[] {
  return LISTING_TRANSITIONS.filter((t) => t.from === from && t.actors.includes(actor));
}

/**
 * Where publishing sends a listing.
 *
 * Approval is a per-category FLAG, never a check against a category name, so
 * requiring review for a new category is an admin toggle.
 */
export function publishTarget(requiresApproval: boolean): ListingStatus {
  return requiresApproval ? 'PENDING_REVIEW' : 'ACTIVE';
}
