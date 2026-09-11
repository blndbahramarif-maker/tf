/**
 * Canonical posting recipes.
 *
 * Every money movement in Kurdora is expressed as one of these. Defining them
 * in one place means the double-entry pattern is reviewed once, rather than
 * reinvented at each call site — which is how ledgers drift out of balance.
 *
 * Account meanings:
 *   STRIPE_BALANCE   asset     — funds held at Stripe on our behalf
 *   SELLER_PAYABLE   liability — what we owe sellers
 *   PLATFORM_REVENUE income    — commission we have earned
 *   PAYMENT_FEES     expense   — what Stripe charged us
 *   REFUNDS          contra    — value returned to buyers
 *   DISPUTES         contra    — value lost to chargebacks
 *
 * Sign convention: DEBIT increases assets and expenses; CREDIT increases
 * liabilities and income.
 *
 * No function here touches a database. They return drafts; persistence is the
 * caller's job (Phase 8).
 */
import { buildEntryGroup, type EntryGroupDraft, type LedgerEntryDraft } from './entry-group';

export interface OrderPaidInput {
  readonly entryGroupId: string;
  readonly orderId: string;
  readonly sellerProfileId: string;
  readonly currency: string;
  /** What the buyer paid. */
  readonly totalMinor: bigint;
  /** Our commission, snapshotted on the order. */
  readonly commissionMinor: bigint;
  readonly occurredAt: Date;
  readonly livemode: boolean;
}

/**
 * A destination-charge order is paid.
 *
 *   DEBIT  STRIPE_BALANCE    total        (money arrives)
 *   CREDIT SELLER_PAYABLE    total − fee  (we owe the seller)
 *   CREDIT PLATFORM_REVENUE  commission   (we earned this)
 *
 * Stripe's own processing fee is NOT recorded here — it is a separate event
 * with its own balance transaction, and guessing it would make the ledger
 * disagree with Stripe. See recordPaymentFee.
 */
export function orderPaid(input: OrderPaidInput): EntryGroupDraft {
  const sellerMinor = input.totalMinor - input.commissionMinor;

  if (sellerMinor < 0n) {
    throw new RangeError(
      `Commission (${input.commissionMinor}) exceeds order total (${input.totalMinor}).`,
    );
  }

  const entries: LedgerEntryDraft[] = [
    {
      account: 'STRIPE_BALANCE',
      direction: 'DEBIT',
      amountMinor: input.totalMinor,
      currency: input.currency,
      description: `Order ${input.orderId} paid`,
      orderId: input.orderId,
    },
  ];

  // A fully discounted or zero-commission order has no seller leg to post.
  // Emitting a zero-amount entry would violate the positive-amount rule.
  if (sellerMinor > 0n) {
    entries.push({
      account: 'SELLER_PAYABLE',
      direction: 'CREDIT',
      amountMinor: sellerMinor,
      currency: input.currency,
      description: `Seller share of order ${input.orderId}`,
      orderId: input.orderId,
      sellerProfileId: input.sellerProfileId,
    });
  }

  if (input.commissionMinor > 0n) {
    entries.push({
      account: 'PLATFORM_REVENUE',
      direction: 'CREDIT',
      amountMinor: input.commissionMinor,
      currency: input.currency,
      description: `Commission on order ${input.orderId}`,
      orderId: input.orderId,
      sellerProfileId: input.sellerProfileId,
    });
  }

  return buildEntryGroup({
    entryGroupId: input.entryGroupId,
    entries,
    occurredAt: input.occurredAt,
    livemode: input.livemode,
  });
}

export interface FeeOnlyPaidInput {
  readonly entryGroupId: string;
  readonly orderId: string;
  readonly sellerProfileId: string;
  readonly currency: string;
  /** The platform fee only. The principal never passes through Stripe. */
  readonly feeMinor: bigint;
  readonly occurredAt: Date;
  readonly livemode: boolean;
}

/**
 * A FEE_ONLY order is paid (Cars, Business — see ADR-0007).
 *
 *   DEBIT  STRIPE_BALANCE    fee
 *   CREDIT PLATFORM_REVENUE  fee
 *
 * There is deliberately NO seller-payable leg: we never hold the purchase
 * principal, so we never owe it. That absence is the whole point of the
 * fee-only design, and it is visible right here in the ledger.
 */
export function feeOnlyPaid(input: FeeOnlyPaidInput): EntryGroupDraft {
  if (input.feeMinor <= 0n) {
    throw new RangeError(`Fee-only orders must charge a positive fee, got ${input.feeMinor}.`);
  }

  return buildEntryGroup({
    entryGroupId: input.entryGroupId,
    entries: [
      {
        account: 'STRIPE_BALANCE',
        direction: 'DEBIT',
        amountMinor: input.feeMinor,
        currency: input.currency,
        description: `Platform fee for order ${input.orderId}`,
        orderId: input.orderId,
      },
      {
        account: 'PLATFORM_REVENUE',
        direction: 'CREDIT',
        amountMinor: input.feeMinor,
        currency: input.currency,
        description: `Fee-only revenue for order ${input.orderId}`,
        orderId: input.orderId,
        sellerProfileId: input.sellerProfileId,
      },
    ],
    occurredAt: input.occurredAt,
    livemode: input.livemode,
  });
}

export interface PaymentFeeInput {
  readonly entryGroupId: string;
  readonly orderId: string;
  readonly currency: string;
  /** Read from the Stripe balance transaction. Never estimated. */
  readonly feeMinor: bigint;
  readonly occurredAt: Date;
  readonly livemode: boolean;
}

/**
 * Stripe's processing fee.
 *
 *   DEBIT  PAYMENT_FEES    fee  (an expense we incurred)
 *   CREDIT STRIPE_BALANCE  fee  (deducted from our balance)
 *
 * Posted from the balance transaction so the ledger records what Stripe
 * actually charged, not what we predicted. This is what makes
 * `commission − fees` an honest revenue figure.
 */
export function recordPaymentFee(input: PaymentFeeInput): EntryGroupDraft {
  if (input.feeMinor <= 0n) {
    throw new RangeError(`Payment fee must be positive, got ${input.feeMinor}.`);
  }

  return buildEntryGroup({
    entryGroupId: input.entryGroupId,
    entries: [
      {
        account: 'PAYMENT_FEES',
        direction: 'DEBIT',
        amountMinor: input.feeMinor,
        currency: input.currency,
        description: `Provider fee on order ${input.orderId}`,
        orderId: input.orderId,
      },
      {
        account: 'STRIPE_BALANCE',
        direction: 'CREDIT',
        amountMinor: input.feeMinor,
        currency: input.currency,
        description: `Provider fee deducted for order ${input.orderId}`,
        orderId: input.orderId,
      },
    ],
    occurredAt: input.occurredAt,
    livemode: input.livemode,
  });
}

export interface PayoutSettledInput {
  readonly entryGroupId: string;
  readonly payoutId: string;
  readonly sellerProfileId: string;
  readonly currency: string;
  readonly amountMinor: bigint;
  readonly occurredAt: Date;
  readonly livemode: boolean;
}

/**
 * A seller is paid out.
 *
 *   DEBIT  SELLER_PAYABLE  amount  (the liability is discharged)
 *   CREDIT STRIPE_BALANCE  amount  (cash leaves)
 */
export function payoutSettled(input: PayoutSettledInput): EntryGroupDraft {
  if (input.amountMinor <= 0n) {
    throw new RangeError(`Payout must be positive, got ${input.amountMinor}.`);
  }

  return buildEntryGroup({
    entryGroupId: input.entryGroupId,
    entries: [
      {
        account: 'SELLER_PAYABLE',
        direction: 'DEBIT',
        amountMinor: input.amountMinor,
        currency: input.currency,
        description: `Payout ${input.payoutId} to seller`,
        payoutId: input.payoutId,
        sellerProfileId: input.sellerProfileId,
      },
      {
        account: 'STRIPE_BALANCE',
        direction: 'CREDIT',
        amountMinor: input.amountMinor,
        currency: input.currency,
        description: `Payout ${input.payoutId} leaving balance`,
        payoutId: input.payoutId,
        sellerProfileId: input.sellerProfileId,
      },
    ],
    occurredAt: input.occurredAt,
    livemode: input.livemode,
  });
}

export interface RefundIssuedInput {
  readonly entryGroupId: string;
  readonly orderId: string;
  readonly refundId: string;
  readonly sellerProfileId: string;
  readonly currency: string;
  /** Total returned to the buyer. */
  readonly amountMinor: bigint;
  /** Portion recovered from the seller (Stripe `reverse_transfer`). */
  readonly sellerClawbackMinor: bigint;
  /** Portion of our commission given up (Stripe `refund_application_fee`). */
  readonly commissionReturnedMinor: bigint;
  readonly occurredAt: Date;
  readonly livemode: boolean;
}

/**
 * A refund is issued.
 *
 *   CREDIT STRIPE_BALANCE   amount              (cash leaves, to the buyer)
 *   DEBIT  SELLER_PAYABLE   clawback            (we owe the seller less)
 *   DEBIT  PLATFORM_REVENUE commissionReturned  (we earned less)
 *   DEBIT  REFUNDS          the remainder       (what the PLATFORM absorbs)
 *
 * Exactly `amount` leaves the balance — one refund, one cash movement. The
 * three debits partition who bore that cost.
 *
 * The partition matters because Stripe's DEFAULT is that the seller keeps the
 * money and the platform absorbs the whole refund. Recording who actually paid
 * is the difference between a ledger and a guess, and it is the number that
 * tells us whether refunds are eating the margin.
 */
export function refundIssued(input: RefundIssuedInput): EntryGroupDraft {
  if (input.amountMinor <= 0n) {
    throw new RangeError(`Refund must be positive, got ${input.amountMinor}.`);
  }
  if (input.sellerClawbackMinor < 0n || input.commissionReturnedMinor < 0n) {
    throw new RangeError('Refund components must not be negative.');
  }

  const recovered = input.sellerClawbackMinor + input.commissionReturnedMinor;
  if (recovered > input.amountMinor) {
    throw new RangeError(
      `Refund recovery (${recovered}) exceeds the refunded amount (${input.amountMinor}). ` +
        `We cannot claw back more than the buyer was given.`,
    );
  }

  /** What the platform eats: whatever was not recovered from anyone. */
  const platformAbsorbedMinor = input.amountMinor - recovered;

  const entries: LedgerEntryDraft[] = [
    {
      account: 'STRIPE_BALANCE',
      direction: 'CREDIT',
      amountMinor: input.amountMinor,
      currency: input.currency,
      description: `Refund ${input.refundId} paid to buyer for order ${input.orderId}`,
      orderId: input.orderId,
      refundId: input.refundId,
    },
  ];

  if (input.sellerClawbackMinor > 0n) {
    entries.push({
      account: 'SELLER_PAYABLE',
      direction: 'DEBIT',
      amountMinor: input.sellerClawbackMinor,
      currency: input.currency,
      description: `Seller clawback for refund ${input.refundId}`,
      orderId: input.orderId,
      refundId: input.refundId,
      sellerProfileId: input.sellerProfileId,
    });
  }

  if (input.commissionReturnedMinor > 0n) {
    entries.push({
      account: 'PLATFORM_REVENUE',
      direction: 'DEBIT',
      amountMinor: input.commissionReturnedMinor,
      currency: input.currency,
      description: `Commission returned for refund ${input.refundId}`,
      orderId: input.orderId,
      refundId: input.refundId,
      sellerProfileId: input.sellerProfileId,
    });
  }

  if (platformAbsorbedMinor > 0n) {
    entries.push({
      account: 'REFUNDS',
      direction: 'DEBIT',
      amountMinor: platformAbsorbedMinor,
      currency: input.currency,
      description: `Platform-absorbed portion of refund ${input.refundId}`,
      orderId: input.orderId,
      refundId: input.refundId,
      sellerProfileId: input.sellerProfileId,
    });
  }

  return buildEntryGroup({
    entryGroupId: input.entryGroupId,
    entries,
    occurredAt: input.occurredAt,
    livemode: input.livemode,
  });
}
