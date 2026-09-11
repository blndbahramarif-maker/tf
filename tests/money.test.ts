import { describe, expect, it } from 'vitest';
import {
  addMoney,
  applyBasisPoints,
  clampMinor,
  CurrencyMismatchError,
  formatMinorAsDecimal,
  fromWire,
  minorUnitDigits,
  money,
  parseDecimalToMinor,
  subtractMoney,
  toWire,
} from '@/shared/money';

describe('applyBasisPoints', () => {
  it('computes 0.5% of £50,000 as £250', () => {
    // The worked example from the brief.
    expect(applyBasisPoints(5_000_000n, 50)).toBe(25_000n);
  });

  it('computes 6% of £200 as £12', () => {
    expect(applyBasisPoints(20_000n, 600)).toBe(1_200n);
  });

  it('rounds down, never up', () => {
    // 7% of £1.99 is 13.93p. Flooring favours the counterparty by <1 penny,
    // consistently — consistency is what keeps totals reconcilable.
    expect(applyBasisPoints(199n, 700)).toBe(13n);
  });

  it('handles 100% and 0%', () => {
    expect(applyBasisPoints(12_345n, 10_000)).toBe(12_345n);
    expect(applyBasisPoints(12_345n, 0)).toBe(0n);
  });

  it('stays exact far beyond JavaScript number precision', () => {
    // 2^53 + 1 minor units. A float-based implementation loses this.
    const huge = 9_007_199_254_740_993n;
    expect(applyBasisPoints(huge, 10_000)).toBe(huge);
  });

  it('rejects fractional basis points', () => {
    expect(() => applyBasisPoints(1000n, 12.5)).toThrow(TypeError);
  });

  it('rejects negative basis points', () => {
    expect(() => applyBasisPoints(1000n, -1)).toThrow(RangeError);
  });
});

describe('commission derivation', () => {
  it('derives the seller amount by subtraction so the two cannot disagree', () => {
    const total = 5_000_000n;
    const commission = applyBasisPoints(total, 50);
    const seller = total - commission;

    expect(commission).toBe(25_000n);
    expect(seller).toBe(4_975_000n);
    expect(commission + seller).toBe(total);
  });

  it('never leaves a rounding remainder unaccounted for', () => {
    // Every amount from 1p to £10 at an awkward rate must still partition
    // exactly. If any case leaked a penny, this fails.
    for (let amount = 1n; amount <= 1000n; amount += 1n) {
      const commission = applyBasisPoints(amount, 733);
      expect(commission + (amount - commission)).toBe(amount);
      expect(commission).toBeLessThanOrEqual(amount);
    }
  });
});

describe('clampMinor', () => {
  it('applies a minimum commission', () => {
    // 6% of a £5 order is 30p, below the 50p floor that stops the fixed card
    // fee eating small orders.
    expect(clampMinor(applyBasisPoints(500n, 600), 50n, null)).toBe(50n);
  });

  it('applies a maximum', () => {
    expect(clampMinor(10_000n, null, 5_000n)).toBe(5_000n);
  });

  it('leaves values inside the range untouched', () => {
    expect(clampMinor(750n, 50n, 5_000n)).toBe(750n);
  });
});

describe('currency handling', () => {
  it('knows currencies with other than two minor digits', () => {
    expect(minorUnitDigits('GBP')).toBe(2);
    expect(minorUnitDigits('JPY')).toBe(0);
    expect(minorUnitDigits('KWD')).toBe(3);
  });

  it('refuses to add different currencies', () => {
    expect(() => addMoney(money(100n, 'GBP'), money(100n, 'EUR'))).toThrow(CurrencyMismatchError);
  });

  it('adds and subtracts within one currency', () => {
    expect(addMoney(money(100n, 'GBP'), money(50n, 'GBP')).amountMinor).toBe(150n);
    expect(subtractMoney(money(100n, 'GBP'), money(50n, 'GBP')).amountMinor).toBe(50n);
  });

  it('normalises the currency code', () => {
    expect(money(100n, 'gbp').currency).toBe('GBP');
  });
});

describe('parseDecimalToMinor', () => {
  it('parses without floating point', () => {
    expect(parseDecimalToMinor('50000.00', 'GBP')).toBe(5_000_000n);
    // 0.1 + 0.2 territory: a float parser gets this wrong.
    expect(parseDecimalToMinor('0.29', 'GBP')).toBe(29n);
    expect(parseDecimalToMinor('1.10', 'GBP')).toBe(110n);
  });

  it('honours per-currency precision', () => {
    expect(parseDecimalToMinor('1000', 'JPY')).toBe(1000n);
    expect(parseDecimalToMinor('1.234', 'KWD')).toBe(1234n);
  });

  it('rejects more precision than the currency allows', () => {
    expect(() => parseDecimalToMinor('1.234', 'GBP')).toThrow(RangeError);
  });

  it('rejects nonsense', () => {
    expect(() => parseDecimalToMinor('fifty', 'GBP')).toThrow(TypeError);
    expect(() => parseDecimalToMinor('1.2.3', 'GBP')).toThrow(TypeError);
  });

  it('handles negatives, for refunds', () => {
    expect(parseDecimalToMinor('-12.50', 'GBP')).toBe(-1250n);
  });
});

describe('formatMinorAsDecimal', () => {
  it('renders minor units back to a decimal string', () => {
    expect(formatMinorAsDecimal(5_000_000n, 'GBP')).toBe('50000.00');
    expect(formatMinorAsDecimal(5n, 'GBP')).toBe('0.05');
    expect(formatMinorAsDecimal(0n, 'GBP')).toBe('0.00');
    expect(formatMinorAsDecimal(-1250n, 'GBP')).toBe('-12.50');
    expect(formatMinorAsDecimal(1000n, 'JPY')).toBe('1000');
  });

  it('round-trips with the parser', () => {
    for (const value of ['0.00', '0.01', '99.99', '50000.00', '-12.34']) {
      expect(formatMinorAsDecimal(parseDecimalToMinor(value, 'GBP'), 'GBP')).toBe(value);
    }
  });
});

describe('wire format', () => {
  it('sends amounts as strings and reads them back exactly', () => {
    const original = money(9_007_199_254_740_993n, 'GBP');
    const wire = toWire(original);
    expect(wire.amountMinor).toBe('9007199254740993');
    expect(fromWire(wire).amountMinor).toBe(original.amountMinor);
  });

  it('rejects a decimal string from the wire', () => {
    expect(() => fromWire({ amountMinor: '50.00', currency: 'GBP' })).toThrow(TypeError);
  });
});
