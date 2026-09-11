import createMiddleware from 'next-intl/middleware';
import { routing } from '@/lib/i18n/routing';

/**
 * Locale negotiation and redirect.
 *
 * Order of precedence: URL segment → cookie → Accept-Language → default.
 * The URL always wins, which is what makes shared links deterministic.
 */
export default createMiddleware(routing);

export const config = {
  /**
   * Run on everything except API routes, Next internals and static files.
   * API routes must NOT be locale-prefixed: they are consumed by the web app,
   * and later by mobile clients, which negotiate language via the
   * Accept-Language header instead.
   */
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
