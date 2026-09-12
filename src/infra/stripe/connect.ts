import Stripe from 'stripe';
import {
  CONNECT_CONTROLLER,
  type AccountLink,
  type ConnectGateway,
  type CreateAccountInput,
  type CreateAccountLinkInput,
} from '@/domain/payments/connect-gateway';
import type { ProviderAccountState } from '@/domain/payments/onboarding-status';
import { requireStripeConfig, type StripeConfig } from './config';
import { STRIPE_API_VERSION } from './gateway';

/**
 * Connected accounts at Stripe.
 *
 * Lives beside `gateway.ts` because both need the SDK and this directory is
 * the only place allowed to import it. Everything above speaks
 * `ConnectGateway`, so no route and no service ever holds a `Stripe.Account`.
 *
 * The single job of `toAccountState` is to reduce Stripe's large, evolving
 * Account object to the handful of facts the domain reasons about. That
 * narrowing is the point: a field we do not map cannot be accidentally
 * depended on, and a shape change at Stripe breaks one function rather than
 * twenty call sites.
 */

/** Stripe returns requirement arrays as `string[] | null`. */
function list(value: string[] | null | undefined): readonly string[] {
  return value ?? [];
}

function toAccountState(account: Stripe.Account): ProviderAccountState {
  const requirements = account.requirements;

  const capabilities: Record<string, string> = {};
  for (const [name, status] of Object.entries(account.capabilities ?? {})) {
    if (typeof status === 'string') capabilities[name] = status;
  }

  return {
    accountId: account.id,
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
    detailsSubmitted: account.details_submitted ?? false,
    currentlyDue: list(requirements?.currently_due),
    eventuallyDue: list(requirements?.eventually_due),
    pastDue: list(requirements?.past_due),
    pendingVerification: list(requirements?.pending_verification),
    disabledReason: requirements?.disabled_reason ?? null,
    currentDeadline:
      requirements?.current_deadline == null
        ? null
        : new Date(requirements.current_deadline * 1000),
    capabilities,
    country: account.country ?? null,
    payoutDelayDays: account.settings?.payouts?.schedule?.delay_days ?? null,
    // Recorded verbatim: `stripe_dashboard.type` is immutable per account, so
    // knowing what we chose at creation matters later.
    controller: (account.controller ?? {}) as Record<string, unknown>,
  };
}

/**
 * Reads a `Stripe.Account` out of an `account.updated` webhook payload.
 *
 * Exported because the webhook processor must go through the same narrowing as
 * a direct read. Two different mappings of the same object is how the two
 * quietly disagree.
 */
export function accountStateFromEventObject(object: unknown): ProviderAccountState | null {
  if (typeof object !== 'object' || object === null) return null;
  const account = object as Stripe.Account;
  if (typeof account.id !== 'string' || !account.id.startsWith('acct_')) return null;
  return toAccountState(account);
}

export class StripeConnectGateway implements ConnectGateway {
  private readonly stripe: Stripe;
  private readonly config: StripeConfig;

  constructor(config: StripeConfig) {
    this.config = config;
    this.stripe = new Stripe(config.secretKey, {
      apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
      timeout: 20_000,
      maxNetworkRetries: 2,
    });
  }

  get isTestMode(): boolean {
    return this.config.mode === 'test';
  }

  async createAccount(input: CreateAccountInput): Promise<ProviderAccountState> {
    /*
     * Controller properties rather than `type`. Stripe's guidance is to use
     * them for new integrations, and `type` is no longer required. See
     * CONNECT_CONTROLLER for the exact combination and the ADR-0013 deviation
     * it records.
     *
     * `card_payments` and `transfers` are requested explicitly: destination
     * charges need `transfers` on the destination, and requesting only what we
     * need keeps the onboarding form as short as it can be.
     */
    const account = await this.stripe.accounts.create(
      {
        country: input.country,
        email: input.email,
        controller: {
          stripe_dashboard: { type: CONNECT_CONTROLLER.dashboardType },
          fees: { payer: CONNECT_CONTROLLER.feesPayer },
          losses: { payments: CONNECT_CONTROLLER.lossesPayments },
          requirement_collection: CONNECT_CONTROLLER.requirementCollection,
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_profile: {
          ...(input.businessName === undefined ? {} : { name: input.businessName }),
          ...(input.businessUrl === undefined ? {} : { url: input.businessUrl }),
          ...(input.productDescription === undefined
            ? {}
            : { product_description: input.productDescription }),
        },
        metadata: { ...input.metadata },
      },
      // A retry after a timeout must not leave a seller with two connected
      // accounts, which is close to unrecoverable.
      { idempotencyKey: input.idempotencyKey },
    );

    return toAccountState(account);
  }

  async createAccountLink(input: CreateAccountLinkInput): Promise<AccountLink> {
    const link = await this.stripe.accountLinks.create({
      account: input.accountId,
      refresh_url: input.refreshUrl,
      return_url: input.returnUrl,
      type: 'account_onboarding',
      collection_options: { fields: input.collect },
    });

    return { url: link.url, expiresAt: new Date(link.expires_at * 1000) };
  }

  async retrieveAccount(accountId: string): Promise<ProviderAccountState | null> {
    try {
      return toAccountState(await this.stripe.accounts.retrieve(accountId));
    } catch (error) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }
}

let cached: StripeConnectGateway | null = null;

export function stripeConnectGateway(): StripeConnectGateway {
  if (cached === null) cached = new StripeConnectGateway(requireStripeConfig());
  return cached;
}

/** Test-only. Drops the cached client so a changed environment is re-read. */
export function resetStripeConnectCache(): void {
  cached = null;
}
