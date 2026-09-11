import { createHmac, randomBytes, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';
import type { NextResponse } from 'next/server';
import { serverEnv } from '@/infra/env';
import type { IssuedSession } from './session-service';

/**
 * Browser session transport.
 *
 * Phase 3 issued bearer tokens for API clients. This adds the BROWSER
 * transport, and the whole design turns on one rule: no authentication
 * material may be reachable from JavaScript. An access token in
 * `localStorage` turns any XSS anywhere on the origin into a full account
 * takeover, permanently, because script can exfiltrate it at leisure. Cookies
 * marked `HttpOnly` cannot be read by script at all — an XSS can still ACT as
 * the user while the page is open, which is bad, but it cannot steal the
 * session and keep it.
 *
 * Three cookies, with deliberately different scopes:
 *
 *   kurdora_at   access token   HttpOnly  SameSite=Lax     path=/
 *                Short-lived (15 min). Lax rather than Strict so that
 *                following a link into the site from email still arrives
 *                authenticated — a GET cannot change state.
 *
 *   kurdora_rt   refresh token  HttpOnly  SameSite=Strict  path=/api/v1/auth
 *                Long-lived and far more valuable, so it is scoped to the only
 *                path that consumes it and never leaves on a cross-site
 *                request at all. It is not attached to ordinary page loads,
 *                so a page-level flaw cannot see it.
 *
 *   kurdora_csrf csrf token     READABLE  SameSite=Lax     path=/
 *                Deliberately NOT HttpOnly: client code must echo it back.
 *                It is not a credential. On its own it authenticates nobody;
 *                it only proves the request came from a page that could read
 *                our cookie.
 *
 * `Secure` is set everywhere except plain-HTTP local development, where the
 * browser would otherwise discard the cookie and nothing would work.
 */

export const ACCESS_COOKIE = 'kurdora_at';
export const REFRESH_COOKIE = 'kurdora_rt';
export const CSRF_COOKIE = 'kurdora_csrf';

/**
 * Presence-only marker that a session exists.
 *
 * The refresh cookie is deliberately scoped to `/api/v1/auth`, which means the
 * browser does NOT send it to a page like `/en/dashboard`. A Server Component
 * therefore cannot tell "signed out" from "access token expired, refresh token
 * still good" — and would send a reader with a perfectly valid session to the
 * login screen every fifteen minutes.
 *
 * This cookie closes that gap without widening the refresh cookie's scope. It
 * carries NO secret: its value is a constant. Forging it achieves nothing but
 * one wasted redirect, because the refresh route clears every session cookie
 * when no refresh token is presented, which also ends the loop.
 */
export const SESSION_HINT_COOKIE = 'kurdora_sess';
export const SESSION_HINT_VALUE = '1';

/** The refresh cookie is offered only to the routes that consume it. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export const CSRF_HEADER = 'x-csrf-token';
export const CSRF_FIELD = '_csrf';

function isSecureContext(): boolean {
  const url = serverEnv().APP_URL;
  return url.startsWith('https://');
}

interface CookieAttributes {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict';
  path: string;
  expires?: Date;
  maxAge?: number;
}

function baseAttributes(overrides: Partial<CookieAttributes> = {}): CookieAttributes {
  return {
    httpOnly: true,
    secure: isSecureContext(),
    sameSite: 'lax',
    path: '/',
    ...overrides,
  };
}

/**
 * Mints a CSRF token bound to one session family.
 *
 * `<random>.<hmac>`: the random half makes the token unguessable, the HMAC
 * binds it to this session. An attacker who can write a cookie on our domain
 * (a subdomain takeover, say) can therefore still not forge a token that
 * matches the VICTIM's session — plain double-submit alone would fall to that.
 */
export function issueCsrfToken(familyId: string): string {
  const nonce = randomBytes(18).toString('base64url');
  return `${nonce}.${csrfSignature(familyId, nonce)}`;
}

function csrfSignature(familyId: string, nonce: string): string {
  const secret = serverEnv().AUTH_SECRET;
  if (!secret) {
    // Never silently fall back to an unsigned token: that would quietly
    // downgrade the protection to plain double-submit.
    throw new Error('AUTH_SECRET is required to sign CSRF tokens.');
  }
  return createHmac('sha256', secret).update(`csrf:${familyId}:${nonce}`).digest('base64url');
}

/** Verifies that a token was minted for this session family. */
export function verifyCsrfToken(token: string | null, familyId: string): boolean {
  if (!token) return false;
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return false;

  const nonce = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (nonce === '' || signature === '') return false;

  let expected: string;
  try {
    expected = csrfSignature(familyId, nonce);
  } catch {
    return false;
  }

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return nodeTimingSafeEqual(a, b);
}

/**
 * Writes the session onto a response.
 *
 * The CSRF token is re-minted on every session write, so it always matches the
 * current family — including after a rotation, where the family id is
 * preserved but the tokens are not.
 */
export function setSessionCookies(response: NextResponse, session: IssuedSession): NextResponse {
  response.cookies.set(
    ACCESS_COOKIE,
    session.accessToken,
    baseAttributes({ expires: session.accessTokenExpiresAt }),
  );

  response.cookies.set(
    REFRESH_COOKIE,
    session.refreshToken,
    baseAttributes({
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      expires: session.refreshTokenExpiresAt,
    }),
  );

  response.cookies.set(
    CSRF_COOKIE,
    issueCsrfToken(session.familyId),
    // Readable by design — this one is echoed back by the page.
    baseAttributes({ httpOnly: false, expires: session.refreshTokenExpiresAt }),
  );

  response.cookies.set(
    SESSION_HINT_COOKIE,
    SESSION_HINT_VALUE,
    baseAttributes({ expires: session.refreshTokenExpiresAt }),
  );

  return response;
}

/**
 * Clears every session cookie.
 *
 * Each is cleared with the SAME path it was set with. A cookie set on
 * `/api/v1/auth` is a different cookie from one set on `/`, and clearing only
 * the latter would leave a working refresh token in the browser after logout.
 */
export function clearSessionCookies(response: NextResponse): NextResponse {
  const expired = new Date(0);

  response.cookies.set(ACCESS_COOKIE, '', baseAttributes({ expires: expired }));
  response.cookies.set(
    REFRESH_COOKIE,
    '',
    baseAttributes({ sameSite: 'strict', path: REFRESH_COOKIE_PATH, expires: expired }),
  );
  response.cookies.set(CSRF_COOKIE, '', baseAttributes({ httpOnly: false, expires: expired }));

  return response;
}

/** Reads a cookie from a raw request, without Next's cookie helpers. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

/**
 * The Server Action / route-handler cookie jar from `next/headers`.
 *
 * Typed structurally rather than importing Next's type, so this module stays
 * usable from anywhere and testable without a request context.
 */
export interface CookieJar {
  set(name: string, value: string, options: Record<string, unknown>): void;
}

/**
 * Writes the session to a cookie jar.
 *
 * Server Actions cannot return a NextResponse, so they write through the jar
 * instead. Both writers share `baseAttributes`, so the two paths cannot drift
 * into different security attributes — which is exactly the kind of divergence
 * that leaves one path without `HttpOnly`.
 */
export function setSessionCookiesOnJar(jar: CookieJar, session: IssuedSession): void {
  jar.set(ACCESS_COOKIE, session.accessToken, {
    ...baseAttributes({ expires: session.accessTokenExpiresAt }),
  });
  jar.set(REFRESH_COOKIE, session.refreshToken, {
    ...baseAttributes({
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      expires: session.refreshTokenExpiresAt,
    }),
  });
  jar.set(CSRF_COOKIE, issueCsrfToken(session.familyId), {
    ...baseAttributes({ httpOnly: false, expires: session.refreshTokenExpiresAt }),
  });
  jar.set(SESSION_HINT_COOKIE, SESSION_HINT_VALUE, {
    ...baseAttributes({ expires: session.refreshTokenExpiresAt }),
  });
}

export function clearSessionCookiesOnJar(jar: CookieJar): void {
  const expires = new Date(0);
  jar.set(ACCESS_COOKIE, '', { ...baseAttributes({ expires }) });
  jar.set(REFRESH_COOKIE, '', {
    ...baseAttributes({ sameSite: 'strict', path: REFRESH_COOKIE_PATH, expires }),
  });
  jar.set(CSRF_COOKIE, '', { ...baseAttributes({ httpOnly: false, expires }) });
  jar.set(SESSION_HINT_COOKIE, '', { ...baseAttributes({ expires }) });
}
