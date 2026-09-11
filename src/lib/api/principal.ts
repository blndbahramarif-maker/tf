import type { Principal } from '@/domain/rbac/authorize';
import { verifyAccessToken } from '@/infra/auth/access-token';
import { prisma } from '@/infra/db/client';

/**
 * Resolves the authenticated principal from a request.
 *
 * The Authorization header is the ONLY source of identity. No route may accept
 * a user id from a path, query string or body as proof of who the caller is —
 * an id supplied by the client is a claim, never a fact.
 *
 * Roles and permissions travel inside the signed access token so the common
 * path needs no database round trip. The token is short-lived (15 minutes), so
 * the staleness window for a revoked role is bounded and is closed at refresh,
 * where the database is authoritative.
 */

export interface ResolvedPrincipal {
  readonly principal: Principal;
  /** Refresh-token family id, identifying this session. */
  readonly familyId: string;
}

export type PrincipalResolution =
  | { readonly ok: true; readonly value: ResolvedPrincipal }
  | { readonly ok: false; readonly reason: 'missing' | 'expired' | 'invalid' | 'suspended' };

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

export async function resolvePrincipal(request: Request): Promise<PrincipalResolution> {
  const token = bearerToken(request);
  if (token === null) return { ok: false, reason: 'missing' };

  const verification = await verifyAccessToken(token);
  if (!verification.ok) return { ok: false, reason: verification.reason };

  const claims = verification.claims;

  // Suspension and bans must take effect immediately, not after the access
  // token expires, so account status IS read from the database on every
  // authenticated request. This is the one lookup worth paying for.
  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { id: true, status: true, deletedAt: true },
  });

  if (!user || user.deletedAt !== null || user.status !== 'ACTIVE') {
    return { ok: false, reason: 'suspended' };
  }

  // Any role requiring two-factor makes the whole principal subject to it.
  const requiresTwoFactor =
    claims.roles.length > 0 &&
    (await prisma.role.count({
      where: { key: { in: [...claims.roles] }, requiresTwoFactor: true },
    })) > 0;

  return {
    ok: true,
    value: {
      familyId: claims.fam,
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
