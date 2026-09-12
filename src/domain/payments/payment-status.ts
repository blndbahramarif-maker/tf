/**
 * Payment and payment-attempt lifecycles.
 *
 * A `Payment` mirrors one provider PaymentIntent. A `PaymentAttempt` mirrors
 * one charge under it — a card declined and retried produces two attempts and
 * one payment, which is why the two are separate tables (gate report D2).
 *
 * The rule from `order-status.ts` applies with no exceptions at all here:
 * **Kurdora creates a payment, and the provider decides everything after.**
 * The only non-webhook transition in this file is the one where we cancel an
 * intent we ourselves created and that has not been paid.
 */

export const PAYMENT_STATUSES = [
  'REQUIRES_PAYMENT_METHOD',
  'REQUIRES_ACTION',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * `platform` is Kurdora creating or cancelling an intent. `provider` is a
 * verified webhook. There is no `buyer` actor — a buyer confirms a payment at
 * Stripe, not here, and their browser telling us the outcome is not evidence.
 */
export type PaymentActor = 'platform' | 'provider';

export interface PaymentTransition {
  readonly from: PaymentStatus;
  readonly to: PaymentStatus;
  readonly actors: readonly PaymentActor[];
  readonly description: string;
}

export const PAYMENT_TRANSITIONS: readonly PaymentTransition[] = [
  {
    from: 'REQUIRES_PAYMENT_METHOD',
    to: 'REQUIRES_ACTION',
    actors: ['provider'],
    description: 'Authentication required',
  },
  {
    from: 'REQUIRES_PAYMENT_METHOD',
    to: 'PROCESSING',
    actors: ['provider'],
    description: 'Payment submitted',
  },
  {
    from: 'REQUIRES_PAYMENT_METHOD',
    to: 'SUCCEEDED',
    actors: ['provider'],
    description: 'Payment confirmed',
  },
  {
    from: 'REQUIRES_PAYMENT_METHOD',
    to: 'FAILED',
    actors: ['provider'],
    description: 'Payment failed',
  },
  {
    from: 'REQUIRES_PAYMENT_METHOD',
    to: 'CANCELED',
    actors: ['platform', 'provider'],
    description: 'Intent cancelled before payment',
  },

  {
    from: 'REQUIRES_ACTION',
    to: 'PROCESSING',
    actors: ['provider'],
    description: 'Authentication completed',
  },
  {
    from: 'REQUIRES_ACTION',
    to: 'SUCCEEDED',
    actors: ['provider'],
    description: 'Payment confirmed',
  },
  {
    from: 'REQUIRES_ACTION',
    to: 'FAILED',
    actors: ['provider'],
    description: 'Authentication failed',
  },
  {
    from: 'REQUIRES_ACTION',
    to: 'REQUIRES_PAYMENT_METHOD',
    actors: ['provider'],
    description: 'Buyer asked for another method',
  },
  {
    from: 'REQUIRES_ACTION',
    to: 'CANCELED',
    actors: ['platform', 'provider'],
    description: 'Intent cancelled',
  },

  {
    from: 'PROCESSING',
    to: 'SUCCEEDED',
    actors: ['provider'],
    description: 'Payment settled',
  },
  {
    from: 'PROCESSING',
    to: 'FAILED',
    actors: ['provider'],
    description: 'Payment failed after submission',
  },

  /*
   * A failed payment may be retried on the SAME intent — Stripe moves it back
   * to `requires_payment_method`. Modelling that explicitly is what makes a
   * retry produce a second PaymentAttempt rather than a second Payment.
   */
  {
    from: 'FAILED',
    to: 'REQUIRES_PAYMENT_METHOD',
    actors: ['provider'],
    description: 'Buyer retries on the same intent',
  },
  {
    from: 'FAILED',
    to: 'PROCESSING',
    actors: ['provider'],
    description: 'Retry submitted',
  },
  {
    from: 'FAILED',
    to: 'SUCCEEDED',
    actors: ['provider'],
    description: 'Retry succeeded',
  },
  {
    from: 'FAILED',
    to: 'CANCELED',
    actors: ['platform', 'provider'],
    description: 'Abandoned after failure',
  },
];

/**
 * `SUCCEEDED` and `CANCELED` are terminal.
 *
 * `SUCCEEDED` especially: there is no row anywhere in the table leaving it.
 * Money having been received is not a thing that gets un-decided by a later
 * event — a refund or a dispute is recorded on its own object, against an
 * order that stays truthful about having been paid.
 */
export const TERMINAL_PAYMENT_STATUSES: readonly PaymentStatus[] = ['SUCCEEDED', 'CANCELED'];

export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  return TERMINAL_PAYMENT_STATUSES.includes(status);
}

export type PaymentDecision =
  | { readonly allowed: true; readonly transition: PaymentTransition }
  | {
      readonly allowed: false;
      readonly reason: 'unknown_transition' | 'wrong_actor' | 'no_op' | 'provider_only';
    };

export function canTransitionPayment(
  from: PaymentStatus,
  to: PaymentStatus,
  actor: PaymentActor,
): PaymentDecision {
  if (from === to) return { allowed: false, reason: 'no_op' };

  const candidates = PAYMENT_TRANSITIONS.filter(
    (transition) => transition.from === from && transition.to === to,
  );
  if (candidates.length === 0) return { allowed: false, reason: 'unknown_transition' };

  const permitted = candidates.find((transition) => transition.actors.includes(actor));
  if (!permitted) {
    const providerOnly = candidates.every((transition) => transition.actors.includes('provider'));
    return { allowed: false, reason: providerOnly ? 'provider_only' : 'wrong_actor' };
  }

  return { allowed: true, transition: permitted };
}

// ── Payment attempts ────────────────────────────────────────────────────────

/**
 * One charge under a PaymentIntent.
 *
 * Attempts are created and closed by the provider only. There is no platform
 * actor at all, because we never make a charge happen — we make an intent and
 * the buyer confirms it at Stripe.
 */
export const PAYMENT_ATTEMPT_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED'] as const;

export type PaymentAttemptStatus = (typeof PAYMENT_ATTEMPT_STATUSES)[number];

export const PAYMENT_ATTEMPT_TRANSITIONS: readonly {
  from: PaymentAttemptStatus;
  to: PaymentAttemptStatus;
}[] = [
  { from: 'PENDING', to: 'SUCCEEDED' },
  { from: 'PENDING', to: 'FAILED' },
];

export function canTransitionPaymentAttempt(
  from: PaymentAttemptStatus,
  to: PaymentAttemptStatus,
): boolean {
  return PAYMENT_ATTEMPT_TRANSITIONS.some(
    (transition) => transition.from === from && transition.to === to,
  );
}

/**
 * Maps a provider intent status onto ours.
 *
 * `requires_confirmation` and `requires_capture` collapse into statuses we
 * already have: neither is a state Kurdora's flow can be in, because we use
 * automatic capture and the buyer confirms in the browser. Mapping them rather
 * than adding enum values keeps the state machine to the states we can
 * actually reach and test.
 */
export function paymentStatusFromProvider(providerStatus: string): PaymentStatus | null {
  switch (providerStatus) {
    case 'requires_payment_method':
      return 'REQUIRES_PAYMENT_METHOD';
    case 'requires_confirmation':
      return 'REQUIRES_PAYMENT_METHOD';
    case 'requires_action':
      return 'REQUIRES_ACTION';
    case 'processing':
      return 'PROCESSING';
    case 'requires_capture':
      return 'PROCESSING';
    case 'succeeded':
      return 'SUCCEEDED';
    case 'canceled':
      return 'CANCELED';
    default:
      // An unknown status is NOT mapped to something plausible. A new provider
      // state we have never seen must stop the processor and be looked at.
      return null;
  }
}
