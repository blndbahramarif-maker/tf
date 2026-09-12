import type { ProviderAccountState } from './onboarding-status';

/**
 * Connected accounts, as the domain sees them.
 *
 * A separate port from `PaymentGateway` on purpose: charging a card and
 * onboarding a seller are different concerns with different failure modes, and
 * a route that takes payments has no business being handed the ability to
 * create accounts.
 *
 * Note what is NOT here. There is no `markVerified`, no `enableCharges`, no
 * `setPayoutsEnabled`. The platform cannot tell the provider a seller is
 * eligible, and it cannot tell itself either — eligibility is read back from
 * the provider and nowhere else.
 */

export interface CreateAccountInput {
  /** ISO 3166-1 alpha-2. Fixed at creation; Stripe will not change it later. */
  readonly country: string;
  readonly email: string;
  /** Shown to the seller during onboarding, and on their dashboard. */
  readonly businessName?: string;
  readonly businessUrl?: string;
  readonly productDescription?: string;
  /** Our own ids, echoed back on every account event. Never authority. */
  readonly metadata: Readonly<Record<string, string>>;
  /** Deterministic. A retry must not create a second connected account. */
  readonly idempotencyKey: string;
}

/**
 * Where the seller goes and comes back to.
 *
 * `returnUrl` is where Stripe sends them when the flow is entered and exited
 * properly — which, per Stripe, "doesn't mean that all information has been
 * collected". `refreshUrl` is where they land when the link has expired or was
 * already used, and it must mint a NEW link rather than showing an error.
 */
export interface CreateAccountLinkInput {
  readonly accountId: string;
  readonly refreshUrl: string;
  readonly returnUrl: string;
  /**
   * `eventually_due` collects everything up front — fewer trips back, and a
   * seller who refuses to provide information reveals it early.
   * `currently_due` is incremental.
   */
  readonly collect: 'currently_due' | 'eventually_due';
}

export interface AccountLink {
  readonly url: string;
  readonly expiresAt: Date;
}

export interface ConnectGateway {
  /** Creates a connected account with the platform's controller configuration. */
  createAccount(input: CreateAccountInput): Promise<ProviderAccountState>;
  /** A single-use, short-lived Stripe-hosted onboarding URL. */
  createAccountLink(input: CreateAccountLinkInput): Promise<AccountLink>;
  /** Reads an account back. The only way to learn that onboarding finished. */
  retrieveAccount(accountId: string): Promise<ProviderAccountState | null>;
  readonly isTestMode: boolean;
}

/**
 * The controller configuration Kurdora creates accounts with.
 *
 * Verified against Stripe's documentation on 2026-09-12. This exact
 * combination is the one Stripe's own hosted-onboarding page gives as its
 * example, and it is what the docs call the Express-equivalent:
 *
 *   stripe_dashboard.type  = express   — needed for DESTINATION charges;
 *                                        `full` supports direct charges only
 *   fees.payer             = application — the platform pays Stripe's fees,
 *                                        which is what keeps commission
 *                                        pricing ours
 *   losses.payments        = application — see the deviation note below
 *   requirement_collection = stripe    — Stripe collects KYC, so no identity
 *                                        document ever touches Kurdora
 *
 * **DEVIATION FROM ADR-0013 DECISION 4 — decided, not open.** That decision
 * chose `losses.payments = stripe`, following Stripe's advice that new
 * platforms let Stripe carry negative balances. Combining that with the
 * Express Dashboard is documented as PUBLIC PREVIEW and requires the
 * `2026-08-26.preview` API version, while this integration is pinned to GA
 * `2026-08-26.dahlia`.
 *
 * The owner accepted the GA combination on 2026-09-12 and it is now the
 * approved architecture: ADR-0013 Amendment 1, which SUPERSEDES Decision 4 for
 * as long as the alternative is preview-only. The consequence is accepted
 * rather than overlooked — **Kurdora absorbs a negative balance on a connected
 * account**, bounded by FEE_ONLY never routing the principal through Stripe
 * and by destination charges capping the disputable amount at the fee.
 *
 * Revisit ONLY when that combination is GA on a GA API version, and after
 * commercial and legal review. Do not switch on the strength of Decision 4's
 * wording alone.
 *
 * `stripe_dashboard.type` is IMMUTABLE per account: changing it later means
 * creating a new Account object. So this constant is not a detail.
 */
export const CONNECT_CONTROLLER = {
  dashboardType: 'express',
  feesPayer: 'application',
  lossesPayments: 'application',
  requirementCollection: 'stripe',
} as const;
