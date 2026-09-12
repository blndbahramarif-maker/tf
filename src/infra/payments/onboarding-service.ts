import { prisma } from '@/infra/db/client';
import type { ConnectGateway } from '@/domain/payments/connect-gateway';
import {
  canTransitionOnboarding,
  checkSellerEligibility,
  deriveOnboardingStatus,
  type EligibilityResult,
  type OnboardingStatus,
  type ProviderAccountState,
} from '@/domain/payments/onboarding-status';

/**
 * Connected-account onboarding.
 *
 * Two rules shape everything here, and they are the same two rules as the rest
 * of the payment code wearing different clothes:
 *
 *   **The seller names nothing.** The country, the email and the business name
 *   come from the seller's own profile row, scoped by the session's user id.
 *   No request carries a `stripeAccountId`, a capability, or an eligibility
 *   claim — and there is no parameter to carry one in.
 *
 *   **Onboarding state comes from the provider.** The platform records that it
 *   issued a link. Everything after that is derived from an account read or an
 *   `account.updated` event. Stripe's return URL "only means the flow was
 *   entered and exited properly", so it is treated as a cue to re-read the
 *   account and never as evidence of anything.
 */

export type OnboardingIssue =
  'no_seller_profile' | 'already_rejected' | 'account_missing_at_provider';

export type StartOnboardingResult =
  | {
      readonly ok: true;
      readonly accountId: string;
      readonly url: string;
      readonly expiresAt: Date;
      /** True when this call created the connected account. */
      readonly created: boolean;
    }
  | { readonly ok: false; readonly issue: OnboardingIssue };

/** Deterministic. A retry must never leave a seller with two accounts. */
export function accountIdempotencyKey(sellerProfileId: string): string {
  return `seller:${sellerProfileId}:acct:v1`;
}

interface SellerRow {
  id: string;
  userId: string;
  displayName: string;
  stripeAccountId: string | null;
  onboardingStatus: OnboardingStatus;
  country: { code: string };
  user: { email: string };
}

/** Loads the seller profile belonging to this user, and nobody else's. */
async function loadOwnSellerProfile(userId: string): Promise<SellerRow | null> {
  return prisma.sellerProfile.findFirst({
    // The ownership test IS the query. There is no id from the request.
    where: { userId, deletedAt: null },
    select: {
      id: true,
      userId: true,
      displayName: true,
      stripeAccountId: true,
      onboardingStatus: true,
      country: { select: { code: true } },
      user: { select: { email: true } },
    },
  }) as Promise<SellerRow | null>;
}

/**
 * Creates the connected account if there is not one, then mints a fresh
 * hosted-onboarding link.
 *
 * Always mints a NEW link, including for an existing account. Stripe's links
 * are single-use and short-lived — *"You can only use each temporary Account
 * Link URL once, because it grants access to the account holder's personal
 * information"* — so caching one would hand the next caller a dead URL, and
 * storing one would be storing a credential.
 */
export async function startOnboarding(input: {
  userId: string;
  gateway: ConnectGateway;
  returnUrl: string;
  refreshUrl: string;
  now?: Date;
}): Promise<StartOnboardingResult> {
  const now = input.now ?? new Date();
  const seller = await loadOwnSellerProfile(input.userId);
  if (seller === null) return { ok: false, issue: 'no_seller_profile' };

  /*
   * REJECTED is terminal. Sending a rejected seller back through onboarding
   * would produce a link that cannot help them and an expectation we cannot
   * meet; Stripe's decision is not ours to retry around.
   */
  if (seller.onboardingStatus === 'REJECTED') return { ok: false, issue: 'already_rejected' };

  let accountId = seller.stripeAccountId;
  let created = false;

  if (accountId === null) {
    const account = await input.gateway.createAccount({
      // From the seller's own profile row, never from a request.
      country: seller.country.code,
      email: seller.user.email,
      businessName: seller.displayName,
      metadata: {
        kurdora_seller_profile_id: seller.id,
        kurdora_user_id: seller.userId,
      },
      idempotencyKey: accountIdempotencyKey(seller.id),
    });

    accountId = account.accountId;
    created = true;

    // Persisted before the link is minted: a crash between the two must leave
    // a recorded account rather than an orphan at Stripe that we then create
    // a second time.
    await applyAccountState(seller.id, account, now);
  }

  const link = await input.gateway.createAccountLink({
    accountId,
    returnUrl: input.returnUrl,
    refreshUrl: input.refreshUrl,
    /*
     * Up-front collection. It means one trip through the form rather than
     * several, avoids payout failures at a deadline nobody was watching, and
     * surfaces a seller who will not provide information before they have
     * listings depending on it.
     */
    collect: 'eventually_due',
  });

  // The ONE platform-initiated transition in the whole state machine.
  await markOnboardingStarted(seller.id, now);

  return { ok: true, accountId, url: link.url, expiresAt: link.expiresAt, created };
}

/** `NOT_STARTED → ONBOARDING_STARTED`, guarded, and a no-op from anywhere else. */
async function markOnboardingStarted(sellerProfileId: string, now: Date): Promise<void> {
  await prisma.sellerProfile.updateMany({
    where: { id: sellerProfileId, onboardingStatus: 'NOT_STARTED' },
    data: { onboardingStatus: 'ONBOARDING_STARTED', onboardingStartedAt: now },
  });
}

/**
 * Writes a provider account state onto a seller profile.
 *
 * **The only function that may change a seller's payability.** It takes a
 * `ProviderAccountState`, which can only be produced by the Stripe adapter
 * from a real account object or a verified webhook payload — so there is no
 * way to call this with values a client supplied.
 *
 * Returns the status it settled on, so a caller can audit it.
 */
export async function applyAccountState(
  sellerProfileId: string,
  account: ProviderAccountState,
  now: Date,
): Promise<OnboardingStatus> {
  const next = deriveOnboardingStatus(account);

  const current = await prisma.sellerProfile.findUnique({
    where: { id: sellerProfileId },
    select: { onboardingStatus: true, onboardingCompletedAt: true },
  });
  if (current === null) return next;

  const from = current.onboardingStatus as OnboardingStatus;
  const decision = canTransitionOnboarding(from, next, 'provider');

  /*
   * A move the table refuses — `REJECTED → ACTIVE` above all — is NOT applied.
   * That is the out-of-order protection: a stale `account.updated` describing
   * a healthy account, delivered after a rejection, would otherwise re-enable
   * a seller Stripe has refused.
   *
   * The mirrored FACTS are still written, because they are the newest
   * description we have and a reviewer needs to see them. Only the derived
   * STATUS is held back.
   */
  const statusChange = decision.allowed || from === next ? { onboardingStatus: next } : {};

  const completedAt =
    next === 'ACTIVE' && current.onboardingCompletedAt === null
      ? { onboardingCompletedAt: now }
      : {};

  await prisma.sellerProfile.update({
    where: { id: sellerProfileId },
    data: {
      ...statusChange,
      ...completedAt,
      stripeAccountId: account.accountId,
      chargesEnabled: account.chargesEnabled,
      payoutsEnabled: account.payoutsEnabled,
      detailsSubmitted: account.detailsSubmitted,
      stripeDisabledReason: account.disabledReason,
      stripeCapabilities: account.capabilities as never,
      stripeAccountCountry: account.country,
      stripeController: account.controller as never,
      stripePayoutDelayDays: account.payoutDelayDays,
      stripeAccountSyncedAt: now,
      // The summary only — never a document, never an identity field.
      requirementsDue: {
        currently_due: account.currentlyDue,
        eventually_due: account.eventuallyDue,
        past_due: account.pastDue,
        pending_verification: account.pendingVerification,
        current_deadline: account.currentDeadline?.toISOString() ?? null,
      } as never,
    },
  });

  return decision.allowed || from === next ? next : from;
}

/**
 * Re-reads the account from the provider and applies it.
 *
 * This is what the return URL triggers. The redirect itself proves nothing, so
 * the answer comes from a fresh read.
 */
export async function refreshAccountState(input: {
  userId: string;
  gateway: ConnectGateway;
  now?: Date;
}): Promise<{ ok: true; status: OnboardingStatus } | { ok: false; issue: OnboardingIssue }> {
  const seller = await loadOwnSellerProfile(input.userId);
  if (seller === null) return { ok: false, issue: 'no_seller_profile' };
  if (seller.stripeAccountId === null) return { ok: false, issue: 'account_missing_at_provider' };

  const account = await input.gateway.retrieveAccount(seller.stripeAccountId);
  if (account === null) return { ok: false, issue: 'account_missing_at_provider' };

  return { ok: true, status: await applyAccountState(seller.id, account, input.now ?? new Date()) };
}

export interface OnboardingSnapshot {
  readonly sellerProfileId: string;
  readonly status: OnboardingStatus;
  readonly hasAccount: boolean;
  readonly chargesEnabled: boolean;
  readonly payoutsEnabled: boolean;
  readonly detailsSubmitted: boolean;
  readonly disabledReason: string | null;
  readonly currentlyDue: readonly string[];
  readonly pastDue: readonly string[];
  readonly payoutDelayDays: number | null;
  readonly syncedAt: Date | null;
}

/**
 * What to show a seller about their own onboarding.
 *
 * Deliberately returns no account id. A seller has no use for `acct_…`, and
 * not rendering it keeps it out of page source, browser history and support
 * screenshots.
 */
export async function loadOnboardingSnapshot(userId: string): Promise<OnboardingSnapshot | null> {
  const seller = await prisma.sellerProfile.findFirst({
    where: { userId, deletedAt: null },
    select: {
      id: true,
      onboardingStatus: true,
      stripeAccountId: true,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      stripeDisabledReason: true,
      requirementsDue: true,
      stripePayoutDelayDays: true,
      stripeAccountSyncedAt: true,
    },
  });
  if (seller === null) return null;

  const requirements = readRequirements(seller.requirementsDue);

  return {
    sellerProfileId: seller.id,
    status: seller.onboardingStatus as OnboardingStatus,
    hasAccount: seller.stripeAccountId !== null,
    chargesEnabled: seller.chargesEnabled,
    payoutsEnabled: seller.payoutsEnabled,
    detailsSubmitted: seller.detailsSubmitted,
    disabledReason: seller.stripeDisabledReason,
    currentlyDue: requirements.currentlyDue,
    pastDue: requirements.pastDue,
    payoutDelayDays: seller.stripePayoutDelayDays,
    syncedAt: seller.stripeAccountSyncedAt,
  };
}

/**
 * Reads the stored requirements summary defensively.
 *
 * It is JSON written from a provider payload, so it is parsed rather than
 * cast: a shape change at Stripe must produce an empty list, not an
 * `undefined` propagating into an eligibility decision.
 */
export function readRequirements(value: unknown): {
  currentlyDue: string[];
  pastDue: string[];
} {
  if (typeof value !== 'object' || value === null) return { currentlyDue: [], pastDue: [] };
  const record = value as Record<string, unknown>;
  const strings = (key: string): string[] => {
    const list = record[key];
    return Array.isArray(list)
      ? list.filter((item): item is string => typeof item === 'string')
      : [];
  };
  return { currentlyDue: strings('currently_due'), pastDue: strings('past_due') };
}

/**
 * Whether a seller may receive a marketplace charge, read from the database.
 *
 * Every input is a mirrored provider fact or our own category configuration.
 * Nothing here can be influenced by a request.
 */
export async function loadSellerEligibility(input: {
  sellerProfileId: string;
  categoryRequiresVerifiedSeller: boolean;
}): Promise<EligibilityResult> {
  const seller = await prisma.sellerProfile.findUnique({
    where: { id: input.sellerProfileId },
    select: {
      stripeAccountId: true,
      chargesEnabled: true,
      payoutsEnabled: true,
      stripeDisabledReason: true,
      requirementsDue: true,
      verificationStatus: true,
    },
  });
  if (seller === null) return { eligible: false, issues: ['no_account'] };

  const requirements = readRequirements(seller.requirementsDue);

  return checkSellerEligibility({
    stripeAccountId: seller.stripeAccountId,
    chargesEnabled: seller.chargesEnabled,
    payoutsEnabled: seller.payoutsEnabled,
    currentlyDue: requirements.currentlyDue,
    pastDue: requirements.pastDue,
    disabledReason: seller.stripeDisabledReason,
    verificationStatus: seller.verificationStatus,
    categoryRequiresVerifiedSeller: input.categoryRequiresVerifiedSeller,
  });
}

/** Finds the seller a provider account belongs to. Used by the webhook. */
export async function findSellerByAccountId(accountId: string): Promise<string | null> {
  const seller = await prisma.sellerProfile.findUnique({
    where: { stripeAccountId: accountId },
    select: { id: true },
  });
  return seller?.id ?? null;
}
