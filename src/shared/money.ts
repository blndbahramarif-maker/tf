/**
 * Money arithmetic.
 *
 * Amounts are ALWAYS integer minor units held in `bigint`. £50,000.00 is
 * 5_000_000n. Rates are ALWAYS integer basis points: 0.5% is 50.
 *
 * There is no floating point anywhere in this file, and there must never be.
 * A penny of drift in commission is unrecoverable trust damage and, in an
 * audit, a finding. See ADR-0006.
 */

export type CurrencyCode = string;

export interface Money {
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
}

/** Basis points. 10_000 bps = 100%. */
export const BPS_DENOMINATOR = 10_000n;

/**
 * Digits in each currency's minor unit.
 *
 * "Minor units" is ambiguous outside the two-digit currencies: JPY has none,
 * KWD has three. The `currencies` table is authoritative at runtime; this map
 * exists so pure formatting code does not need a database round trip.
 */
const MINOR_UNIT_DIGITS: Readonly<Record<string, number>> = {
  GBP: 2,
  EUR: 2,
  USD: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  CHF: 2,
  PLN: 2,
  JPY: 0,
  KWD: 3,
};

export function minorUnitDigits(currency: CurrencyCode): number {
  return MINOR_UNIT_DIGITS[currency.toUpperCase()] ?? 2;
}

export function money(amountMinor: bigint, currency: CurrencyCode): Money {
  return { amountMinor, currency: currency.toUpperCase() };
}

export class CurrencyMismatchError extends Error {
  constructor(left: CurrencyCode, right: CurrencyCode) {
    super(
      `Cannot combine amounts in different currencies: ${left} and ${right}. ` +
        `Convert explicitly with a recorded rate instead.`,
    );
    this.name = 'CurrencyMismatchError';
  }
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

/**
 * Applies a basis-point rate, rounding DOWN (toward zero for positives).
 *
 * Flooring means rounding consistently favours the counterparty by at most one
 * minor unit. Consistency matters more than direction: an inconsistent rule is
 * what makes totals irreconcilable.
 */
export function applyBasisPoints(amountMinor: bigint, bps: number): bigint {
  if (!Number.isInteger(bps)) {
    throw new TypeError(`Basis points must be an integer, received ${bps}`);
  }
  if (bps < 0) {
    throw new RangeError(`Basis points must not be negative, received ${bps}`);
  }
  return (amountMinor * BigInt(bps)) / BPS_DENOMINATOR;
}

export function clampMinor(value: bigint, min: bigint | null, max: bigint | null): bigint {
  let result = value;
  if (min !== null && result < min) result = min;
  if (max !== null && result > max) result = max;
  return result;
}

/**
 * Parses a decimal string ("50000.00") into minor units WITHOUT floating point.
 *
 * Used only at trust boundaries — admin input, CSV import, provider payloads
 * that report decimals. Never in the middle of a calculation.
 */
export function parseDecimalToMinor(input: string, currency: CurrencyCode): bigint {
  const digits = minorUnitDigits(currency);
  const trimmed = input.trim();

  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new TypeError(`"${input}" is not a valid decimal amount`);
  }

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = '0', fraction = ''] = unsigned.split('.');

  if (fraction.length > digits) {
    throw new RangeError(
      `"${input}" has more precision than ${currency} supports (${digits} minor digits)`,
    );
  }

  const padded = fraction.padEnd(digits, '0');
  const magnitude = BigInt(whole + padded);
  return negative ? -magnitude : magnitude;
}

/** Renders minor units as a plain decimal string. No locale formatting. */
export function formatMinorAsDecimal(amountMinor: bigint, currency: CurrencyCode): string {
  const digits = minorUnitDigits(currency);
  if (digits === 0) return amountMinor.toString();

  const negative = amountMinor < 0n;
  const magnitude = (negative ? -amountMinor : amountMinor).toString().padStart(digits + 1, '0');
  const whole = magnitude.slice(0, -digits);
  const fraction = magnitude.slice(-digits);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** Serialises for the wire, where amounts are strings (ADR-0004). */
export function toWire(value: Money): { amountMinor: string; currency: string } {
  return { amountMinor: value.amountMinor.toString(), currency: value.currency };
}

export function fromWire(value: { amountMinor: string; currency: string }): Money {
  if (!/^-?\d+$/.test(value.amountMinor)) {
    throw new TypeError(`"${value.amountMinor}" is not an integer minor-unit string`);
  }
  return money(BigInt(value.amountMinor), value.currency);
}
