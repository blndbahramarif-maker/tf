/**
 * Connected-account onboarding, as a state machine driven entirely by the
 * provider.
 *
 * The rule here is the sibling of the one in `order-status.ts`, and it matters
 * just as much:
 *
 *   **No actor but the provider may move a seller toward being payable.**
 *
 * A seller who edits a form field claiming to be verified changes nothing; so
 * does a route that "knows" onboarding finished because the browser came back
 * from Stripe. Stripe's own words about the return URL: *"It doesn't mean that
 * all information has been collected, or that there are no outstanding
 * requirements on the account. It only means the flow was entered and exited
 * properly."*
 *
 * The platform may do exactly one thing: record that it issued an onboarding
 * link (`NOT_STARTED → ONBOARDING_STARTED`). Everything after that is derived
 * from an `account.updated` event or a direct account read.
 */

export const ONBOARDING_STATUSES = [
  'NOT_STARTED',
  'ONBOARDING_STARTED',
  'PENDING_VERIFICATION',
  'ACTIVE',
  'RESTRICTED',
  'REJECTED',
  'DISABLED',
] as const;

export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

/** `platform` is Kurdora issuing a link. `provider` is Stripe telling us. */
export type OnboardingActor = 'platform' | 'provider';

export interface OnboardingTransition {
  readonly from: OnboardingStatus;
  readonly to: OnboardingStatus;
  readonly actors: readonly OnboardingActor[];
}

/**
 * Reachability, as data.
 *
 * Note how many edges leave `ACTIVE`. That is not defensiveness: Stripe adds
 * requirements over time, a document expires, a capability is withdrawn. An
 * account that was payable yesterday can stop being payable today with no
 * action from anyone, and a model that treated `ACTIVE` as terminal would keep
 * paying a seller Stripe has stopped accepting.
 */
export const ONBOARDING_TRANSITIONS: readonly OnboardingTransition[] = [
  // The ONLY platform-initiated move in the whole file.
  { from: 'NOT_STARTED', to: 'ONBOARDING_STARTED', actors: ['platform'] },

  ...(
    [
      ['NOT_STARTED', 'PENDING_VERIFICATION'],
      ['NOT_STARTED', 'ACTIVE'],
      ['NOT_STARTED', 'RESTRICTED'],
      ['NOT_STARTED', 'REJECTED'],
      ['NOT_STARTED', 'DISABLED'],

      ['ONBOARDING_STARTED', 'PENDING_VERIFICATION'],
      ['ONBOARDING_STARTED', 'ACTIVE'],
      ['ONBOARDING_STARTED', 'RESTRICTED'],
      ['ONBOARDING_STARTED', 'REJECTED'],
      ['ONBOARDING_STARTED', 'DISABLED'],

      ['PENDING_VERIFICATION', 'ACTIVE'],
      ['PENDING_VERIFICATION', 'RESTRICTED'],
      ['PENDING_VERIFICATION', 'REJECTED'],
      ['PENDING_VERIFICATION', 'DISABLED'],

      // Out of ACTIVE, because eligibility is not a one-way door.
      ['ACTIVE', 'RESTRICTED'],
      ['ACTIVE', 'PENDING_VERIFICATION'],
      ['ACTIVE', 'REJECTED'],
      ['ACTIVE', 'DISABLED'],

      // And back into it, once the seller resolves what was outstanding.
      ['RESTRICTED', 'ACTIVE'],
      ['RESTRICTED', 'PENDING_VERIFICATION'],
      ['RESTRICTED', 'REJECTED'],
      ['RESTRICTED', 'DISABLED'],

      // A disabled account can be restored by Stripe; a REJECTED one cannot.
      ['DISABLED', 'ACTIVE'],
      ['DISABLED', 'RESTRICTED'],
      ['DISABLED', 'PENDING_VERIFICATION'],
      ['DISABLED', 'REJECTED'],
    ] as [OnboardingStatus, OnboardingStatus][]
  ).map(([from, to]) => ({ from, to, actors: ['provider'] as const })),
];

/**
 * `REJECTED` is terminal.
 *
 * Stripe rejecting an account for fraud or terms-of-service is not something a
 * later event walks back, and modelling it as recoverable would let a
 * mis-ordered event quietly re-enable a seller Stripe has refused.
 */
export const TERMINAL_ONBOARDING_STATUSES: readonly OnboardingStatus[] = ['REJECTED'];

export type OnboardingDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: 'unknown_transition' | 'provider_only' | 'no_op' | 'terminal';
    };

export function canTransitionOnboarding(
  from: OnboardingStatus,
  to: OnboardingStatus,
  actor: OnboardingActor,
): OnboardingDecision {
  if (from === to) return { allowed: false, reason: 'no_op' };
  if (TERMINAL_ONBOARDING_STATUSES.includes(from)) return { allowed: false, reason: 'terminal' };

  const candidates = ONBOARDING_TRANSITIONS.filter(
    (transition) => transition.from === from && transition.to === to,
  );
  if (candidates.length === 0) return { allowed: false, reason: 'unknown_transition' };

  if (!candidates.some((transition) => transition.actors.includes(actor))) {
    return { allowed: false, reason: 'provider_only' };
  }
  return { allowed: true };
}

/**
 * The provider's account state, in our terms.
 *
 * Deliberately framework-free and Stripe-free — `src/infra/stripe` maps a
 * `Stripe.Account` onto this, and everything above reads only this.
 */
export interface ProviderAccountState {
  readonly accountId: string;
  readonly chargesEnabled: boolean;
  readonly payoutsEnabled: boolean;
  readonly detailsSubmitted: boolean;
  readonly currentlyDue: readonly string[];
  readonly eventuallyDue: readonly string[];
  readonly pastDue: readonly string[];
  readonly pendingVerification: readonly string[];
  /** `requirements.disabled_reason`, or null when nothing is disabled. */
  readonly disabledReason: string | null;
  readonly currentDeadline: Date | null;
  readonly capabilities: Readonly<Record<string, string>>;
  readonly country: string | null;
  readonly payoutDelayDays: number | null;
  readonly controller: Readonly<Record<string, unknown>>;
}

/**
 * Derives the onboarding status from an account, in one place.
 *
 * The ORDER of these checks is the design. Rejection outranks everything —
 * an account can be `charges_enabled` in the same payload that carries a
 * `rejected.*` reason during the window Stripe is winding it down, and reading
 * the booleans first would call that account ACTIVE.
 */
export function deriveOnboardingStatus(account: ProviderAccountState): OnboardingStatus {
  if (account.disabledReason !== null) {
    if (account.disabledReason.startsWith('rejected.')) return 'REJECTED';
    /*
     * `requirements.pending_verification` and `under_review` mean Stripe is
     * still looking; everything else disabled means the seller has something
     * to do. Both are RESTRICTED for our purposes — neither can be paid — but
     * `PENDING_VERIFICATION` tells the seller "wait" rather than "act", which
     * is a materially different message to show someone.
     */
    if (
      account.disabledReason === 'requirements.pending_verification' ||
      account.disabledReason === 'under_review'
    ) {
      return 'PENDING_VERIFICATION';
    }
    return 'RESTRICTED';
  }

  if (account.chargesEnabled && account.payoutsEnabled && account.currentlyDue.length === 0) {
    return 'ACTIVE';
  }

  // Nothing outstanding to do, but Stripe has not enabled them yet.
  if (
    account.detailsSubmitted &&
    account.currentlyDue.length === 0 &&
    account.pendingVerification.length > 0
  ) {
    return 'PENDING_VERIFICATION';
  }

  if (account.detailsSubmitted) return 'RESTRICTED';
  return 'ONBOARDING_STARTED';
}

// ── Eligibility ─────────────────────────────────────────────────────────────

export type EligibilityIssue =
  | 'no_account'
  | 'charges_disabled'
  | 'payouts_disabled'
  | 'requirements_due'
  | 'past_due'
  | 'account_disabled'
  | 'not_verified_seller';

export interface SellerEligibilityInput {
  readonly stripeAccountId: string | null;
  readonly chargesEnabled: boolean;
  readonly payoutsEnabled: boolean;
  readonly currentlyDue: readonly string[];
  readonly pastDue: readonly string[];
  readonly disabledReason: string | null;
  /** Our own verification, from the category's `requiresVerifiedSeller`. */
  readonly verificationStatus: string;
  readonly categoryRequiresVerifiedSeller: boolean;
}

export type EligibilityResult =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly issues: readonly EligibilityIssue[] };

/**
 * Whether a seller may receive a marketplace charge.
 *
 * Every input is read from the DATABASE by the caller, and every one of those
 * database fields is itself mirrored from a verified provider event. There is
 * no path by which a request influences this answer.
 *
 * ALL failing issues are returned rather than the first, because a seller
 * fixing one thing at a time and being told about the next only afterwards is
 * a miserable experience — and because an operator triaging "why can nobody
 * buy from this seller" wants the whole list.
 *
 * FEE_ONLY never calls this: it has no transfer leg and needs no connected
 * account at all, which is exactly why a high-value seller can transact on
 * day one.
 */
export function checkSellerEligibility(input: SellerEligibilityInput): EligibilityResult {
  const issues: EligibilityIssue[] = [];

  if (input.stripeAccountId === null) issues.push('no_account');
  if (!input.chargesEnabled) issues.push('charges_disabled');
  if (!input.payoutsEnabled) issues.push('payouts_disabled');

  // Something Stripe is waiting for. A charge now would land on an account
  // that may lose its capabilities at the deadline.
  if (input.currentlyDue.length > 0) issues.push('requirements_due');
  if (input.pastDue.length > 0) issues.push('past_due');
  if (input.disabledReason !== null) issues.push('account_disabled');

  // Kurdora's own gate, not Stripe's: category data decides which categories
  // need a verified seller, and it is editable by an admin without a deploy.
  if (input.categoryRequiresVerifiedSeller && input.verificationStatus !== 'VERIFIED') {
    issues.push('not_verified_seller');
  }

  return issues.length === 0 ? { eligible: true } : { eligible: false, issues };
}
