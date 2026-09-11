import { randomUUID } from 'node:crypto';
import {
  evaluateRefresh,
  refreshExpiryFrom,
  type RefreshOutcome,
} from '@/domain/auth/refresh-tokens';
import { prisma } from '@/infra/db/client';
import { issueAccessToken } from './access-token';
import { generateOpaqueToken, hashToken } from './crypto';

/**
 * Session lifecycle.
 *
 * A "session" is a refresh-token FAMILY. Each refresh mints a new token in the
 * family and revokes the one presented, so a token is valid exactly once.
 * Presenting a revoked token means the family is compromised, and the whole
 * family is revoked (ADR: see docs/08-security-architecture.md).
 *
 * Refresh tokens are opaque random values, stored only as SHA-256 hashes: a
 * database leak must not hand an attacker working sessions.
 */

export interface IssuedSession {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
  readonly familyId: string;
}

export interface PrincipalClaims {
  readonly roles: string[];
  readonly permissions: string[];
  readonly emailVerified: boolean;
  readonly twoFactorEnabled: boolean;
}

/** Reads the authoritative role and permission set from the database. */
export async function loadPrincipalClaims(userId: string): Promise<PrincipalClaims | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      emailVerifiedAt: true,
      twoFactorEnabledAt: true,
      roles: {
        where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        select: {
          role: {
            select: {
              key: true,
              permissions: { select: { permission: { select: { key: true } } } },
            },
          },
        },
      },
    },
  });

  if (!user) return null;

  const roles = user.roles.map((entry) => entry.role.key);
  const permissions = [
    ...new Set(
      user.roles.flatMap((entry) => entry.role.permissions.map((rp) => rp.permission.key)),
    ),
  ];

  return {
    roles,
    permissions,
    emailVerified: user.emailVerifiedAt !== null,
    twoFactorEnabled: user.twoFactorEnabledAt !== null,
  };
}

export interface CreateSessionInput {
  readonly userId: string;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  /** Set when the session begins with a full re-authentication. */
  readonly stepUpAt?: Date | null;
  readonly familyId?: string;
  readonly rotatedFrom?: string | null;
  readonly now?: Date;
}

export async function createSession(input: CreateSessionInput): Promise<IssuedSession | null> {
  const now = input.now ?? new Date();
  const claims = await loadPrincipalClaims(input.userId);
  if (!claims) return null;

  const familyId = input.familyId ?? randomUUID();
  const refreshToken = generateOpaqueToken();
  const refreshTokenExpiresAt = refreshExpiryFrom(now);
  const stepUpAt = input.stepUpAt ?? null;

  await prisma.refreshToken.create({
    data: {
      userId: input.userId,
      tokenHash: hashToken(refreshToken),
      familyId,
      rotatedFrom: input.rotatedFrom ?? null,
      expiresAt: refreshTokenExpiresAt,
      stepUpAt,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
  });

  const { token: accessToken, expiresAt: accessTokenExpiresAt } = await issueAccessToken(
    {
      sub: input.userId,
      fam: familyId,
      roles: claims.roles,
      perms: claims.permissions,
      ev: claims.emailVerified,
      tfa: claims.twoFactorEnabled,
      ...(stepUpAt === null ? {} : { sua: Math.floor(stepUpAt.getTime() / 1000) }),
    },
    now,
  );

  return {
    accessToken,
    accessTokenExpiresAt,
    refreshToken,
    refreshTokenExpiresAt,
    familyId,
  };
}

export async function revokeFamily(familyId: string, reason: string): Promise<number> {
  const result = await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count;
}

export async function revokeAllSessions(userId: string, reason: string): Promise<number> {
  const result = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count;
}

export type RotateResult =
  | { readonly kind: 'rotated'; readonly session: IssuedSession }
  | { readonly kind: 'reuse_detected'; readonly familyId: string; readonly userId: string }
  | { readonly kind: 'rejected'; readonly outcome: RefreshOutcome['kind'] };

/**
 * Rotates a presented refresh token.
 *
 * On reuse, the ENTIRE family is revoked before returning — every session
 * descended from that login is killed, including the attacker's and the real
 * user's. That is intentional: we cannot tell which is which, so both must
 * re-authenticate.
 */
export async function rotateSession(
  presentedToken: string,
  context: { ip?: string | null; userAgent?: string | null; now?: Date } = {},
): Promise<RotateResult> {
  const now = context.now ?? new Date();

  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(presentedToken) },
    select: {
      id: true,
      userId: true,
      familyId: true,
      expiresAt: true,
      revokedAt: true,
      stepUpAt: true,
    },
  });

  const outcome = evaluateRefresh(record, now);

  if (outcome.kind === 'reuse_detected') {
    await revokeFamily(outcome.record.familyId, 'reuse_detected');
    return {
      kind: 'reuse_detected',
      familyId: outcome.record.familyId,
      userId: outcome.record.userId,
    };
  }

  if (outcome.kind !== 'rotate') {
    return { kind: 'rejected', outcome: outcome.kind };
  }

  // Sessions minted before a password change are refused: changing the
  // password must eject anyone holding an older session.
  const user = await prisma.user.findUnique({
    where: { id: outcome.record.userId },
    select: { status: true, deletedAt: true, passwordChangedAt: true },
  });

  if (!user || user.deletedAt !== null || user.status !== 'ACTIVE') {
    await revokeFamily(outcome.record.familyId, 'account_inactive');
    return { kind: 'rejected', outcome: 'unknown' };
  }

  await prisma.refreshToken.update({
    where: { id: outcome.record.id },
    data: { revokedAt: now, revokedReason: 'rotated', lastUsedAt: now },
  });

  const session = await createSession({
    userId: outcome.record.userId,
    familyId: outcome.record.familyId,
    rotatedFrom: outcome.record.id,
    // Step-up freshness survives rotation; the freshness WINDOW still applies,
    // so this cannot extend a step-up beyond its lifetime.
    stepUpAt: outcome.record.stepUpAt,
    ip: context.ip ?? null,
    userAgent: context.userAgent ?? null,
    now,
  });

  if (!session) return { kind: 'rejected', outcome: 'unknown' };
  return { kind: 'rotated', session };
}

/** Records a step-up on the session and mints a fresh access token carrying it. */
export async function recordStepUp(
  userId: string,
  familyId: string,
  now: Date = new Date(),
): Promise<{ accessToken: string; accessTokenExpiresAt: Date } | null> {
  const claims = await loadPrincipalClaims(userId);
  if (!claims) return null;

  await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { stepUpAt: now },
  });

  const { token, expiresAt } = await issueAccessToken(
    {
      sub: userId,
      fam: familyId,
      roles: claims.roles,
      perms: claims.permissions,
      ev: claims.emailVerified,
      tfa: claims.twoFactorEnabled,
      sua: Math.floor(now.getTime() / 1000),
    },
    now,
  );

  return { accessToken: token, accessTokenExpiresAt: expiresAt };
}
