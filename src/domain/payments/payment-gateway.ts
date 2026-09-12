/**
 * The payment provider, as the domain sees it.
 *
 * Deliberately framework-free and provider-free: no Stripe type appears here,
 * and nothing in this file knows that Stripe exists. `src/infra/stripe`
 * implements it; tests substitute a clearly-labelled fake. That is the ADR-0002
 * port rule applied to money, and it is what keeps a `Stripe.PaymentIntent`
 * from leaking into a route signature and quietly becoming the contract.
 *
 * Note what is NOT on this interface. There is no `markPaid`, no
 * `confirmPayment`, no `capture`. The gateway can CREATE an intent and READ
 * one back; it cannot be asked to declare a payment successful. Payment state
 * arrives through verified webhooks and nowhere else (ADR-0013).
 */

/** Integer minor units as a string on the wire, `bigint` in the domain. */
export interface GatewayMoney {
  readonly amountMinor: bigint;
  readonly currency: string;
}

/**
 * What the platform asks the provider to collect.
 *
 * `destination` and `applicationFeeMinor` are present together or not at all —
 * see `assertTransferShape`. A FEE_ONLY charge carries neither, which is the
 * whole point of that flow: there is no transfer leg to get wrong.
 */
export interface CreateIntentInput {
  readonly amountMinor: bigint;
  readonly currency: string;
  /** Deterministic and durable. Ours, not the provider's. */
  readonly idempotencyKey: string;
  /** Connected account receiving the funds. Omitted entirely for FEE_ONLY. */
  readonly destinationAccountId?: string;
  /** The platform's commission. Omitted entirely for FEE_ONLY. */
  readonly applicationFeeMinor?: bigint;
  /** Groups the charge and its transfer for reconciliation. */
  readonly transferGroup?: string;
  /** Shown on the buyer's statement. Says what the charge is FOR. */
  readonly statementDescriptorSuffix?: string;
  /** Our own ids, echoed back on every webhook. Never trusted as authority. */
  readonly metadata: Readonly<Record<string, string>>;
}

export type GatewayIntentStatus =
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'requires_action'
  | 'processing'
  | 'requires_capture'
  | 'succeeded'
  | 'canceled';

export interface GatewayIntent {
  readonly id: string;
  readonly status: GatewayIntentStatus;
  readonly amountMinor: bigint;
  readonly currency: string;
  /** Needed by the browser to confirm. Never logged, never stored. */
  readonly clientSecret: string | null;
  readonly latestChargeId: string | null;
  readonly applicationFeeMinor: bigint | null;
  readonly destinationAccountId: string | null;
  readonly livemode: boolean;
}

/** A verified provider event. Produced only after a signature check passes. */
export interface GatewayEvent {
  readonly id: string;
  readonly type: string;
  readonly apiVersion: string | null;
  readonly livemode: boolean;
  /** The event's primary object id — `pi_…`, `ch_…`, `acct_…`. */
  readonly objectId: string | null;
  readonly payload: unknown;
}

export interface PaymentGateway {
  createPaymentIntent(input: CreateIntentInput): Promise<GatewayIntent>;
  retrievePaymentIntent(id: string): Promise<GatewayIntent | null>;
  /**
   * Verifies a signature over the RAW request body and returns the event.
   *
   * Throws on any failure. There is no "unverified but probably fine" return
   * value, because a caller would eventually treat one as fine.
   */
  constructEvent(rawBody: string, signatureHeader: string): GatewayEvent;
  /** True when the provider is configured in test/sandbox mode. */
  readonly isTestMode: boolean;
}

/**
 * The transfer shape invariant, checked in the domain before anything reaches
 * a provider.
 *
 * A destination without a fee, or a fee without a destination, is a bug that
 * would move real money to the wrong place. Refusing the pair outright is
 * cheaper than reasoning about which half is right.
 */
export function assertTransferShape(input: CreateIntentInput): void {
  const hasDestination = input.destinationAccountId !== undefined;
  const hasFee = input.applicationFeeMinor !== undefined;

  if (hasDestination !== hasFee) {
    throw new Error(
      'A destination account and an application fee must be present together or not at all.',
    );
  }
  if (hasFee && input.applicationFeeMinor! > input.amountMinor) {
    // Stripe caps it anyway; refusing here means the mistake is visible in our
    // own stack trace rather than as a provider error two layers away.
    throw new Error('The application fee cannot exceed the charge amount.');
  }
  if (input.amountMinor <= 0n) {
    throw new Error('A charge amount must be positive.');
  }
}
