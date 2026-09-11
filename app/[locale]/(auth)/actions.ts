'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { POST as loginHandler } from '../../api/v1/auth/login/route';
import { POST as registerHandler } from '../../api/v1/auth/register/route';
import { POST as verifyEmailHandler } from '../../api/v1/auth/verify-email/route';
import { POST as logoutHandler } from '../../api/v1/auth/logout/route';
import {
  ACCESS_COOKIE,
  clearSessionCookiesOnJar,
  setSessionCookiesOnJar,
} from '@/infra/auth/session-cookies';
import {
  callAuthRoute,
  errorCode,
  errorMessage,
  firstFieldError,
} from '@/lib/auth/call-auth-route';
import { verifyAccessToken } from '@/infra/auth/access-token';
import { serverEnv } from '@/infra/env';
import { isLocale, DEFAULT_LOCALE } from '@kurdora/i18n';
import type { AuthFormState } from './form-state';

/**
 * Browser authentication actions.
 *
 * Each one calls the corresponding API handler in-process (see
 * `call-auth-route.ts` for why), then writes HttpOnly cookies. The returned
 * state carries ONLY a message — never a token, never a user id, never a
 * reason that distinguishes "no such account" from "wrong password".
 */

function localeFrom(form: FormData): string {
  const value = form.get('locale');
  return typeof value === 'string' && isLocale(value) ? value : DEFAULT_LOCALE;
}

/** Keeps a post-login redirect on our own origin. */
function safeRedirect(value: FormDataEntryValue | null, locale: string): string {
  const fallback = `/${locale}/dashboard`;
  if (typeof value !== 'string' || value === '') return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  try {
    const resolved = new URL(value, serverEnv().APP_URL);
    if (resolved.origin !== new URL(serverEnv().APP_URL).origin) return fallback;
    return `${resolved.pathname}${resolved.search}`;
  } catch {
    return fallback;
  }
}

export async function registerAction(
  _previous: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const locale = localeFrom(form);

  const result = await callAuthRoute(registerHandler, '/api/v1/auth/register', {
    email: String(form.get('email') ?? ''),
    password: String(form.get('password') ?? ''),
    displayName: String(form.get('displayName') ?? ''),
    acceptedTerms: form.get('acceptedTerms') === 'on',
    locale,
  });

  if (result.status >= 400) {
    return { error: firstFieldError(result.body) ?? errorMessage(result.body) ?? 'unknown' };
  }

  return {
    error: null,
    pendingVerification: true,
    // Present only outside production, where the register handler returns it
    // so a developer (and the E2E suite) can complete the flow without a
    // mailbox. It is never rendered when the API omits it.
    devVerificationToken:
      typeof result.body.devVerificationToken === 'string'
        ? result.body.devVerificationToken
        : null,
  };
}

export async function verifyEmailAction(
  _previous: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const locale = localeFrom(form);

  const result = await callAuthRoute(verifyEmailHandler, '/api/v1/auth/verify-email', {
    token: String(form.get('token') ?? ''),
  });

  if (result.status >= 400) {
    return { error: errorMessage(result.body) ?? 'unknown' };
  }

  redirect(`/${locale}/login?verified=1`);
}

export async function loginAction(
  _previous: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const locale = localeFrom(form);

  const result = await callAuthRoute(loginHandler, '/api/v1/auth/login', {
    email: String(form.get('email') ?? ''),
    password: String(form.get('password') ?? ''),
    ...(form.get('totpCode') ? { totpCode: String(form.get('totpCode')) } : {}),
  });

  if (result.status >= 400) {
    return { error: errorCode(result.body) ?? 'unknown' };
  }

  const accessToken = result.body.accessToken;
  const refreshToken = result.body.refreshToken;
  const accessExpiry = result.body.accessTokenExpiresAt;
  const refreshExpiry = result.body.refreshTokenExpiresAt;

  if (
    typeof accessToken !== 'string' ||
    typeof refreshToken !== 'string' ||
    typeof accessExpiry !== 'string' ||
    typeof refreshExpiry !== 'string'
  ) {
    return { error: 'unknown' };
  }

  /*
   * The family id is not in the login response body, and it is not being added
   * there: it would be a breaking change to a documented contract, and API
   * clients have no use for it. It is already inside the signed access token
   * as `fam`, so it is read from there. Verifying rather than decoding matters
   * — an unverified decode would trust a value we are about to bind the CSRF
   * token to.
   */
  const verification = await verifyAccessToken(accessToken);
  if (!verification.ok) return { error: 'unknown' };
  const familyId = verification.claims.fam;

  // The tokens stop here. They go into HttpOnly cookies and are never returned
  // to the page, so no script on this origin can read them.
  setSessionCookiesOnJar(await cookies(), {
    accessToken,
    accessTokenExpiresAt: new Date(accessExpiry),
    refreshToken,
    refreshTokenExpiresAt: new Date(refreshExpiry),
    familyId,
  });

  redirect(safeRedirect(form.get('next'), locale));
}

export async function logoutAction(form: FormData): Promise<void> {
  const locale = localeFrom(form);
  const jar = await cookies();
  const accessToken = jar.get(ACCESS_COOKIE)?.value;

  if (accessToken) {
    // Revoke server-side as well as clearing the browser. Clearing cookies
    // alone would leave a working refresh-token family on the server, so a
    // stolen token would survive the user pressing "sign out".
    await callAuthRoute(
      (request) =>
        logoutHandler(
          new Request(request, {
            headers: new Headers({
              ...Object.fromEntries(request.headers),
              authorization: `Bearer ${accessToken}`,
            }),
          }),
        ),
      '/api/v1/auth/logout',
      {},
    );
  }

  clearSessionCookiesOnJar(jar);
  redirect(`/${locale}`);
}
