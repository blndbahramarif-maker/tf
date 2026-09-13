import type { PaymentGateway } from '@/domain/payments/payment-gateway';
import type { BillingGateway } from '@/domain/billing/billing-gateway';
import { StripeNotConfiguredError, type StripeConfigIssue } from '@/infra/stripe/config';
import { stripeGateway } from '@/infra/stripe/gateway';
import { stripeBillingGateway } from '@/infra/stripe/billing';

/**
 * Where a route would get a payment gateway.
 *
 * ### RETAINED, AND CURRENTLY UNUSED BY ANY ROUTE.
 *
 * Kurdora is a CONTACT-ONLY marketplace: a buyer and a seller arrange payment
 * between themselves, outside the platform. Kurdora never collects a sale
 * price, never holds buyer money and never pays a seller out, so nothing in
 * the product calls this today.
 *
 * It is kept rather than deleted because charging for **Kurdora's own
 * services** — a paid listing, a promoted listing, advertising — is a
 * different thing from processing somebody else's sale, and if that is built
 * it is an ordinary charge on Kurdora's own account. The provider boundary is
 * the part worth keeping: it is what stops the SDK leaking into routes.
 *
 * What is deliberately GONE: the connected-account gateway, destination
 * charges, application fees, payouts and the webhook that moved payment state.
 * Those existed only to process a seller's sale.
 *
 * Live mode remains refused (`LIVE_MODE_PERMITTED = false`).
 */

export type PaymentsUnavailableReason = StripeConfigIssue;

export class PaymentsUnavailableError extends Error {
  readonly reason: PaymentsUnavailableReason;

  constructor(reason: PaymentsUnavailableReason) {
    super(`Payments are unavailable: ${reason}`);
    this.name = 'PaymentsUnavailableError';
    this.reason = reason;
  }
}

/**
 * The configured gateway.
 *
 * Throws `PaymentsUnavailableError` when payments are switched off, when the
 * configuration is half-present, or when a LIVE key is refused because Stripe
 * has not approved the business model. Callers answer 503 — all three are
 * known operational states, not crashes.
 */
export function paymentGateway(): PaymentGateway {
  try {
    return stripeGateway();
  } catch (error) {
    if (error instanceof StripeNotConfiguredError) {
      throw new PaymentsUnavailableError(error.reason);
    }
    throw error;
  }
}

/** True when a charge could be created right now. */
export function paymentsAvailable(): boolean {
  try {
    paymentGateway();
    return true;
  } catch (error) {
    if (error instanceof PaymentsUnavailableError) return false;
    throw error;
  }
}

/**
 * The configured billing gateway, for KURDORA'S OWN subscriptions.
 *
 * Separate from `paymentGateway()` so the two capabilities cannot be confused:
 * this one can create a Checkout Session for a Kurdora service, and it has no
 * way to express a connected account, a transfer or an application fee.
 *
 * Same failure mode as the others: `PaymentsUnavailableError` becomes a 503,
 * never a crash. A live key is still refused.
 */
export function billingGateway(): BillingGateway {
  try {
    return stripeBillingGateway();
  } catch (error) {
    if (error instanceof StripeNotConfiguredError) {
      throw new PaymentsUnavailableError(error.reason);
    }
    throw error;
  }
}
