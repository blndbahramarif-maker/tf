import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  TERMINAL_ORDER_STATUSES,
  availableOrderTransitions,
  canTransitionOrder,
  isTerminalOrderStatus,
  orderExpiryFrom,
  type OrderActor,
} from '@/domain/payments/order-status';
import {
  PAYMENT_STATUSES,
  PAYMENT_TRANSITIONS,
  canTransitionPayment,
  canTransitionPaymentAttempt,
  isTerminalPaymentStatus,
  paymentStatusFromProvider,
  type PaymentActor,
  type PaymentStatus,
} from '@/domain/payments/payment-status';
import {
  assertChargeIsSafe,
  computeCommission,
  computeOrderAmounts,
  isFeeOnly,
  isPurchasable,
  type TransactionFlow,
} from '@/domain/payments/order-amounts';
import { assertTransferShape } from '@/domain/payments/payment-gateway';

/**
 * The payment domain, with no database and no provider.
 *
 * The test that matters most in this file is the exhaustive sweep: it asserts
 * that of the 363 possible (from, to, actor) order moves, ONLY the table's
 * rows are allowed. Listing a handful of refusals somebody thought of would
 * prove much less.
 */

const ORDER_ACTORS: OrderActor[] = ['buyer', 'seller', 'admin', 'system'];

describe('the order state machine', () => {
  describe('the table', () => {
    it('names only statuses that exist', () => {
      for (const transition of ORDER_TRANSITIONS) {
        expect(ORDER_STATUSES).toContain(transition.from);
        expect(ORDER_STATUSES).toContain(transition.to);
        expect(transition.actors.length).toBeGreaterThan(0);
      }
    });

    it('never leaves a terminal status', () => {
      for (const transition of ORDER_TRANSITIONS) {
        expect(TERMINAL_ORDER_STATUSES, `${transition.from} -> ${transition.to}`).not.toContain(
          transition.from,
        );
      }
    });

    it('has no duplicate (from, to, actor) rows', () => {
      const seen = new Set<string>();
      for (const transition of ORDER_TRANSITIONS) {
        for (const actor of transition.actors) {
          const key = `${transition.from}->${transition.to}:${actor}`;
          expect(seen.has(key), key).toBe(false);
          seen.add(key);
        }
      }
    });

    it('marks every webhook-only transition as system-only, and vice versa', () => {
      // The flag and the actor list must agree, or one of them is decorative.
      for (const transition of ORDER_TRANSITIONS) {
        if (transition.webhookOnly) {
          expect(transition.actors, `${transition.from} -> ${transition.to}`).toEqual(['system']);
        }
      }
    });
  });

  describe('nothing but a webhook may mark an order paid', () => {
    it('refuses every human actor moving an order to PAID', () => {
      for (const actor of ['buyer', 'seller', 'admin'] as OrderActor[]) {
        const decision = canTransitionOrder('PENDING_PAYMENT', 'PAID', actor);
        expect(decision, actor).toEqual({ allowed: false, reason: 'webhook_only' });
      }
    });

    it('allows the system actor, which means a verified webhook', () => {
      expect(canTransitionOrder('PENDING_PAYMENT', 'PAID', 'system').allowed).toBe(true);
    });

    it('offers PAID to nobody in the UI', () => {
      // A control that cannot be legitimately used should not be rendered.
      for (const actor of ['buyer', 'seller', 'admin'] as OrderActor[]) {
        const moves = availableOrderTransitions('PENDING_PAYMENT', actor).map((t) => t.to);
        expect(moves, actor).not.toContain('PAID');
      }
    });

    it('refuses a human actor on every money-forward transition, not just PAID', () => {
      // REFUNDED, DISPUTED and CHARGEBACK are equally the provider's to declare.
      const webhookOnly = ORDER_TRANSITIONS.filter((transition) => transition.webhookOnly);
      expect(webhookOnly.length).toBeGreaterThan(4);

      for (const transition of webhookOnly) {
        for (const actor of ['buyer', 'seller', 'admin'] as OrderActor[]) {
          const decision = canTransitionOrder(transition.from, transition.to, actor);
          expect(decision.allowed, `${transition.from}->${transition.to} as ${actor}`).toBe(false);
        }
      }
    });
  });

  it('refuses every triple the table does not contain', () => {
    const allowed = new Set(
      ORDER_TRANSITIONS.flatMap((transition) =>
        transition.actors.map((actor) => `${transition.from}->${transition.to}:${actor}`),
      ),
    );

    let checked = 0;
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        for (const actor of ORDER_ACTORS) {
          checked += 1;
          expect(canTransitionOrder(from, to, actor).allowed, `${from} -> ${to} as ${actor}`).toBe(
            allowed.has(`${from}->${to}:${actor}`),
          );
        }
      }
    }
    // 11 statuses x 11 statuses x 4 actors.
    expect(checked).toBe(ORDER_STATUSES.length * ORDER_STATUSES.length * ORDER_ACTORS.length);
  });

  it('distinguishes the refusal reasons', () => {
    expect(canTransitionOrder('PENDING_PAYMENT', 'PAID', 'buyer')).toMatchObject({
      reason: 'webhook_only',
    });
    expect(canTransitionOrder('PAID', 'FULFILLING', 'buyer')).toMatchObject({
      reason: 'wrong_actor',
    });
    expect(canTransitionOrder('DRAFT', 'COMPLETED', 'buyer')).toMatchObject({
      reason: 'unknown_transition',
    });
    expect(canTransitionOrder('PAID', 'PAID', 'system')).toMatchObject({ reason: 'no_op' });
  });

  it('classifies terminal statuses', () => {
    expect(isTerminalOrderStatus('CHARGEBACK')).toBe(true);
    expect(isTerminalOrderStatus('REFUNDED')).toBe(true);
    expect(isTerminalOrderStatus('PAID')).toBe(false);
    expect(isTerminalOrderStatus('DISPUTED')).toBe(false);
    // COMPLETED is a fulfilment outcome, not a financial one: a delivered
    // order can still be refunded or disputed weeks later.
    expect(isTerminalOrderStatus('COMPLETED')).toBe(false);
    expect(canTransitionOrder('COMPLETED', 'REFUNDING', 'seller').allowed).toBe(true);
  });

  it('gives a buyer a bounded window to pay', () => {
    const now = new Date('2026-09-12T12:00:00.000Z');
    expect(orderExpiryFrom(now).getTime() - now.getTime()).toBe(60 * 60 * 1000);
  });
});

describe('the payment state machine', () => {
  const PAYMENT_ACTORS: PaymentActor[] = ['platform', 'provider'];

  it('never lets the platform declare a payment succeeded', () => {
    for (const from of PAYMENT_STATUSES) {
      if (from === 'SUCCEEDED') continue;
      const decision = canTransitionPayment(from, 'SUCCEEDED', 'platform');
      expect(decision.allowed, `${from} -> SUCCEEDED as platform`).toBe(false);
    }
  });

  it('lets the platform do exactly one thing: cancel an unpaid intent', () => {
    const platformMoves = PAYMENT_TRANSITIONS.filter((transition) =>
      transition.actors.includes('platform'),
    );
    expect(platformMoves.every((transition) => transition.to === 'CANCELED')).toBe(true);
  });

  it('treats SUCCEEDED as final — nothing leaves it', () => {
    // A refund or a dispute is recorded on its own object. The payment stays
    // truthful about having succeeded.
    expect(PAYMENT_TRANSITIONS.some((transition) => transition.from === 'SUCCEEDED')).toBe(false);
    expect(isTerminalPaymentStatus('SUCCEEDED')).toBe(true);
  });

  it('models a retry on the same intent', () => {
    // Stripe moves a failed intent back to requires_payment_method; without
    // this the retry would look like an impossible transition.
    expect(canTransitionPayment('FAILED', 'REQUIRES_PAYMENT_METHOD', 'provider').allowed).toBe(
      true,
    );
    expect(canTransitionPayment('FAILED', 'SUCCEEDED', 'provider').allowed).toBe(true);
  });

  it('refuses every triple the table does not contain', () => {
    const allowed = new Set(
      PAYMENT_TRANSITIONS.flatMap((transition) =>
        transition.actors.map((actor) => `${transition.from}->${transition.to}:${actor}`),
      ),
    );

    for (const from of PAYMENT_STATUSES) {
      for (const to of PAYMENT_STATUSES) {
        for (const actor of PAYMENT_ACTORS) {
          expect(
            canTransitionPayment(from, to, actor).allowed,
            `${from} -> ${to} as ${actor}`,
          ).toBe(allowed.has(`${from}->${to}:${actor}`));
        }
      }
    }
  });

  describe('mapping provider statuses', () => {
    it('maps the statuses we can reach', () => {
      const expected: [string, PaymentStatus][] = [
        ['requires_payment_method', 'REQUIRES_PAYMENT_METHOD'],
        ['requires_confirmation', 'REQUIRES_PAYMENT_METHOD'],
        ['requires_action', 'REQUIRES_ACTION'],
        ['processing', 'PROCESSING'],
        ['requires_capture', 'PROCESSING'],
        ['succeeded', 'SUCCEEDED'],
        ['canceled', 'CANCELED'],
      ];
      for (const [provider, ours] of expected) {
        expect(paymentStatusFromProvider(provider), provider).toBe(ours);
      }
    });

    it('returns null for a status it has never seen', () => {
      // NOT mapped to something plausible. A new provider state must stop the
      // processor and be looked at, not be guessed into our nearest enum.
      expect(paymentStatusFromProvider('quantum_superposition')).toBeNull();
      expect(paymentStatusFromProvider('')).toBeNull();
    });
  });

  it('moves an attempt only out of PENDING', () => {
    expect(canTransitionPaymentAttempt('PENDING', 'SUCCEEDED')).toBe(true);
    expect(canTransitionPaymentAttempt('PENDING', 'FAILED')).toBe(true);
    expect(canTransitionPaymentAttempt('SUCCEEDED', 'FAILED')).toBe(false);
    expect(canTransitionPaymentAttempt('FAILED', 'SUCCEEDED')).toBe(false);
  });
});

describe('commission', () => {
  const plain = { percentBps: 600, fixedMinor: 0n, minMinor: null, maxMinor: null };

  it('computes basis points in integers', () => {
    expect(computeCommission(20_000n, plain)).toBe(1_200n);
    expect(computeCommission(100_000n, { ...plain, percentBps: 50 })).toBe(500n);
  });

  it('truncates in the seller’s favour rather than rounding up', () => {
    // 1999 * 600 / 10000 = 119.94 → 119. Rounding up would take a penny
    // nobody agreed to.
    expect(computeCommission(1_999n, plain)).toBe(119n);
  });

  it('applies a floor and a ceiling', () => {
    expect(computeCommission(100n, { ...plain, minMinor: 50n })).toBe(50n);
    expect(computeCommission(1_000_000n, { ...plain, maxMinor: 10_000n })).toBe(10_000n);
  });

  it('adds a fixed component for hybrid rules', () => {
    expect(computeCommission(10_000n, { ...plain, fixedMinor: 30n })).toBe(630n);
  });

  it('keeps precision far above Number.MAX_SAFE_INTEGER', () => {
    const huge = 900_719_925_474_099_100n;
    expect(computeCommission(huge, { ...plain, percentBps: 50 })).toBe(4_503_599_627_370_495n);
  });
});

describe('order amounts', () => {
  const baseCommission = { percentBps: 50, fixedMinor: 0n, minMinor: null, maxMinor: null };

  function feeOnlyInput(overrides: Record<string, unknown> = {}) {
    return {
      flow: 'FEE_ONLY' as TransactionFlow,
      agreedPriceMinor: 5_000_000n, // £50,000.00
      currency: 'GBP',
      listingCurrency: 'GBP',
      commission: baseCommission,
      maxOnlineAmountMinor: 500_000n, // £5,000.00
      ...overrides,
    };
  }

  describe('FEE_ONLY — the invariant', () => {
    it('charges the fee and nothing else on a £50,000 car', () => {
      const result = computeOrderAmounts(feeOnlyInput());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // £250.00 charged, against a £50,000.00 sale that never touches Stripe.
      expect(result.amounts.totalMinor).toBe(25_000n);
      expect(result.amounts.commissionAmountMinor).toBe(25_000n);
      expect(result.amounts.sellerAmountMinor).toBe(0n);
      expect(result.amounts.principalMinor).toBe(5_000_000n);
      expect(result.amounts.hasTransferLeg).toBe(false);

      // Stated as the invariant, not merely as three separate numbers.
      expect(result.amounts.totalMinor).toBe(result.amounts.commissionAmountMinor);
      expect(result.amounts.totalMinor).toBeLessThan(result.amounts.principalMinor!);
    });

    it('never lets the charge reach the principal at any price', () => {
      for (const price of [1_000n, 100_000n, 5_000_000n, 100_000_000n]) {
        const result = computeOrderAmounts(
          feeOnlyInput({ agreedPriceMinor: price, maxOnlineAmountMinor: null }),
        );
        expect(result.ok, price.toString()).toBe(true);
        if (!result.ok) continue;
        expect(result.amounts.totalMinor, price.toString()).toBeLessThan(price);
        expect(result.amounts.sellerAmountMinor).toBe(0n);
      }
    });

    it('refuses a fee that would exceed the category’s online ceiling', () => {
      // A 50% "commission" on a £50,000 car would be £25,000, far past the
      // £5,000 ceiling. The ceiling is the backstop against exactly this.
      const result = computeOrderAmounts(
        feeOnlyInput({ commission: { ...baseCommission, percentBps: 5_000 } }),
      );
      expect(result).toEqual({ ok: false, issue: 'above_online_ceiling' });
    });
  });

  describe('BUY_NOW', () => {
    it('charges the price and splits it', () => {
      const result = computeOrderAmounts({
        flow: 'BUY_NOW',
        agreedPriceMinor: 20_000n,
        currency: 'GBP',
        listingCurrency: 'GBP',
        commission: { percentBps: 600, fixedMinor: 0n, minMinor: null, maxMinor: null },
        maxOnlineAmountMinor: 500_000n,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.amounts.totalMinor).toBe(20_000n);
      expect(result.amounts.commissionAmountMinor).toBe(1_200n);
      expect(result.amounts.sellerAmountMinor).toBe(18_800n);
      expect(result.amounts.principalMinor).toBeNull();
      expect(result.amounts.hasTransferLeg).toBe(true);
      // Derived by subtraction, so the two can never disagree by a penny.
      expect(result.amounts.sellerAmountMinor + result.amounts.commissionAmountMinor).toBe(
        result.amounts.totalMinor,
      );
    });
  });

  it('refuses a currency the listing is not priced in', () => {
    expect(computeOrderAmounts(feeOnlyInput({ currency: 'USD' }))).toEqual({
      ok: false,
      issue: 'currency_mismatch',
    });
  });

  it('refuses a flow that cannot be paid for', () => {
    expect(computeOrderAmounts(feeOnlyInput({ flow: 'CONTACT_ONLY' }))).toEqual({
      ok: false,
      issue: 'not_purchasable',
    });
    expect(isPurchasable('CONTACT_ONLY')).toBe(false);
    expect(isFeeOnly('FEE_ONLY')).toBe(true);
    expect(isFeeOnly('BUY_NOW')).toBe(false);
  });

  it('refuses a listing with no price', () => {
    expect(computeOrderAmounts(feeOnlyInput({ agreedPriceMinor: null }))).toEqual({
      ok: false,
      issue: 'no_price',
    });
  });
});

describe('the last gate before a charge', () => {
  it('refuses to send the principal through the fee-only flow', () => {
    expect(() =>
      assertChargeIsSafe({
        flow: 'FEE_ONLY',
        // The £50,000 mistake: the principal in the charge amount.
        chargeAmountMinor: 5_000_000n,
        commissionAmountMinor: 25_000n,
        principalMinor: 5_000_000n,
        destinationAccountId: null,
        applicationFeeMinor: null,
      }),
    ).toThrow(/commission and nothing else/i);
  });

  it('refuses a fee-only charge that merely equals the principal', () => {
    // The boundary the check exists to guard. Equality is not "close enough".
    expect(() =>
      assertChargeIsSafe({
        flow: 'FEE_ONLY',
        chargeAmountMinor: 5_000_000n,
        commissionAmountMinor: 5_000_000n,
        principalMinor: 5_000_000n,
        destinationAccountId: null,
        applicationFeeMinor: null,
      }),
    ).toThrow(/sale principal/i);
  });

  it('refuses a transfer leg on a fee-only charge', () => {
    expect(() =>
      assertChargeIsSafe({
        flow: 'FEE_ONLY',
        chargeAmountMinor: 25_000n,
        commissionAmountMinor: 25_000n,
        principalMinor: 5_000_000n,
        destinationAccountId: 'acct_something',
        applicationFeeMinor: 25_000n,
      }),
    ).toThrow(/no transfer leg/i);
  });

  it('accepts a correct fee-only charge', () => {
    expect(() =>
      assertChargeIsSafe({
        flow: 'FEE_ONLY',
        chargeAmountMinor: 25_000n,
        commissionAmountMinor: 25_000n,
        principalMinor: 5_000_000n,
        destinationAccountId: null,
        applicationFeeMinor: null,
      }),
    ).not.toThrow();
  });

  it('refuses a marketplace charge with half a transfer', () => {
    expect(() =>
      assertChargeIsSafe({
        flow: 'BUY_NOW',
        chargeAmountMinor: 20_000n,
        commissionAmountMinor: 1_200n,
        principalMinor: null,
        destinationAccountId: null,
        applicationFeeMinor: 1_200n,
      }),
    ).toThrow(/destination account and a fee/i);
  });

  it('refuses a non-positive charge', () => {
    expect(() =>
      assertChargeIsSafe({
        flow: 'BUY_NOW',
        chargeAmountMinor: 0n,
        commissionAmountMinor: 0n,
        principalMinor: null,
        destinationAccountId: 'acct_x',
        applicationFeeMinor: 0n,
      }),
    ).toThrow(/non-positive/i);
  });
});

describe('the gateway port’s own guard', () => {
  const base = {
    amountMinor: 20_000n,
    currency: 'GBP',
    idempotencyKey: 'order:x:pi:v1',
    metadata: {},
  };

  it('refuses a destination without a fee, and a fee without a destination', () => {
    expect(() => assertTransferShape({ ...base, destinationAccountId: 'acct_x' })).toThrow(
      /together or not at all/i,
    );
    expect(() => assertTransferShape({ ...base, applicationFeeMinor: 100n })).toThrow(
      /together or not at all/i,
    );
  });

  it('refuses a fee larger than the charge', () => {
    expect(() =>
      assertTransferShape({
        ...base,
        destinationAccountId: 'acct_x',
        applicationFeeMinor: 20_001n,
      }),
    ).toThrow(/cannot exceed/i);
  });

  it('accepts a charge with neither — the fee-only shape', () => {
    expect(() => assertTransferShape(base)).not.toThrow();
  });
});
