'use client';

import { ALL_LOCALES, DEFAULT_LOCALE, getDirection, isLocale, type Locale } from '@kurdora/i18n';
import ar from '@kurdora/i18n/messages/ar.json';
import ckb from '@kurdora/i18n/messages/ckb.json';
import en from '@kurdora/i18n/messages/en.json';
import kmr from '@kurdora/i18n/messages/kmr.json';

/**
 * Last-resort error boundary.
 *
 * This replaces the root layout entirely, so it must render its own `<html>`
 * and `<body>`, and it cannot use the next-intl provider — by the time it runs,
 * the tree that provides translations is the thing that failed.
 *
 * Text still comes from the catalogues rather than being written inline: the
 * locale is read from the first path segment, which is always present because
 * every route carries a prefix. Catalogues are imported statically because a
 * dynamic import is exactly what may have just failed; this chunk is only ever
 * downloaded when the boundary trips.
 *
 * The error itself is NOT displayed. A stack or a database message on an error
 * page is an information leak; the digest is enough to find it in the logs.
 */
const CATALOGUES = { en, ckb, kmr, ar } satisfies Record<Locale, unknown>;

function localeFromPath(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  const segment = window.location.pathname.split('/').filter(Boolean)[0];
  return isLocale(segment) && ALL_LOCALES.includes(segment) ? segment : DEFAULT_LOCALE;
}

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const locale = localeFromPath();
  const messages = CATALOGUES[locale];

  return (
    <html lang={locale} dir={getDirection(locale)}>
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          margin: 0,
          padding: '2rem',
          textAlign: 'center',
        }}
      >
        {/*
          Inline styles rather than the stylesheet: a failure severe enough to
          reach this boundary may be the stylesheet not loading.
        */}
        <div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>{messages.errors.generic}</h1>
          {error.digest === undefined ? null : (
            <p style={{ fontSize: '0.75rem', opacity: 0.6, marginTop: '1rem' }}>{error.digest}</p>
          )}
        </div>
      </body>
    </html>
  );
}
