import { describe, expect, it } from 'vitest';
import {
  assertBalanced,
  buildEntryGroup,
  isBalanced,
  LedgerImbalanceError,
  netByCurrency,
  signedAmount,
  type LedgerEntryDraft,
} from '@/domain/ledger/entry-group';
import {
  feeOnlyPaid,
  orderPaid,
  payoutSettled,
  recordPaymentFee,
  refundIssued,
} from '@/domain/ledger/postings';

const GROUP = '00000000-0000-7000-8000-000000000abc';
const AT = new Date('2026-09-11T12:00:00.000Z');

const entry = (over: Partial<LedgerEntryDraft>): LedgerEntryDraft => ({
  account: 'STRIPE_BALANCE',
  direction: 'DEBIT',
  amountMinor: 1000n,
  currency: 'GBP',
  description: 'test',
  ...over,
});

describe('zero-sum invariant', () => {
  it('treats DEBIT as positive and CREDIT as negative', () => {
    expect(signedAmount(entry({ direction: 'DEBIT' }))).toBe(1000n);
    expect(signedAmount(entry({ direction: 'CREDIT' }))).toBe(-1000n);
  });

  it('accepts a balanced group', () => {
    const entries = [
      entry({ direction: 'DEBIT', amountMinor: 10_000n }),
      entry({ account: 'SELLER_PAYABLE', direction: 'CREDIT', amountMinor: 9_400n }),
      entry({ account: 'PLATFORM_REVENUE', direction: 'CREDIT', amountMinor: 600n }),
    ];
    expect(isBalanced(entries)).toBe(true);
    expect(() => assertBalanced(entries)).not.toThrow();
  });

  it('rejects a group that is out by a single penny', () => {
    // One penny is the whole point: large errors get noticed, small ones do not.
    const entries = [
      entry({ direction: 'DEBIT', amountMinor: 10_000n }),
      entry({ account: 'SELLER_PAYABLE', direction: 'CREDIT', amountMinor: 9_400n }),
      entry({ account: 'PLATFORM_REVENUE', direction: 'CREDIT', amountMinor: 599n }),
    ];
    expect(isBalanced(entries)).toBe(false);
    expect(() => assertBalanced(entries)).toThrow(LedgerImbalanceError);
  });

  it('balances each currency SEPARATELY', () => {
    // +100 GBP and -100 EUR is not balanced. Netting across currencies would
    // silently invent an exchange rate.
    const entries = [
      entry({ direction: 'DEBIT', amountMinor: 10_000n, currency: 'GBP' }),
      entry({
        account: 'SELLER_PAYABLE',
        direction: 'CREDIT',
        amountMinor: 10_000n,
        currency: 'EUR',
      }),
    ];
    expect(isBalanced(entries)).toBe(false);
    expect(netByCurrency(entries).get('GBP')).toBe(10_000n);
    expect(netByCurrency(entries).get('EUR')).toBe(-10_000n);
  });

  it('accepts a multi-currency group where every currency balances', () => {
    const entries = [
      entry({ direction: 'DEBIT', amountMinor: 10_000n, currency: 'GBP' }),
      entry({
        account: 'SELLER_PAYABLE',
        direction: 'CREDIT',
        amountMinor: 10_000n,
        currency: 'GBP',
      }),
      entry({ direction: 'DEBIT', amountMinor: 5_000n, currency: 'EUR' }),
      entry({
        account: 'SELLER_PAYABLE',
        direction: 'CREDIT',
        amountMinor: 5_000n,
        currency: 'EUR',
      }),
    ];
    expect(isBalanced(entries)).toBe(true);
  });

  it('rejects an empty group', () => {
    expect(() => assertBalanced([])).toThrow(LedgerImbalanceError);
  });

  it('names the currency and the net in the error, so it is debuggable', () => {
    try {
      assertBalanced([entry({ direction: 'DEBIT', amountMinor: 500n })]);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(LedgerImbalanceError);
      expect((error as LedgerImbalanceError).currency).toBe('GBP');
      expect((error as LedgerImbalanceError).netMinor).toBe(500n);
    }
  });
});

describe('buildEntryGroup validation', () => {
  const base = { entryGroupId: GROUP, occurredAt: AT, livemode: false };

  it('rejects a non-positive amount, because direction carries the sign', () => {
    expect(() =>
      buildEntryGroup({
        ...base,
        entries: [entry({ amountMinor: 0n }), entry({ direction: 'CREDIT', amountMinor: 0n })],
      }),
    ).toThrow(RangeError);

    expect(() => buildEntryGroup({ ...base, entries: [entry({ amountMinor: -100n })] })).toThrow(
      RangeError,
    );
  });

  it('rejects a malformed currency code', () => {
    expect(() => buildEntryGroup({ ...base, entries: [entry({ currency: 'gbp' })] })).toThrow(
      TypeError,
    );
    expect(() => buildEntryGroup({ ...base, entries: [entry({ currency: 'POUND' })] })).toThrow(
      TypeError,
    );
  });
});

describe('posting recipes', () => {
  const common = { occurredAt: AT, livemode: false, currency: 'GBP' };

  it('orderPaid balances and splits total into seller share and commission', () => {
    const group = orderPaid({
      ...common,
      entryGroupId: GROUP,
      orderId: 'order-1',
      sellerProfileId: 'seller-1',
      totalMinor: 20_000n,
      commissionMinor: 1_200n,
    });

    expect(isBalanced(group.entries)).toBe(true);
    const byAccount = Object.fromEntries(group.entries.map((e) => [e.account, e]));
    expect(byAccount.STRIPE_BALANCE?.amountMinor).toBe(20_000n);
    expect(byAccount.SELLER_PAYABLE?.amountMinor).toBe(18_800n);
    expect(byAccount.PLATFORM_REVENUE?.amountMinor).toBe(1_200n);
  });

  it('orderPaid omits zero legs rather than posting a zero entry', () => {
    const group = orderPaid({
      ...common,
      entryGroupId: GROUP,
      orderId: 'order-1',
      sellerProfileId: 'seller-1',
      totalMinor: 20_000n,
      commissionMinor: 0n,
    });
    expect(group.entries).toHaveLength(2);
    expect(group.entries.some((e) => e.account === 'PLATFORM_REVENUE')).toBe(false);
    expect(isBalanced(group.entries)).toBe(true);
  });

  it('orderPaid refuses commission larger than the order', () => {
    expect(() =>
      orderPaid({
        ...common,
        entryGroupId: GROUP,
        orderId: 'order-1',
        sellerProfileId: 'seller-1',
        totalMinor: 1_000n,
        commissionMinor: 1_001n,
      }),
    ).toThrow(RangeError);
  });

  it('feeOnlyPaid creates NO seller-payable leg', () => {
    // The defining property of the fee-only design: we never hold the
    // principal, so we never owe it. £50,000 sale, £250 fee (ADR-0007).
    const group = feeOnlyPaid({
      ...common,
      entryGroupId: GROUP,
      orderId: 'order-2',
      sellerProfileId: 'seller-1',
      feeMinor: 25_000n,
    });

    expect(isBalanced(group.entries)).toBe(true);
    expect(group.entries.some((e) => e.account === 'SELLER_PAYABLE')).toBe(false);
    expect(group.entries).toHaveLength(2);
    expect(group.entries.find((e) => e.account === 'PLATFORM_REVENUE')?.amountMinor).toBe(25_000n);
  });

  it('recordPaymentFee books the provider fee as an expense', () => {
    const group = recordPaymentFee({
      ...common,
      entryGroupId: GROUP,
      orderId: 'order-1',
      feeMinor: 320n,
    });
    expect(isBalanced(group.entries)).toBe(true);
    expect(group.entries.find((e) => e.account === 'PAYMENT_FEES')?.direction).toBe('DEBIT');
    expect(group.entries.find((e) => e.account === 'STRIPE_BALANCE')?.direction).toBe('CREDIT');
  });

  it('payoutSettled discharges the seller liability', () => {
    const group = payoutSettled({
      ...common,
      entryGroupId: GROUP,
      payoutId: 'payout-1',
      sellerProfileId: 'seller-1',
      amountMinor: 18_800n,
    });
    expect(isBalanced(group.entries)).toBe(true);
    expect(group.entries.find((e) => e.account === 'SELLER_PAYABLE')?.direction).toBe('DEBIT');
  });

  it('refundIssued moves cash exactly once', () => {
    // A £100 refund takes £100 out of the balance, not £200. The debits
    // partition WHO bore that cost.
    const group = refundIssued({
      ...common,
      entryGroupId: GROUP,
      orderId: 'order-1',
      refundId: 'refund-1',
      sellerProfileId: 'seller-1',
      amountMinor: 10_000n,
      sellerClawbackMinor: 9_400n,
      commissionReturnedMinor: 600n,
    });

    expect(isBalanced(group.entries)).toBe(true);
    const cash = group.entries.find((e) => e.account === 'STRIPE_BALANCE');
    expect(cash?.direction).toBe('CREDIT');
    expect(cash?.amountMinor).toBe(10_000n);
    // Fully recovered, so the platform absorbs nothing.
    expect(group.entries.some((e) => e.account === 'REFUNDS')).toBe(false);
  });

  it('refundIssued books the platform-absorbed portion when nothing is recovered', () => {
    // Stripe's DEFAULT: the seller keeps the money and we absorb the refund.
    const group = refundIssued({
      ...common,
      entryGroupId: GROUP,
      orderId: 'order-1',
      refundId: 'refund-1',
      sellerProfileId: 'seller-1',
      amountMinor: 10_000n,
      sellerClawbackMinor: 0n,
      commissionReturnedMinor: 0n,
    });

    expect(isBalanced(group.entries)).toBe(true);
    expect(group.entries.find((e) => e.account === 'REFUNDS')?.amountMinor).toBe(10_000n);
  });

  it('refundIssued splits a partial recovery correctly', () => {
    const group = refundIssued({
      ...common,
      entryGroupId: GROUP,
      orderId: 'order-1',
      refundId: 'refund-1',
      sellerProfileId: 'seller-1',
      amountMinor: 10_000n,
      sellerClawbackMinor: 6_000n,
      commissionReturnedMinor: 600n,
    });

    expect(isBalanced(group.entries)).toBe(true);
    expect(group.entries.find((e) => e.account === 'REFUNDS')?.amountMinor).toBe(3_400n);
  });

  it('refundIssued refuses to recover more than was refunded', () => {
    expect(() =>
      refundIssued({
        ...common,
        entryGroupId: GROUP,
        orderId: 'order-1',
        refundId: 'refund-1',
        sellerProfileId: 'seller-1',
        amountMinor: 10_000n,
        sellerClawbackMinor: 9_400n,
        commissionReturnedMinor: 1_000n,
      }),
    ).toThrow(RangeError);
  });

  it('every recipe produces a balanced group across a range of amounts', () => {
    // Property check: whatever the amounts, the books balance.
    for (let total = 1n; total <= 500n; total += 7n) {
      const commission = (total * 600n) / 10_000n;
      expect(
        isBalanced(
          orderPaid({
            ...common,
            entryGroupId: GROUP,
            orderId: 'o',
            sellerProfileId: 's',
            totalMinor: total,
            commissionMinor: commission,
          }).entries,
        ),
      ).toBe(true);
    }
  });
});
