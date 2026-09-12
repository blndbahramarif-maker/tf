import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_STATUSES,
  ONBOARDING_TRANSITIONS,
  TERMINAL_ONBOARDING_STATUSES,
  canTransitionOnboarding,
  checkSellerEligibility,
  deriveOnboardingStatus,
  type OnboardingStatus,
  type ProviderAccountState,
} from '@/domain/payments/onboarding-status';
import { CONNECT_CONTROLLER } from '@/domain/payments/connect-gateway';

/**
 * Connected-account onboarding, tested as a state machine and a decision
 * function. No database and no network: every claim here is about the rules
 * themselves, which is what makes them cheap enough to assert exhaustively.
 */

function account(overrides: Partial<ProviderAccountState> = {}): ProviderAccountState {
  return {
    accountId: 'acct_test_123',
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

describe('onboarding transitions', () => {
  it('lets the platform make exactly one move', () => {
    const platformMoves = ONBOARDING_TRANSITIONS.filter((transition) =>
      transition.actors.includes('platform'),
    );

    // The whole security model of this file in one assertion: Kurdora may
    // record that it issued a link, and may not declare anyone payable.
    expect(platformMoves).toHaveLength(1);
    expect(platformMoves[0]).toMatchObject({ from: 'NOT_STARTED', to: 'ONBOARDING_STARTED' });
  });

  it('refuses every platform attempt to make a seller payable', () => {
    for (const from of ONBOARDING_STATUSES) {
      const decision = canTransitionOnboarding(from, 'ACTIVE', 'platform');
      expect(decision.allowed).toBe(false);
    }
  });

  it('treats REJECTED as terminal for the provider too', () => {
    expect(TERMINAL_ONBOARDING_STATUSES).toEqual(['REJECTED']);

    for (const to of ONBOARDING_STATUSES) {
      if (to === 'REJECTED') continue;
      const decision = canTransitionOnboarding('REJECTED', to, 'provider');
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.reason).toBe('terminal');
    }
  });

  it('lets a seller leave ACTIVE — eligibility is not a one-way door', () => {
    // Stripe adds requirements, documents expire, capabilities are withdrawn.
    // A model that made ACTIVE terminal would keep paying a seller Stripe has
    // stopped accepting.
    for (const to of ['RESTRICTED', 'PENDING_VERIFICATION', 'REJECTED', 'DISABLED'] as const) {
      expect(canTransitionOnboarding('ACTIVE', to, 'provider').allowed).toBe(true);
    }
  });

  it('names a same-status move a no-op rather than an error', () => {
    const decision = canTransitionOnboarding('ACTIVE', 'ACTIVE', 'provider');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('no_op');
  });

  it('has no transition the status list does not contain', () => {
    const known = new Set<string>(ONBOARDING_STATUSES);
    for (const transition of ONBOARDING_TRANSITIONS) {
      expect(known.has(transition.from)).toBe(true);
      expect(known.has(transition.to)).toBe(true);
    }
  });
});

describe('deriveOnboardingStatus', () => {
  it('reads rejection BEFORE the capability booleans', () => {
    /*
     * The ordering bug this guards against is real: Stripe can report an
     * account as charges_enabled in the same payload that carries a
     * `rejected.*` reason while it winds the account down. Reading the
     * booleans first would call that account ACTIVE and keep charging for it.
     */
    const rejectedButStillEnabled = account({
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      disabledReason: 'rejected.fraud',
    });

    expect(deriveOnboardingStatus(rejectedButStillEnabled)).toBe('REJECTED');
  });

  it('is ACTIVE only when charges, payouts and requirements all agree', () => {
    expect(
      deriveOnboardingStatus(
        account({ chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true }),
      ),
    ).toBe('ACTIVE');

    // One outstanding requirement is enough to withhold it, because Stripe
    // will withdraw the capability at the deadline.
    expect(
      deriveOnboardingStatus(
        account({
          chargesEnabled: true,
          payoutsEnabled: true,
          detailsSubmitted: true,
          currentlyDue: ['individual.verification.document'],
        }),
      ),
    ).not.toBe('ACTIVE');
  });

  it('separates "wait" from "act"', () => {
    // Both are unpayable, but they are different messages to show a person.
    expect(deriveOnboardingStatus(account({ disabledReason: 'under_review' }))).toBe(
      'PENDING_VERIFICATION',
    );
    expect(deriveOnboardingStatus(account({ disabledReason: 'requirements.past_due' }))).toBe(
      'RESTRICTED',
    );
  });

  it('calls an untouched account ONBOARDING_STARTED, not RESTRICTED', () => {
    expect(deriveOnboardingStatus(account())).toBe('ONBOARDING_STARTED');
  });

  it('is PENDING_VERIFICATION when nothing is due but Stripe is still looking', () => {
    expect(
      deriveOnboardingStatus(
        account({
          detailsSubmitted: true,
          pendingVerification: ['individual.verification.document'],
        }),
      ),
    ).toBe('PENDING_VERIFICATION');
  });
});

describe('checkSellerEligibility', () => {
  const eligible = {
    stripeAccountId: 'acct_test_123',
    chargesEnabled: true,
    payoutsEnabled: true,
    currentlyDue: [] as string[],
    pastDue: [] as string[],
    disabledReason: null,
    verificationStatus: 'VERIFIED',
    categoryRequiresVerifiedSeller: false,
  };

  it('accepts a fully onboarded seller', () => {
    expect(checkSellerEligibility(eligible)).toEqual({ eligible: true });
  });

  it('refuses a seller with outstanding requirements even while charges are enabled', () => {
    // The subtle case. `charges_enabled` stays true until Stripe's deadline
    // passes, so trusting it alone takes money that then has nowhere to go.
    const result = checkSellerEligibility({
      ...eligible,
      currentlyDue: ['individual.verification.document'],
    });

    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.issues).toContain('requirements_due');
  });

  it('returns EVERY issue rather than the first', () => {
    const result = checkSellerEligibility({
      ...eligible,
      stripeAccountId: null,
      chargesEnabled: false,
      payoutsEnabled: false,
      pastDue: ['external_account'],
      disabledReason: 'requirements.past_due',
    });

    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          'no_account',
          'charges_disabled',
          'payouts_disabled',
          'past_due',
          'account_disabled',
        ]),
      );
    }
  });

  it('applies the category verification gate, which is our rule and not Stripe’s', () => {
    const result = checkSellerEligibility({
      ...eligible,
      verificationStatus: 'UNVERIFIED',
      categoryRequiresVerifiedSeller: true,
    });

    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.issues).toEqual(['not_verified_seller']);

    // …and does not apply where the category does not ask for it.
    expect(checkSellerEligibility({ ...eligible, verificationStatus: 'UNVERIFIED' }).eligible).toBe(
      true,
    );
  });
});

describe('the controller configuration', () => {
  it('is the GA-supported combination, not the preview one', () => {
    /*
     * Pinned as a test because this is the ADR-0013 DEVIATION and it must not
     * drift silently. `losses.payments = stripe` combined with the Express
     * Dashboard is public preview and needs the `2026-08-26.preview` API
     * version; this integration is pinned to GA. If someone changes this
     * constant, they must come here and say why.
     */
    expect(CONNECT_CONTROLLER).toEqual({
      dashboardType: 'express',
      feesPayer: 'application',
      lossesPayments: 'application',
      requirementCollection: 'stripe',
    });
  });

  it('never uses the full dashboard, which cannot take destination charges', () => {
    // Standard/full accounts support DIRECT charges only. Choosing it would
    // silently break the entire BUY_NOW flow.
    expect(CONNECT_CONTROLLER.dashboardType).not.toBe('full');
  });
});

describe('status coverage', () => {
  it('every status is reachable from somewhere', () => {
    const reachable = new Set<OnboardingStatus>(['NOT_STARTED']);
    for (const transition of ONBOARDING_TRANSITIONS) reachable.add(transition.to);

    for (const status of ONBOARDING_STATUSES) {
      expect(reachable.has(status)).toBe(true);
    }
  });
});
