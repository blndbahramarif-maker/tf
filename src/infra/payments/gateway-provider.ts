import type { PaymentGateway } from '@/domain/payments/payment-gateway';
import type { ConnectGateway } from '@/domain/payments/connect-gateway';
import { StripeNotConfiguredError, type StripeConfigIssue } from '@/infra/stripe/config';
import { stripeGateway } from '@/infra/stripe/gateway';
import { stripeConnectGateway } from '@/infra/stripe/connect';

/**
 * Where a route gets a payment gateway.
 *
 * This exists so that **no route knows which provider is configured**. A route
 * asks for a gateway and receives the `PaymentGateway` port; swapping Stripe
 * for something else is a change to this file and `src/infra/stripe`, not to
 * every handler that takes money. Lint enforces it: `app/**` and `src/lib/**`
 * may not import `@/infra/stripe/*` at all.
 *
 * It also gives one place to answer "are payments available right now?", which
 * routes turn into a 503 rather than a 500.
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

/**
 * The configured connected-account gateway.
 *
 * Separate from `paymentGateway()` so a route that takes payments is not
 * handed the ability to create accounts, and vice versa. Same failure mode:
 * `PaymentsUnavailableError` on a 503, never a crash.
 */
export function connectGateway(): ConnectGateway {
  try {
    return stripeConnectGateway();
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
