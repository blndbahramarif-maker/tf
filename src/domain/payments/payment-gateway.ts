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
 * What Kurdora asks the provider to collect, for KURDORA'S OWN service.
 *
 * The marketplace vocabulary is GONE, not merely unused: there is no
 * destination account, no application fee and no transfer group on this type.
 * A destination charge is not something this codebase can express, which is a
 * stronger guarantee than a rule saying not to write one (ADR-0014).
 */
export interface CreateIntentInput {
  readonly amountMinor: bigint;
  readonly currency: string;
  /** Deterministic and durable. Ours, not the provider's. */
  readonly idempotencyKey: string;
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

/**
 * A settled charge, as the domain needs it.
 *
 * This type exists because **`latest_charge` alone is not sufficient** to
 * complete a payment attempt, and it is worth being explicit about why.
 *
 * A `payment_intent.succeeded` payload carries `latest_charge`, which gives us
 * a charge id and nothing else of substance. The figures that matter for
 * reconciliation — what Stripe actually took in fees, and what actually landed
 * in the platform balance — live on the charge's BALANCE TRANSACTION, which
 * appears in that payload as a bare string id at best. Kurdora never estimates
 * either number: an estimated fee that drifts from the real one produces a
 * ledger that looks balanced and is wrong, which is the most expensive kind of
 * accounting bug to find.
 *
 * So the charge is read back explicitly, with the balance transaction expanded.
 * `providerFeeMinor` and `netMinor` are NULLABLE and legitimately so: a charge
 * that has not settled yet has no balance transaction, and recording null is
 * honest where recording zero would be a lie that balances.
 */
export interface GatewayChargeSettlement {
  readonly chargeId: string;
  readonly paymentIntentId: string | null;
  readonly balanceTransactionId: string | null;
  readonly status: 'succeeded' | 'pending' | 'failed';
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly amountRefundedMinor: bigint;
  /** Stripe's `refunded` means FULLY refunded, not "has any refund". */
  readonly refunded: boolean;
  readonly disputed: boolean;
  readonly paymentMethodType: string | null;
  /** From the balance transaction. Null until the charge settles. */
  readonly providerFeeMinor: bigint | null;
  readonly netMinor: bigint | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly livemode: boolean;
}

export interface PaymentGateway {
  createPaymentIntent(input: CreateIntentInput): Promise<GatewayIntent>;
  retrievePaymentIntent(id: string): Promise<GatewayIntent | null>;
  /**
   * Reads a charge back with its balance transaction expanded.
   *
   * The only way to learn the REAL provider fee and net. See
   * `GatewayChargeSettlement` for why the webhook payload cannot supply them.
   */
  retrieveCharge(chargeId: string): Promise<GatewayChargeSettlement | null>;
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
