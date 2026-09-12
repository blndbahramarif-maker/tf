/**
 * What a buyer is charged, and the invariant that keeps a £50,000 car from
 * ever reaching a payment provider.
 *
 * Pure integer arithmetic on `bigint` minor units and basis points. No floats,
 * no `parseFloat`, no decimal percentages (ADR-0006).
 *
 * Every input here is read from the DATABASE by the caller — the listing's
 * price, the listing owner's connected account, the category's flow and
 * ceiling, the commission rule. Nothing in this file accepts a number a
 * browser supplied, and the whole point of computing it here is that the
 * request has no say in the answer.
 */

export type TransactionFlow = 'BUY_NOW' | 'OFFER_THEN_PAY' | 'FEE_ONLY' | 'CONTACT_ONLY';

export type OrderAmountIssue =
  | 'not_purchasable'
  | 'no_price'
  | 'principal_required'
  | 'principal_not_positive'
  | 'amount_not_positive'
  | 'commission_exceeds_total'
  | 'above_online_ceiling'
  | 'currency_mismatch';

export interface CommissionSnapshot {
  /** Basis points. 0.5% = 50. Never a decimal percentage. */
  readonly percentBps: number;
  readonly fixedMinor: bigint;
  readonly minMinor: bigint | null;
  readonly maxMinor: bigint | null;
}

export interface OrderAmountInput {
  readonly flow: TransactionFlow;
  /** The listing's asking price, or the accepted offer amount. */
  readonly agreedPriceMinor: bigint | null;
  readonly currency: string;
  readonly listingCurrency: string;
  readonly commission: CommissionSnapshot;
  /**
   * The category's ceiling on what may be charged ONLINE. For Cars this is
   * £5,000 against a car that may cost £50,000 — it exists precisely so a
   * misconfiguration cannot put the principal through the fee-only flow.
   */
  readonly maxOnlineAmountMinor: bigint | null;
}

/**
 * The computed, immutable money for one order.
 *
 * `totalMinor` is what the buyer is charged. `principalMinor` is the agreed
 * sale price, which for FEE_ONLY is recorded and **never charged**.
 */
export interface OrderAmounts {
  readonly totalMinor: bigint;
  readonly commissionAmountMinor: bigint;
  readonly sellerAmountMinor: bigint;
  /** Null for BUY_NOW, where the principal IS the total. */
  readonly principalMinor: bigint | null;
  readonly currency: string;
  /** Whether the charge carries a transfer leg to a connected account. */
  readonly hasTransferLeg: boolean;
}

export type OrderAmountResult =
  | { readonly ok: true; readonly amounts: OrderAmounts }
  | { readonly ok: false; readonly issue: OrderAmountIssue };

/**
 * Commission, in integer minor units.
 *
 * `(amount * bps) / 10_000` in `bigint` truncates toward zero, which rounds in
 * the seller's favour by at most one minor unit. That is a deliberate choice:
 * rounding a fee UP means taking a penny nobody agreed to.
 */
export function computeCommission(baseMinor: bigint, commission: CommissionSnapshot): bigint {
  if (baseMinor <= 0n) return 0n;

  const percentPart = (baseMinor * BigInt(commission.percentBps)) / 10_000n;
  let total = percentPart + commission.fixedMinor;

  if (commission.minMinor !== null && total < commission.minMinor) total = commission.minMinor;
  if (commission.maxMinor !== null && total > commission.maxMinor) total = commission.maxMinor;

  return total;
}

/** Flows a buyer can actually pay for. CONTACT_ONLY is an introduction only. */
export function isPurchasable(flow: TransactionFlow): boolean {
  return flow === 'BUY_NOW' || flow === 'OFFER_THEN_PAY' || flow === 'FEE_ONLY';
}

/** True when the flow charges the platform's fee ALONE. */
export function isFeeOnly(flow: TransactionFlow): boolean {
  return flow === 'FEE_ONLY';
}

export function computeOrderAmounts(input: OrderAmountInput): OrderAmountResult {
  if (!isPurchasable(input.flow)) return { ok: false, issue: 'not_purchasable' };

  if (input.currency.toUpperCase() !== input.listingCurrency.toUpperCase()) {
    return { ok: false, issue: 'currency_mismatch' };
  }
  const currency = input.currency.toUpperCase();

  if (input.agreedPriceMinor === null) return { ok: false, issue: 'no_price' };
  if (input.agreedPriceMinor <= 0n) return { ok: false, issue: 'principal_not_positive' };

  const commissionAmountMinor = computeCommission(input.agreedPriceMinor, input.commission);

  const amounts: OrderAmounts = isFeeOnly(input.flow)
    ? {
        /*
         * THE INVARIANT. The buyer is charged the COMMISSION and nothing else.
         * The agreed price is recorded as `principalMinor` for reporting and
         * as the commission basis — it is never the charge amount, never sent
         * to a provider, and never settled by Kurdora.
         *
         * Mirrored as a database CHECK, because an application rule binds only
         * the code that goes through it (ADR-0010).
         */
        totalMinor: commissionAmountMinor,
        commissionAmountMinor,
        sellerAmountMinor: 0n,
        principalMinor: input.agreedPriceMinor,
        currency,
        hasTransferLeg: false,
      }
    : {
        totalMinor: input.agreedPriceMinor,
        commissionAmountMinor,
        // Derived by subtraction so the two can never disagree by a penny.
        sellerAmountMinor: input.agreedPriceMinor - commissionAmountMinor,
        principalMinor: null,
        currency,
        hasTransferLeg: true,
      };

  if (amounts.totalMinor <= 0n) return { ok: false, issue: 'amount_not_positive' };
  if (amounts.commissionAmountMinor > amounts.totalMinor) {
    return { ok: false, issue: 'commission_exceeds_total' };
  }

  /*
   * The ceiling applies to what is CHARGED, not to the sale. A £50,000 car
   * with a £250 fee passes; a misconfigured fee-only order that somehow
   * carried £50,000 as its total does not.
   */
  if (input.maxOnlineAmountMinor !== null && amounts.totalMinor > input.maxOnlineAmountMinor) {
    return { ok: false, issue: 'above_online_ceiling' };
  }

  return { ok: true, amounts };
}

/**
 * The last gate before a provider call.
 *
 * Re-checks the invariant against the values as they are about to be sent,
 * rather than trusting that `computeOrderAmounts` produced them. Cheap, and it
 * catches the case this whole design exists to prevent: a code path that
 * assembles a charge from an order row by hand and gets the fee-only shape
 * wrong.
 *
 * Throws rather than returning a result, because there is no sensible way for
 * a caller to continue.
 */
export function assertChargeIsSafe(input: {
  flow: TransactionFlow;
  chargeAmountMinor: bigint;
  commissionAmountMinor: bigint;
  principalMinor: bigint | null;
  destinationAccountId: string | null;
  applicationFeeMinor: bigint | null;
}): void {
  if (input.chargeAmountMinor <= 0n) {
    throw new Error('Refusing to charge a non-positive amount.');
  }

  if (!isFeeOnly(input.flow)) {
    if (input.destinationAccountId === null || input.applicationFeeMinor === null) {
      throw new Error('A marketplace charge must carry a destination account and a fee.');
    }
    if (input.applicationFeeMinor > input.chargeAmountMinor) {
      throw new Error('The application fee cannot exceed the charge amount.');
    }
    return;
  }

  // ── FEE_ONLY, where the rules are absolute ────────────────────────────────
  if (input.chargeAmountMinor !== input.commissionAmountMinor) {
    throw new Error(
      'FEE_ONLY charges the commission and nothing else. Refusing to send a different amount.',
    );
  }
  if (input.destinationAccountId !== null || input.applicationFeeMinor !== null) {
    throw new Error('A FEE_ONLY charge has no transfer leg. Refusing to attach one.');
  }
  if (input.principalMinor !== null && input.chargeAmountMinor >= input.principalMinor) {
    /*
     * The fee is a fraction of the sale. A charge that equals or exceeds the
     * principal means the principal has leaked into the amount — which is the
     * £50,000 mistake, caught one call before it would have been made.
     *
     * Equality is refused too: a fee that happens to equal the sale price is
     * not a fee, and treating it as one would let the check pass on exactly
     * the boundary it exists to guard.
     */
    throw new Error('Refusing to charge the sale principal through the fee-only flow.');
  }
}
