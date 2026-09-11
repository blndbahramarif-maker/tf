import { defineRouting } from 'next-intl/routing';
import { ALL_LOCALES, DEFAULT_LOCALE } from '@kurdora/i18n';

/**
 * Every locale carries a URL prefix, including the default.
 *
 * `/en/cars` rather than `/cars` is unambiguous for crawlers, makes hreflang
 * trivial, and means a shared link always renders in the language it was
 * shared in. See docs/09-i18n-rtl.md.
 *
 * Disabled locales stay routable so that a link to `/kmr/...` resolves rather
 * than 404s while the catalogue is in review; the language switcher only
 * offers ENABLED_LOCALES.
 */
export const routing = defineRouting({
  locales: ALL_LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
});
