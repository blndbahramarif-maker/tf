import type { SubscriptionStatus } from './subscription-status';

/**
 * Kurdora's own billing provider, as the domain sees it.
 *
 * Provider-free by construction: no Stripe type appears here, and nothing in
 * this file knows Stripe exists. `src/infra/stripe` implements it.
 *
 * **Note what is NOT on this interface.** There is no connected account, no
 * destination, no application fee, no transfer and no payout — the vocabulary
 * of a marketplace payment is absent, so a marketplace payment cannot be
 * expressed. Kurdora charges for its own service and nothing else (ADR-0014).
 *
 * There is also no `markPaid` and no `activate`. The gateway can start a
 * checkout and read a subscription back; it cannot be asked to declare one
 * paid. That arrives through a signature-verified webhook and nowhere else.
 */

export interface CreateCheckoutInput {
  /** Kurdora's own Stripe Customer. Never a connected account. */
  readonly customerId: string;
  /** The Stripe Price this plan bills through. */
  readonly priceId: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  /** Our ids, echoed back on every event. Never trusted as authority. */
  readonly metadata: Readonly<Record<string, string>>;
  /** Deterministic. A retry must not create a second subscription. */
  readonly idempotencyKey: string;
}

export interface CheckoutSession {
  readonly id: string;
  /** Where the seller is sent. Single-use; never cache or store it. */
  readonly url: string;
}

/**
 * A subscription, reduced to the facts Kurdora records.
 *
 * `currentPeriodEnd` comes from the subscription ITEM. Verified against
 * Stripe's documentation on 2026-09-13: the period moved onto items, and the
 * root object no longer carries `current_period_end` — reading the root would
 * silently yield `undefined` and record a null expiry on a paid subscription.
 */
export interface ProviderSubscription {
  readonly subscriptionId: string;
  readonly customerId: string;
  readonly status: SubscriptionStatus;
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly canceledAt: Date | null;
  readonly latestInvoiceId: string | null;
  /** The provider's own updated-at, for out-of-order detection. */
  readonly updatedAt: Date;
  readonly livemode: boolean;
}

export interface BillingGateway {
  /** Finds or creates Kurdora's Stripe Customer for this user. */
  ensureCustomer(input: {
    email: string;
    metadata: Readonly<Record<string, string>>;
    idempotencyKey: string;
  }): Promise<string>;

  createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession>;

  /** Reads a subscription back. The only non-webhook way to learn its state. */
  retrieveSubscription(subscriptionId: string): Promise<ProviderSubscription | null>;

  /** Stops a subscription at the end of the paid period. */
  cancelAtPeriodEnd(subscriptionId: string): Promise<ProviderSubscription | null>;

  readonly isTestMode: boolean;
}
