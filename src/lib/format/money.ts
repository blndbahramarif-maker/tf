import { formatMinorAsDecimal, type CurrencyCode } from '@/shared/money';

/**
 * Locale-aware money formatting.
 *
 * The amount reaches `Intl` as an exact DECIMAL STRING produced from the
 * bigint minor units, never as a `Number`. Converting through a float would
 * silently lose precision above 2^53 minor units — a £100,000,000 listing is
 * not hypothetical in the business category — and rounding money by accident
 * is exactly what ADR-0006 forbids.
 *
 * `Intl.NumberFormat#format` has accepted string input since ES2023 and
 * formats it exactly. TypeScript's bundled lib types still describe only
 * `number | bigint`, hence the narrow cast here rather than at every call site.
 */
type StringFormattable = { format(value: string): string };

export function formatMoney(amountMinor: bigint, currency: CurrencyCode, locale: string): string {
  const decimal = formatMinorAsDecimal(amountMinor, currency);
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    // Latin digits for money in every locale: digit ambiguity is the one place
    // where being clever costs real trust (packages/i18n numberingSystem).
    numberingSystem: 'latn',
  }) as unknown as StringFormattable;
  return formatter.format(decimal);
}

export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { numberingSystem: 'latn' }).format(value);
}

export function formatDate(value: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: 'UTC',
    numberingSystem: 'latn',
  }).format(value);
}
