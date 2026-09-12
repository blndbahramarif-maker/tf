/**
 * Offer amount validation.
 *
 * Pure integer arithmetic on `bigint` minor units. There is no floating point
 * here and there must never be: an offer is a number a buyer is held to, and a
 * penny of drift is a dispute (ADR-0006).
 *
 * The SERVER decides whether an amount is acceptable. The browser sends a
 * candidate; every bound below is re-derived from the listing and the category
 * row, never from the request.
 */

export type OfferAmountIssue =
  | 'not_an_integer'
  | 'not_positive'
  | 'currency_mismatch'
  | 'below_minimum'
  | 'above_listing_price'
  | 'too_large';

/**
 * Hard ceiling, well inside a signed 64-bit column.
 *
 * A listing priced in the billions is a data-entry error, not a sale, and an
 * amount near the column limit is how an overflow becomes someone else's
 * problem later.
 */
export const MAX_OFFER_MINOR = 10_000_000_000_000n; // 100 billion major units

export interface OfferAmountInput {
  /** As submitted, still a string: it crossed the wire (ADR-0004). */
  readonly amountMinor: string;
  readonly currency: string;
  /** The listing's own price and currency, read from the database. */
  readonly listingPriceMinor: bigint | null;
  readonly listingCurrency: string;
  /** Category floor, when the category sets one. */
  readonly categoryMinimumMinor: bigint | null;
  /**
   * Whether an offer may exceed the asking price.
   *
   * It may: in a competitive category a buyer bidding above asking is normal,
   * and refusing it would be the marketplace deciding a seller should earn
   * less. Set false only where a category genuinely forbids it.
   */
  readonly allowAboveAsking?: boolean;
}

export type OfferAmountResult =
  | { readonly ok: true; readonly amountMinor: bigint; readonly currency: string }
  | { readonly ok: false; readonly issue: OfferAmountIssue };

export function validateOfferAmount(input: OfferAmountInput): OfferAmountResult {
  // Digits only. No sign, no decimal point, no exponent — an offer of "1e3"
  // or "10.50" means the client is sending major units or a float, and the
  // right answer is to refuse rather than guess.
  if (!/^\d{1,19}$/.test(input.amountMinor)) {
    return { ok: false, issue: 'not_an_integer' };
  }

  const amountMinor = BigInt(input.amountMinor);
  if (amountMinor <= 0n) return { ok: false, issue: 'not_positive' };
  if (amountMinor > MAX_OFFER_MINOR) return { ok: false, issue: 'too_large' };

  const currency = input.currency.toUpperCase();
  // Cross-currency offers are not a feature. Comparing amounts in different
  // currencies without a recorded rate is how money goes missing.
  if (currency !== input.listingCurrency.toUpperCase()) {
    return { ok: false, issue: 'currency_mismatch' };
  }

  if (input.categoryMinimumMinor !== null && amountMinor < input.categoryMinimumMinor) {
    return { ok: false, issue: 'below_minimum' };
  }

  if (
    input.allowAboveAsking === false &&
    input.listingPriceMinor !== null &&
    amountMinor > input.listingPriceMinor
  ) {
    return { ok: false, issue: 'above_listing_price' };
  }

  return { ok: true, amountMinor, currency };
}
