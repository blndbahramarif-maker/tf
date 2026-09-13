import { describe, expect, it } from 'vitest';
import {
  SUBSCRIPTION_STATUSES,
  TERMINAL_SUBSCRIPTION_STATUSES,
  canTransitionSubscription,
  grantsListingAccess,
  isStaleProviderUpdate,
  listingMayBeVisible,
  subscriptionStatusFromProvider,
  type SubscriptionStatus,
} from '@/domain/billing/subscription-status';

/**
 * Kurdora's own listing subscriptions, as pure rules.
 *
 * The claims worth testing here are mostly about what a seller CANNOT do:
 * no actor but the provider moves a subscription into a paying state, a
 * cancelled subscription is never reopened, and a stale event cannot roll one
 * backwards.
 */

describe('mapping Stripe status to ours', () => {
  it('maps every documented Stripe status', () => {
    // Verified against Stripe's subscription documentation on 2026-09-13.
    const documented = {
      incomplete: 'INCOMPLETE',
      incomplete_expired: 'INCOMPLETE_EXPIRED',
      trialing: 'TRIALING',
      active: 'ACTIVE',
      past_due: 'PAST_DUE',
      unpaid: 'UNPAID',
      paused: 'PAUSED',
      canceled: 'CANCELED',
    } as const;

    for (const [provider, ours] of Object.entries(documented)) {
      expect(subscriptionStatusFromProvider(provider), provider).toBe(ours);
    }
    // And the mapping is total: no status of ours is unreachable.
    expect(new Set(Object.values(documented)).size).toBe(SUBSCRIPTION_STATUSES.length);
  });

  it('returns null for an unrecognised status rather than guessing', () => {
    /*
     * The plausible guess would be ACTIVE, and being wrong about that gives
     * the service away for free. Null forces the caller to decide.
     */
    for (const unknown of ['', 'ACTIVE', 'something_new', 'expired']) {
      expect(subscriptionStatusFromProvider(unknown), unknown).toBeNull();
    }
  });
});

describe('who gets access', () => {
  it('grants access while Stripe is still trying', () => {
    // trialing and active are Stripe's own "provision your product" states.
    // past_due is the judgement call: Stripe retries for days and most
    // recover, so a card expiring does not cost a seller their listing.
    expect(grantsListingAccess('TRIALING')).toBe(true);
    expect(grantsListingAccess('ACTIVE')).toBe(true);
    expect(grantsListingAccess('PAST_DUE')).toBe(true);
  });

  it('revokes access once Stripe has given up or the seller has', () => {
    // Stripe is explicit: "Revoke access to your product when the
    // subscription is unpaid because payments were already attempted and
    // retried while past_due."
    expect(grantsListingAccess('UNPAID')).toBe(false);
    expect(grantsListingAccess('CANCELED')).toBe(false);
    expect(grantsListingAccess('INCOMPLETE')).toBe(false);
    expect(grantsListingAccess('INCOMPLETE_EXPIRED')).toBe(false);
    expect(grantsListingAccess('PAUSED')).toBe(false);
  });

  it('never grants access on the status the PLATFORM is allowed to write', () => {
    // INCOMPLETE is the only status Kurdora itself may set. If it granted
    // access, starting a checkout would be indistinguishable from paying.
    expect(grantsListingAccess('INCOMPLETE')).toBe(false);
  });
});

describe('transitions', () => {
  it('lets no actor but the provider change anything', () => {
    for (const from of SUBSCRIPTION_STATUSES) {
      for (const to of SUBSCRIPTION_STATUSES) {
        if (from === to) continue;
        const decision = canTransitionSubscription(from, to, 'platform');
        expect(decision.allowed, `${from} -> ${to}`).toBe(false);
      }
    }
  });

  it('never reopens a terminal subscription', () => {
    expect(TERMINAL_SUBSCRIPTION_STATUSES).toEqual(['CANCELED', 'INCOMPLETE_EXPIRED']);

    for (const from of TERMINAL_SUBSCRIPTION_STATUSES) {
      for (const to of SUBSCRIPTION_STATUSES) {
        if (from === to) continue;
        const decision = canTransitionSubscription(from, to, 'provider');
        expect(decision.allowed, `${from} -> ${to}`).toBe(false);
        if (!decision.allowed) expect(decision.reason).toBe('terminal');
      }
    }
  });

  it('lets the provider move a live subscription between states', () => {
    for (const to of ['PAST_DUE', 'UNPAID', 'CANCELED', 'PAUSED'] as SubscriptionStatus[]) {
      expect(canTransitionSubscription('ACTIVE', to, 'provider').allowed, to).toBe(true);
    }
    // And recover from past_due, which is the common case.
    expect(canTransitionSubscription('PAST_DUE', 'ACTIVE', 'provider').allowed).toBe(true);
  });

  it('calls a same-status move a no-op rather than an error', () => {
    const decision = canTransitionSubscription('ACTIVE', 'ACTIVE', 'provider');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('no_op');
  });
});

describe('out-of-order events', () => {
  const applied = new Date('2026-09-13T12:00:00Z');

  it('refuses an event older than what we already applied', () => {
    // Stripe does not guarantee ordering, and the expensive direction is an
    // old "active" arriving after a cancellation.
    expect(
      isStaleProviderUpdate({
        lastAppliedAt: applied,
        eventObjectUpdatedAt: new Date('2026-09-13T11:59:59Z'),
      }),
    ).toBe(true);
  });

  it('accepts a newer one, and the first one of all', () => {
    expect(
      isStaleProviderUpdate({
        lastAppliedAt: applied,
        eventObjectUpdatedAt: new Date('2026-09-13T12:00:01Z'),
      }),
    ).toBe(false);
    expect(isStaleProviderUpdate({ lastAppliedAt: null, eventObjectUpdatedAt: applied })).toBe(
      false,
    );
  });

  it('accepts an event at exactly the applied time', () => {
    // Equal is not older. Refusing it would drop a legitimate redelivery of
    // the change we are already on, which is harmless to re-apply.
    expect(isStaleProviderUpdate({ lastAppliedAt: applied, eventObjectUpdatedAt: applied })).toBe(
      false,
    );
  });
});

describe('listing visibility', () => {
  it('is unaffected when no subscription is required', () => {
    // The default. Charging for listings is opt-in, so nothing goes dark
    // because the billing code shipped.
    for (const status of [...SUBSCRIPTION_STATUSES, null]) {
      expect(listingMayBeVisible({ subscriptionRequired: false, status }), String(status)).toBe(
        true,
      );
    }
  });

  it('requires a subscription that exists AND grants access', () => {
    expect(listingMayBeVisible({ subscriptionRequired: true, status: null })).toBe(false);
    expect(listingMayBeVisible({ subscriptionRequired: true, status: 'INCOMPLETE' })).toBe(false);
    expect(listingMayBeVisible({ subscriptionRequired: true, status: 'ACTIVE' })).toBe(true);
    expect(listingMayBeVisible({ subscriptionRequired: true, status: 'CANCELED' })).toBe(false);
  });
});
