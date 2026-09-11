/**
 * CSRF defence for cookie-authenticated requests.
 *
 * The threat is specific: a cookie is attached by the browser to ANY request
 * to our origin, including one triggered by an attacker's page. A bearer token
 * is not, because script on another origin cannot read it and cannot set an
 * Authorization header on a cross-origin form post. So CSRF protection is
 * required exactly when identity came from a cookie, and is meaningless when
 * it came from a bearer token.
 *
 * Three independent checks, because each fails differently:
 *
 *   1. SameSite=Lax on the session cookie. Stops cross-site POSTs in every
 *      browser that honours it. Not sufficient alone: it is a browser
 *      behaviour we do not control, and it does not protect same-site
 *      subdomain attacks.
 *   2. Origin / Sec-Fetch-Site. Cheap, and catches the classic cross-origin
 *      form post. Not sufficient alone: Origin is absent on some legitimate
 *      same-origin navigations, so it cannot be required unconditionally.
 *   3. A signed double-submit token. The token is bound to the session family
 *      by HMAC, so an attacker who can set a cookie on our domain still cannot
 *      forge a token that matches the victim's session. This is the check that
 *      does not depend on browser behaviour.
 *
 * This module is pure: it takes strings and returns a decision. The HMAC and
 * the header reading live in the adapter.
 */

/** Methods that cannot change state, and so need no CSRF token. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

export type CsrfFailure = 'missing_token' | 'token_mismatch' | 'cross_origin' | 'malformed_token';

export type CsrfDecision =
  { readonly ok: true } | { readonly ok: false; readonly reason: CsrfFailure };

export interface CsrfCheckInput {
  readonly method: string;
  /** Token from the `X-CSRF-Token` header or a `_csrf` form field. */
  readonly presentedToken: string | null;
  /** Token from the readable CSRF cookie. */
  readonly cookieToken: string | null;
  /**
   * Whether `presentedToken` verifies against the session family under our
   * secret. Computed by the adapter, which owns the HMAC.
   */
  readonly signatureValid: boolean;
  /** `Origin` header, absent on many same-origin navigations. */
  readonly origin: string | null;
  /** Our own origin, from configuration — never from the request. */
  readonly expectedOrigin: string;
  /** `Sec-Fetch-Site`, sent by modern browsers and not forgeable by script. */
  readonly secFetchSite: string | null;
}

/**
 * Constant-time string comparison.
 *
 * A timing-variable compare on a CSRF token is a weak oracle, but it is a free
 * one to close and the habit matters more than this particular token.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function checkCsrf(input: CsrfCheckInput): CsrfDecision {
  if (isSafeMethod(input.method)) return { ok: true };

  // `Sec-Fetch-Site: cross-site` is decisive and cannot be set by script.
  // `none` means a direct navigation, which cannot be a scripted form post
  // carrying a token, so it is treated the same way.
  if (input.secFetchSite === 'cross-site' || input.secFetchSite === 'none') {
    return { ok: false, reason: 'cross_origin' };
  }

  // When Origin IS present it must match. When absent — some same-origin
  // navigations omit it — the token check below still has to pass, so this
  // cannot be used to bypass anything.
  if (input.origin !== null && input.origin !== input.expectedOrigin) {
    return { ok: false, reason: 'cross_origin' };
  }

  if (input.presentedToken === null || input.presentedToken === '') {
    return { ok: false, reason: 'missing_token' };
  }
  if (input.cookieToken === null || input.cookieToken === '') {
    return { ok: false, reason: 'missing_token' };
  }

  // Double submit: the value in the request body/header must equal the value
  // in the cookie. Alone this is defeatable by an attacker who can write a
  // cookie on our domain, which is why the signature check follows.
  if (!timingSafeEqual(input.presentedToken, input.cookieToken)) {
    return { ok: false, reason: 'token_mismatch' };
  }

  // Signed: the token is an HMAC over THIS session's family id. A cookie the
  // attacker planted will not verify against the victim's session.
  if (!input.signatureValid) {
    return { ok: false, reason: 'malformed_token' };
  }

  return { ok: true };
}
