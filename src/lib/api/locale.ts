import { DEFAULT_LOCALE, isLocale, type Locale } from '@kurdora/i18n';

/**
 * Resolves the response language for an API request.
 *
 * API routes are NOT locale-prefixed (ADR-0004): clients negotiate with
 * `Accept-Language`, and `?locale=` overrides it for links and previews.
 * Unknown values fall back rather than erroring — a bad header should not
 * fail a request.
 */
export function resolveLocale(request: Request): Locale {
  const url = new URL(request.url);
  const explicit = url.searchParams.get('locale');
  if (isLocale(explicit)) return explicit;

  const header = request.headers.get('accept-language');
  if (!header) return DEFAULT_LOCALE;

  for (const part of header.split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase() ?? '';
    if (isLocale(tag)) return tag;
    const base = tag.split('-')[0] ?? '';
    if (isLocale(base)) return base;
  }

  return DEFAULT_LOCALE;
}
