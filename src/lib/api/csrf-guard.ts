import type { NextResponse } from 'next/server';
import { checkCsrf, isSafeMethod, type CsrfFailure } from '@/domain/auth/csrf';
import {
  CSRF_COOKIE,
  CSRF_FIELD,
  CSRF_HEADER,
  readCookie,
  verifyCsrfToken,
} from '@/infra/auth/session-cookies';
import { serverEnv } from '@/infra/env';
import { fail } from './respond';
import type { AuthTransport } from './principal';

/**
 * CSRF enforcement for cookie-authenticated state changes.
 *
 * Applied ONLY when identity came from a cookie. A bearer token cannot be
 * attached by an attacker's page to a cross-origin request, so demanding a
 * CSRF token there would break API clients for no security gain — and, worse,
 * would tempt someone to add a bypass that later gets used by the browser
 * path too.
 *
 * The token is read from a header OR a form field, because a progressively
 * enhanced `<form>` posts `application/x-www-form-urlencoded` and cannot set
 * headers without JavaScript. Both are the same value and both are verified
 * the same way.
 */

const MESSAGE: Record<CsrfFailure, string> = {
  missing_token: 'This request is missing its CSRF token.',
  token_mismatch: 'The CSRF token does not match this session.',
  cross_origin: 'Cross-origin state-changing requests are refused.',
  malformed_token: 'The CSRF token is not valid for this session.',
};

export interface CsrfContext {
  readonly transport: AuthTransport;
  readonly familyId: string;
  /**
   * Already-parsed form body, when the caller has consumed it. A request body
   * can only be read once, so the caller passes what it read rather than this
   * guard racing it for the stream.
   */
  readonly formToken?: string | null;
}

export type CsrfResult =
  { readonly ok: true } | { readonly ok: false; readonly response: NextResponse };

export function enforceCsrf(request: Request, context: CsrfContext): CsrfResult {
  // Bearer callers are not exposed to CSRF; see the note above.
  if (context.transport === 'bearer') return { ok: true };
  if (isSafeMethod(request.method)) return { ok: true };

  const presented = context.formToken ?? request.headers.get(CSRF_HEADER);
  const cookieToken = readCookie(request, CSRF_COOKIE);

  const decision = checkCsrf({
    method: request.method,
    presentedToken: presented,
    cookieToken,
    // The signature binds the token to THIS session family.
    signatureValid: verifyCsrfToken(presented, context.familyId),
    origin: request.headers.get('origin'),
    // Our own origin comes from configuration, never from the request — an
    // attacker controls every header they send, including Host.
    expectedOrigin: new URL(serverEnv().APP_URL).origin,
    secFetchSite: request.headers.get('sec-fetch-site'),
  });

  if (decision.ok) return { ok: true };

  return {
    ok: false,
    response: fail('forbidden', MESSAGE[decision.reason], {
      request,
      status: 403,
    }),
  };
}

/** Reads the CSRF field out of a parsed form body. */
export function csrfFieldFrom(form: FormData): string | null {
  const value = form.get(CSRF_FIELD);
  return typeof value === 'string' ? value : null;
}
