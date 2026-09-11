import { cookies } from 'next/headers';
import type { Principal } from '@/domain/rbac/authorize';
import { verifyAccessToken } from '@/infra/auth/access-token';
import { ACCESS_COOKIE, CSRF_COOKIE, SESSION_HINT_COOKIE } from '@/infra/auth/session-cookies';
import { prisma } from '@/infra/db/client';

/**
 * Reads the signed-in principal inside a Server Component.
 *
 * Server Components cannot WRITE cookies — only route handlers and server
 * actions can — so this only ever reads. When the access cookie has expired
 * but a refresh cookie survives, the caller bounces through the refresh route
 * handler, which can write. See `app/api/v1/auth/session/route.ts`.
 *
 * Account status is re-read from the database on every call, exactly as the
 * API guard does: a suspension must take effect on the next page load, not
 * when the access token happens to expire.
 */

export interface BrowserSession {
  readonly principal: Principal;
  readonly familyId: string;
  readonly csrfToken: string;
}

export type SessionState =
  | { readonly kind: 'authenticated'; readonly session: BrowserSession }
  /** No access token, but a refresh token exists — a bounce may recover it. */
  | { readonly kind: 'refreshable' }
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'suspended' };

export async function readSessionState(): Promise<SessionState> {
  const jar = await cookies();
  const accessToken = jar.get(ACCESS_COOKIE)?.value ?? null;
  /*
   * The refresh cookie itself is scoped to `/api/v1/auth` and is NOT sent to
   * page routes, so its absence here means nothing. The presence-only hint
   * cookie is what distinguishes "signed out" from "access token expired".
   */
  const hasRefresh = (jar.get(SESSION_HINT_COOKIE)?.value ?? '') !== '';

  if (!accessToken) return hasRefresh ? { kind: 'refreshable' } : { kind: 'anonymous' };

  const verification = await verifyAccessToken(accessToken);
  if (!verification.ok) {
    // An expired access token with a live refresh token is the normal case
    // fifteen minutes into a session, not an error.
    return hasRefresh ? { kind: 'refreshable' } : { kind: 'anonymous' };
  }

  const claims = verification.claims;

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { id: true, status: true, deletedAt: true },
  });
  if (!user || user.deletedAt !== null || user.status !== 'ACTIVE') {
    return { kind: 'suspended' };
  }

  const requiresTwoFactor =
    claims.roles.length > 0 &&
    (await prisma.role.count({
      where: { key: { in: [...claims.roles] }, requiresTwoFactor: true },
    })) > 0;

  return {
    kind: 'authenticated',
    session: {
      familyId: claims.fam,
      // Read from the cookie rather than re-minted: re-minting here would
      // produce a token the browser's cookie does not match, and every form
      // on the page would then fail the double-submit check.
      csrfToken: jar.get(CSRF_COOKIE)?.value ?? '',
      principal: {
        userId: claims.sub,
        roles: claims.roles,
        permissions: new Set(claims.perms),
        emailVerified: claims.ev,
        twoFactorEnabled: claims.tfa,
        requiresTwoFactor,
        stepUpAt: claims.sua === undefined ? null : new Date(claims.sua * 1000),
      },
    },
  };
}
