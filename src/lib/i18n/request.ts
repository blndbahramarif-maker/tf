import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@kurdora/i18n';
import { routing } from './routing';

/**
 * Loads the message catalogue for the active request.
 *
 * Falls back to the default locale rather than throwing: an unknown locale
 * segment should render the site in English, not produce a 500.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: Locale = isLocale(requested) ? requested : DEFAULT_LOCALE;

  const messages = (await import(`@kurdora/i18n/messages/${locale}.json`)).default;

  return {
    locale,
    messages,
    // UTC everywhere on the server; rendering into the user's zone is a
    // presentation concern handled at the component level.
    timeZone: 'UTC',
    now: new Date(),
    onError(error) {
      // Missing messages must be loud in development and non-fatal in
      // production — a missing string should never take down a page.
      if (process.env.NODE_ENV !== 'production') {
        console.error('[i18n]', error.message);
      }
    },
  };
});

export { routing };
