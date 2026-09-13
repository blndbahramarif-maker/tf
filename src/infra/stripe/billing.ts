import Stripe from 'stripe';
import type {
  BillingGateway,
  CheckoutSession,
  CreateCheckoutInput,
  ProviderSubscription,
} from '@/domain/billing/billing-gateway';
import { subscriptionStatusFromProvider } from '@/domain/billing/subscription-status';
import { requireStripeConfig, type StripeConfig } from './config';
import { STRIPE_API_VERSION } from './gateway';

/**
 * Stripe Billing, for KURDORA'S OWN subscriptions.
 *
 * Lives beside `gateway.ts` because both need the SDK and this directory is
 * the only place allowed to import it.
 *
 * **This is not Connect.** Every call here is against Kurdora's own account:
 * its own Customers, its own Prices, its own Subscriptions. No
 * `stripeAccount` header is ever set, no connected account is named, and
 * nothing is transferred to anybody. Verified against Stripe's subscription
 * documentation on 2026-09-13.
 */

/**
 * Reads the paid-period end from the subscription ITEM.
 *
 * Stripe moved `current_period_end` off the subscription root and onto its
 * items. Reading `subscription.current_period_end` — which is what every
 * older example does — yields `undefined` and would record a paid subscription
 * with no expiry. The item's value is the real one.
 */
function periodEndOf(subscription: Stripe.Subscription): Date | null {
  const item = subscription.items?.data?.[0] as { current_period_end?: number } | undefined;
  const seconds = item?.current_period_end;
  return typeof seconds === 'number' ? new Date(seconds * 1000) : null;
}

function toProviderSubscription(subscription: Stripe.Subscription): ProviderSubscription | null {
  const status = subscriptionStatusFromProvider(subscription.status);
  // An unrecognised status is NOT mapped to something plausible: the plausible
  // guess is "active", and being wrong about that gives the service away.
  if (status === null) return null;

  const customer = subscription.customer;

  return {
    subscriptionId: subscription.id,
    customerId: typeof customer === 'string' ? customer : customer.id,
    status,
    currentPeriodEnd: periodEndOf(subscription),
    cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
    canceledAt:
      subscription.canceled_at === null || subscription.canceled_at === undefined
        ? null
        : new Date(subscription.canceled_at * 1000),
    latestInvoiceId:
      typeof subscription.latest_invoice === 'string'
        ? subscription.latest_invoice
        : (subscription.latest_invoice?.id ?? null),
    /*
     * Stripe has no `updated` timestamp on a Subscription, so the best
     * available monotonic marker for "how recent is this description" is the
     * period end, falling back to creation. It moves forward on every renewal
     * and on the changes that matter. Used only to REFUSE a stale event, never
     * to accept one, so a coarse comparator fails safe.
     */
    updatedAt: periodEndOf(subscription) ?? new Date(subscription.created * 1000),
    livemode: subscription.livemode,
  };
}

/** Reads a Subscription out of a webhook payload, through the same narrowing. */
export function subscriptionFromEventObject(object: unknown): ProviderSubscription | null {
  if (typeof object !== 'object' || object === null) return null;
  const subscription = object as Stripe.Subscription;
  if (typeof subscription.id !== 'string' || !subscription.id.startsWith('sub_')) return null;
  return toProviderSubscription(subscription);
}

export class StripeBillingGateway implements BillingGateway {
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

  async ensureCustomer(input: {
    email: string;
    metadata: Readonly<Record<string, string>>;
    idempotencyKey: string;
  }): Promise<string> {
    // Idempotent: a retry after a timeout must not leave one user with two
    // Stripe Customers, which splits their billing history in half.
    const customer = await this.stripe.customers.create(
      { email: input.email, metadata: { ...input.metadata } },
      { idempotencyKey: input.idempotencyKey },
    );
    return customer.id;
  }

  async createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession> {
    /*
     * `mode: 'subscription'` — Stripe Billing through Stripe-hosted Checkout,
     * which is the current recommended mechanism for recurring payments and
     * keeps card details entirely off Kurdora.
     *
     * The PRICE is named by id from our own plan row. The amount is never sent
     * from a request and never computed here: a seller cannot choose what they
     * pay because there is no parameter through which to say.
     */
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: input.customerId,
        line_items: [{ price: input.priceId, quantity: 1 }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        metadata: { ...input.metadata },
        // Echoed onto the Subscription itself, so an event about the
        // subscription still carries our ids even if the session is long gone.
        subscription_data: { metadata: { ...input.metadata } },
      },
      { idempotencyKey: input.idempotencyKey },
    );

    if (session.url === null) {
      throw new Error('Stripe returned a Checkout Session with no URL.');
    }
    return { id: session.id, url: session.url };
  }

  async retrieveSubscription(subscriptionId: string): Promise<ProviderSubscription | null> {
    try {
      return toProviderSubscription(await this.stripe.subscriptions.retrieve(subscriptionId));
    } catch (error) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async cancelAtPeriodEnd(subscriptionId: string): Promise<ProviderSubscription | null> {
    try {
      /*
       * Cancels at the END of the paid period, never immediately. The seller
       * paid for the month; taking the listing down the moment they cancel
       * would be keeping money for a service withdrawn.
       */
      const updated = await this.stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });
      return toProviderSubscription(updated);
    } catch (error) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }
}

let cached: StripeBillingGateway | null = null;

export function stripeBillingGateway(): StripeBillingGateway {
  if (cached === null) cached = new StripeBillingGateway(requireStripeConfig());
  return cached;
}

/** Test-only. Drops the cached client so a changed environment is re-read. */
export function resetStripeBillingCache(): void {
  cached = null;
}
