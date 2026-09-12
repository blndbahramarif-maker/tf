import Stripe from 'stripe';
import { brand } from '@kurdora/brand';
import {
  assertTransferShape,
  type CreateIntentInput,
  type GatewayChargeSettlement,
  type GatewayEvent,
  type GatewayIntent,
  type GatewayIntentStatus,
  type PaymentGateway,
} from '@/domain/payments/payment-gateway';
import { requireStripeConfig, type StripeConfig } from './config';

/**
 * The Stripe adapter. **The only module in the codebase that imports the SDK**
 * (CLAUDE.md non-negotiable 2, enforced by lint and by
 * `tests/architecture.test.ts`).
 *
 * Everything above this file speaks `PaymentGateway`. That is not ceremony: it
 * is what lets the test suite drive the whole payment path without a network,
 * and what keeps a `Stripe.PaymentIntent` from becoming the de-facto contract
 * of a route.
 *
 * Amounts cross this boundary as `bigint` minor units and are narrowed to
 * `number` only at the SDK call, because Stripe's API takes a JSON number.
 * `assertAmountFitsNumber` refuses anything that would lose precision rather
 * than rounding it — a silently truncated charge is the exact failure ADR-0006
 * exists to prevent.
 */

/**
 * Pinned deliberately.
 *
 * The SDK's built-in default moves when the package is upgraded, and an API
 * version change can alter webhook payload shapes underneath a running
 * integration. Pinning means an upgrade is a reviewed decision with a diff,
 * not a side effect of `pnpm update`.
 */
export const STRIPE_API_VERSION = '2026-08-26.dahlia';

/**
 * `Number.MAX_SAFE_INTEGER` is 9,007,199,254,740,991 minor units. Anything
 * approaching it is a data-entry error, not a sale, but the check exists so
 * the failure is loud rather than silent.
 */
function assertAmountFitsNumber(amountMinor: bigint, field: string): number {
  if (amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${field} exceeds the precision a JSON number can carry.`);
  }
  return Number(amountMinor);
}

function toGatewayIntent(intent: Stripe.PaymentIntent): GatewayIntent {
  const transferDestination = intent.transfer_data?.destination ?? null;

  return {
    id: intent.id,
    status: intent.status as GatewayIntentStatus,
    amountMinor: BigInt(intent.amount),
    currency: intent.currency.toUpperCase(),
    clientSecret: intent.client_secret ?? null,
    latestChargeId: typeof intent.latest_charge === 'string' ? intent.latest_charge : null,
    applicationFeeMinor:
      intent.application_fee_amount === null || intent.application_fee_amount === undefined
        ? null
        : BigInt(intent.application_fee_amount),
    destinationAccountId:
      typeof transferDestination === 'string'
        ? transferDestination
        : (transferDestination?.id ?? null),
    livemode: intent.livemode,
  };
}

/**
 * Narrows Stripe's charge status to the three documented values.
 *
 * The SDK types this field as an OPEN union — the three values plus an escape
 * hatch for anything Stripe adds later. That openness is why this is a switch
 * and not a cast: an unrecognised status must not be waved through as
 * `succeeded`. It becomes `pending`, the conservative reading, because
 * "we do not know yet" is the only honest thing to say about a status this
 * code has never seen, and `pending` is the one value that causes nothing to
 * happen.
 */
function toChargeStatus(status: string): GatewayChargeSettlement['status'] {
  if (status === 'succeeded' || status === 'failed') return status;
  return 'pending';
}

/**
 * A `Stripe.Charge` reduced to the facts Kurdora records.
 *
 * The two money figures come from the BALANCE TRANSACTION and nowhere else.
 * Verified against Stripe's documentation on 2026-09-12: `fee` is "Fees (in the
 * smallest currency unit) paid for this transaction. Represented as a positive
 * integer when assessed", and `net` is the "Net impact to a Stripe balance…
 * You can calculate the net impact of a transaction on a balance by
 * `amount` - `fee`".
 *
 * Both stay NULL when the balance transaction is absent or unexpanded. A
 * pending charge genuinely has none, and writing 0 there would be a figure
 * that reconciles against nothing.
 *
 * One thing this does NOT claim: for a destination charge, `net` is the impact
 * on the PLATFORM balance "not including refunds or disputes" — the transfer to
 * the connected account is its own balance transaction. So this is the
 * platform-side figure, not the seller's.
 */
function toChargeSettlement(charge: Stripe.Charge): GatewayChargeSettlement {
  const balanceTransaction = charge.balance_transaction;
  const expanded = typeof balanceTransaction === 'object' ? balanceTransaction : null;

  const transferDestination = charge.transfer_data?.destination ?? null;

  return {
    chargeId: charge.id,
    paymentIntentId:
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : (charge.payment_intent?.id ?? null),
    balanceTransactionId:
      typeof balanceTransaction === 'string' ? balanceTransaction : (expanded?.id ?? null),
    status: toChargeStatus(charge.status),
    amountMinor: BigInt(charge.amount),
    currency: charge.currency.toUpperCase(),
    amountRefundedMinor: BigInt(charge.amount_refunded ?? 0),
    // Stripe: "Whether the charge has been fully refunded. If the charge is
    // only partially refunded, this attribute will still be false." Mirrored
    // verbatim rather than re-derived, so our column means what Stripe's does.
    refunded: charge.refunded ?? false,
    disputed: charge.disputed ?? false,
    paymentMethodType: charge.payment_method_details?.type ?? null,
    transferId:
      typeof charge.transfer === 'string' ? charge.transfer : (charge.transfer?.id ?? null),
    destinationAccountId:
      typeof transferDestination === 'string'
        ? transferDestination
        : (transferDestination?.id ?? null),
    providerFeeMinor: expanded === null ? null : BigInt(expanded.fee),
    netMinor: expanded === null ? null : BigInt(expanded.net),
    failureCode: charge.failure_code ?? null,
    failureMessage: charge.failure_message ?? null,
    livemode: charge.livemode,
  };
}

/** Pulls the event's primary object id, for triage and semantic dedup. */
function eventObjectId(event: Stripe.Event): string | null {
  const object = event.data.object as { id?: unknown };
  return typeof object.id === 'string' ? object.id : null;
}

export class StripeGateway implements PaymentGateway {
  private readonly stripe: Stripe;
  private readonly config: StripeConfig;

  constructor(config: StripeConfig) {
    this.config = config;
    this.stripe = new Stripe(config.secretKey, {
      apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
      // Named so Stripe's logs and our support tickets agree on who called.
      // From the brand package, never a literal (CLAUDE.md non-negotiable 6) —
      // a rename must not leave the payment provider calling us by an old name.
      appInfo: { name: brand.name, url: `https://${brand.domains.primary}` },
      // Fail fast rather than hold a request open. A create that times out is
      // retried with the SAME idempotency key, so a retry is safe.
      timeout: 20_000,
      maxNetworkRetries: 2,
    });
  }

  get isTestMode(): boolean {
    return this.config.mode === 'test';
  }

  async createPaymentIntent(input: CreateIntentInput): Promise<GatewayIntent> {
    // Checked in the DOMAIN, before anything provider-shaped exists. A fee
    // without a destination, or a destination without a fee, never reaches
    // the network.
    assertTransferShape(input);

    const params: Stripe.PaymentIntentCreateParams = {
      amount: assertAmountFitsNumber(input.amountMinor, 'amount'),
      currency: input.currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      metadata: { ...input.metadata },
    };

    if (input.destinationAccountId !== undefined && input.applicationFeeMinor !== undefined) {
      /*
       * `application_fee_amount` rather than `transfer_data[amount]`: it
       * creates an explicit ApplicationFee object linked to the charge, and it
       * lets the seller see both the gross and the fee. `transfer_data[amount]`
       * hides the gross from them (ADR-0013).
       *
       * `on_behalf_of` is deliberately NOT set. Cross-border payouts supports
       * only "destination charges without on_behalf_of", and omitting it makes
       * Kurdora the business of record — which is what we want anyway.
       */
      params.application_fee_amount = assertAmountFitsNumber(
        input.applicationFeeMinor,
        'application_fee_amount',
      );
      params.transfer_data = { destination: input.destinationAccountId };
    }

    if (input.transferGroup !== undefined) params.transfer_group = input.transferGroup;
    if (input.statementDescriptorSuffix !== undefined) {
      params.statement_descriptor_suffix = input.statementDescriptorSuffix;
    }

    const intent = await this.stripe.paymentIntents.create(params, {
      idempotencyKey: input.idempotencyKey,
    });
    return toGatewayIntent(intent);
  }

  async retrievePaymentIntent(id: string): Promise<GatewayIntent | null> {
    try {
      return toGatewayIntent(await this.stripe.paymentIntents.retrieve(id));
    } catch (error) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async retrieveCharge(chargeId: string): Promise<GatewayChargeSettlement | null> {
    try {
      /*
       * `balance_transaction` is EXPANDED. Verified against Stripe's Charge
       * object documentation on 2026-09-12: unexpanded it is "ID of the
       * balance transaction that describes the impact of this charge on your
       * account balance", i.e. a bare `txn_…` string carrying no figures. One
       * expanded read is cheaper than a second round trip, and it is the only
       * way to record the REAL fee rather than an estimate of it.
       */
      const charge = await this.stripe.charges.retrieve(chargeId, {
        expand: ['balance_transaction'],
      });
      return toChargeSettlement(charge);
    } catch (error) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  constructEvent(rawBody: string, signatureHeader: string): GatewayEvent {
    /*
     * `constructEvent` does the whole job: HMAC-SHA256 over
     * `<timestamp>.<raw body>`, v1 scheme only, and a default 5-minute
     * tolerance that rejects replays. It THROWS on failure, which is the
     * behaviour we want — there is no "unverified but probably fine" path for
     * a caller to mistake for success.
     */
    const event = this.stripe.webhooks.constructEvent(
      rawBody,
      signatureHeader,
      this.config.webhookSecret,
    );

    return {
      id: event.id,
      type: event.type,
      apiVersion: event.api_version ?? null,
      livemode: event.livemode,
      objectId: eventObjectId(event),
      payload: event,
    };
  }
}

let cached: StripeGateway | null = null;

/**
 * The process-wide gateway.
 *
 * Cached because constructing a `Stripe` instance per request wastes the
 * connection pool. Throws `StripeNotConfiguredError` when Stripe is absent or
 * when a live key is present while live mode is not permitted — callers turn
 * that into a 503, never a 500 with a stack trace.
 */
export function stripeGateway(): StripeGateway {
  if (cached === null) cached = new StripeGateway(requireStripeConfig());
  return cached;
}

/** Test-only. Drops the cached client so a changed environment is re-read. */
export function resetStripeGatewayCache(): void {
  cached = null;
}
