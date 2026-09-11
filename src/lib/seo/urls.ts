import type { Metadata } from 'next';
import { ALL_LOCALES, DEFAULT_LOCALE, ENABLED_LOCALES } from '@kurdora/i18n';
import { brand } from '@kurdora/brand';

/**
 * Canonical and alternate URLs.
 *
 * Every locale carries a prefix, including the default, so `hreflang` is a
 * direct mapping rather than a special case for one language (ADR-0005,
 * docs/09-i18n-rtl.md).
 *
 * Only ENABLED locales are advertised to crawlers. Kurmanji and Arabic remain
 * routable so existing links resolve, but pointing `hreflang` at a catalogue
 * no native speaker has reviewed would put untrusted translations into search
 * results — a correctness problem, not only a quality one.
 */

export function siteOrigin(): string {
  return `https://${brand.domains.primary}`;
}

/** `path` is locale-prefixed and absolute, e.g. `/en/c/cars`. */
export function canonicalUrl(path: string): string {
  return new URL(path, siteOrigin()).toString();
}

/**
 * Builds `alternates` for a page.
 *
 * `pathWithinLocale` excludes the locale segment: pass `/c/cars`, not
 * `/en/c/cars`, and every language variant is generated from it.
 */
export function alternatesFor(
  pathWithinLocale: string,
  currentLocale?: string,
): Metadata['alternates'] {
  const normalised = pathWithinLocale === '/' ? '' : pathWithinLocale;

  const languages: Record<string, string> = {};
  for (const locale of ENABLED_LOCALES) {
    languages[locale] = `/${locale}${normalised}`;
  }
  // x-default points at the language a crawler should show when none of the
  // alternates match the reader.
  languages['x-default'] = `/${DEFAULT_LOCALE}${normalised}`;

  return {
    canonical: `/${currentLocale ?? DEFAULT_LOCALE}${normalised}`,
    languages,
  };
}

/** Every routable locale, for sitemap alternate entries. */
export function sitemapAlternates(pathWithinLocale: string): Record<string, string> {
  const normalised = pathWithinLocale === '/' ? '' : pathWithinLocale;
  return Object.fromEntries(
    ENABLED_LOCALES.map((locale) => [locale, canonicalUrl(`/${locale}${normalised}`)]),
  );
}

export { ALL_LOCALES, ENABLED_LOCALES };
