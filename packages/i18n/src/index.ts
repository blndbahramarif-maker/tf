/**
 * Locale registry — the single source of truth for languages and direction.
 *
 * Adding a language must require only: a new entry here plus a message
 * catalogue file. No component may branch on a locale code.
 *
 * Note that Kurdish is two distinct locales, not one:
 *   ckb — Sorani / Central Kurdish, written in Arabic script, RIGHT-TO-LEFT
 *   kmr — Kurmanji / Northern Kurdish, written in Latin script, LEFT-TO-RIGHT
 * They are not mutually intelligible in writing. Treating "Kurdish" as a single
 * locale is a product failure, not just a technical one. See docs/09-i18n-rtl.md.
 */

export type Direction = 'ltr' | 'rtl';

export interface LocaleDefinition {
  /** BCP-47 code, also the URL segment. */
  readonly code: string;
  /** English name, for admin UI and documentation. */
  readonly name: string;
  /** Endonym — how speakers write the language's name themselves. */
  readonly nativeName: string;
  readonly direction: Direction;
  /** ISO 15924 script code. */
  readonly script: 'Latn' | 'Arab';
  /**
   * Unicode numbering system used for formatting.
   * Prices use Latin digits in every locale by default: money is the one place
   * where digit ambiguity is genuinely costly. Configurable per locale.
   */
  readonly numberingSystem: 'latn' | 'arab';
  /**
   * Whether the locale is selectable by users right now.
   * Launch is English + Sorani (docs/12-decisions-log.md, DL-4); Kurmanji and
   * Arabic are defined and routable but disabled until their catalogues have
   * been reviewed by native speakers.
   */
  readonly enabled: boolean;
}

export const LOCALES = {
  en: {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    direction: 'ltr',
    script: 'Latn',
    numberingSystem: 'latn',
    enabled: true,
  },
  ckb: {
    code: 'ckb',
    name: 'Kurdish (Sorani)',
    nativeName: 'کوردیی ناوەندی',
    direction: 'rtl',
    script: 'Arab',
    numberingSystem: 'latn',
    enabled: true,
  },
  kmr: {
    code: 'kmr',
    name: 'Kurdish (Kurmanji)',
    nativeName: 'Kurmancî',
    direction: 'ltr',
    script: 'Latn',
    numberingSystem: 'latn',
    enabled: false,
  },
  ar: {
    code: 'ar',
    name: 'Arabic',
    nativeName: 'العربية',
    direction: 'rtl',
    script: 'Arab',
    numberingSystem: 'latn',
    enabled: false,
  },
} as const satisfies Record<string, LocaleDefinition>;

export type Locale = keyof typeof LOCALES;

export const DEFAULT_LOCALE: Locale = 'en';

/** Every locale the router knows about, enabled or not. */
export const ALL_LOCALES = Object.keys(LOCALES) as Locale[];

/** Locales a user may currently select. */
export const ENABLED_LOCALES = ALL_LOCALES.filter((code) => LOCALES[code].enabled);

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LOCALES, value);
}

export function isEnabledLocale(value: unknown): value is Locale {
  return isLocale(value) && LOCALES[value].enabled;
}

export function getDirection(locale: Locale): Direction {
  return LOCALES[locale].direction;
}

export function getLocale(locale: Locale): LocaleDefinition {
  return LOCALES[locale];
}

/**
 * Best-effort match of an Accept-Language header against enabled locales.
 * The URL always wins over this; it is only used to choose an initial redirect.
 */
export function matchLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      const quality = q ? Number.parseFloat(q.split('=')[1] ?? '1') : 1;
      return { tag: tag.trim().toLowerCase(), quality: Number.isNaN(quality) ? 0 : quality };
    })
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of ranked) {
    const exact = ENABLED_LOCALES.find((code) => code.toLowerCase() === tag);
    if (exact) return exact;
    // "ckb-IQ" → "ckb"
    const base = tag.split('-')[0];
    const partial = ENABLED_LOCALES.find((code) => code.toLowerCase() === base);
    if (partial) return partial;
  }

  return DEFAULT_LOCALE;
}
