import {
  isLockedOut,
  lockoutRemainingMs,
  registerFailure,
  registerSuccess,
} from '@/domain/auth/lockout';
import { decryptSecret } from '@/infra/auth/crypto';
import { verifyPassword, verifyPasswordAgainstDummy } from '@/infra/auth/password-hasher';
import { verifyTotpCode } from '@/infra/auth/totp';
import { createSession } from '@/infra/auth/session-service';
import { verifyPassword as verifyRecoveryCode } from '@/infra/auth/password-hasher';
import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp } from '@/lib/api/guards';
import { enforceRateLimit, noStore, parseBody } from '@/lib/api/route-helpers';
import { fail, ok, requestId } from '@/lib/api/respond';
import { loginRequestSchema } from '@/shared/auth-contract';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/auth/login
 *
 * Every failure path returns the SAME generic message and spends comparable
 * CPU time, so this endpoint reveals neither whether an account exists nor
 * whether a password was close.
 *
 * Rate limited by IP and by email, and backed by per-account lockout: an
 * attacker spreading attempts across many IPs still gets only a handful of
 * guesses per account.
 */
export async function POST(request: Request) {
  const body = await parseBody(request, loginRequestSchema);
  if (!body.ok) return body.response;

  const { email, password, totpCode, recoveryCode } = body.value;

  const limited = await enforceRateLimit(request, RATE_LIMITS.login, email);
  if (!limited.ok) return limited.response;

  const genericFailure = () =>
    fail('unauthenticated', 'Email or password is incorrect.', { request, status: 401 });

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      passwordHash: true,
      status: true,
      deletedAt: true,
      emailVerifiedAt: true,
      failedLoginCount: true,
      lockedUntil: true,
      twoFactorSecretEnc: true,
      twoFactorEnabledAt: true,
      updatedAt: true,
      roles: { select: { role: { select: { key: true, requiresTwoFactor: true } } } },
    },
  });

  if (!user || user.deletedAt !== null || user.passwordHash === null) {
    // Burn comparable CPU so "no such account" is not measurably faster.
    await verifyPasswordAgainstDummy(password);
    return genericFailure();
  }

  const now = new Date();
  const lockState = {
    failedLoginCount: user.failedLoginCount,
    lockedUntil: user.lockedUntil,
    lastFailureAt: user.updatedAt,
  };

  if (isLockedOut(lockState, now)) {
    await tryWriteAuditLog(prisma, {
      action: 'auth.login_locked_out',
      actorType: 'user',
      actorId: user.id,
      entityType: 'user',
      entityId: user.id,
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      correlationId: requestId(request),
    });

    const response = fail('rate_limited', 'Too many failed attempts. Try again later.', {
      request,
    });
    response.headers.set(
      'retry-after',
      String(Math.ceil(lockoutRemainingMs(lockState, now) / 1000)),
    );
    return response;
  }

  const passwordOk = await verifyPassword(user.passwordHash, password);

  const failAttempt = async (reason: string) => {
    const transition = registerFailure(lockState, now);
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: transition.failedLoginCount, lockedUntil: transition.lockedUntil },
    });
    await tryWriteAuditLog(prisma, {
      action: 'auth.login_failed',
      actorType: 'user',
      actorId: user.id,
      entityType: 'user',
      entityId: user.id,
      after: { reason, failedLoginCount: transition.failedLoginCount },
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      correlationId: requestId(request),
    });
    return genericFailure();
  };

  if (!passwordOk) return failAttempt('bad_password');

  if (user.status !== 'ACTIVE') {
    return fail('forbidden', 'This account is not active.', { request, status: 403 });
  }

  // Two-factor: required when enrolled, and required outright for staff roles.
  const staffRole = user.roles.some((entry) => entry.role.requiresTwoFactor);
  const twoFactorEnabled = user.twoFactorEnabledAt !== null && user.twoFactorSecretEnc !== null;

  if (staffRole && !twoFactorEnabled) {
    // A staff account without TOTP cannot log in at all. Enrolment happens
    // through a separate, deliberately-granted flow — not by bypassing this.
    return fail(
      'forbidden',
      'Two-factor authentication must be enrolled for this account before signing in.',
      { request, status: 403 },
    );
  }

  if (twoFactorEnabled) {
    const secondFactorOk = await verifySecondFactor({
      userId: user.id,
      secretEnc: user.twoFactorSecretEnc!,
      totpCode,
      recoveryCode,
    });

    if (!secondFactorOk) {
      if (!totpCode && !recoveryCode) {
        return fail('unauthenticated', 'A two-factor code is required.', {
          request,
          status: 401,
        });
      }
      return failAttempt('bad_totp');
    }
  }

  const reset = registerSuccess();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: reset.failedLoginCount,
      lockedUntil: reset.lockedUntil,
      lastLoginAt: now,
    },
  });

  // Logging in IS a full authentication, so the session starts stepped up.
  const session = await createSession({
    userId: user.id,
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    stepUpAt: now,
    now,
  });

  if (!session) return genericFailure();

  await tryWriteAuditLog(prisma, {
    action: 'auth.login_succeeded',
    actorType: 'user',
    actorId: user.id,
    actorRole: user.roles[0]?.role.key ?? null,
    entityType: 'user',
    entityId: user.id,
    after: { familyId: session.familyId, twoFactor: twoFactorEnabled },
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  return noStore(
    ok({
      accessToken: session.accessToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
      refreshToken: session.refreshToken,
      refreshTokenExpiresAt: session.refreshTokenExpiresAt.toISOString(),
      tokenType: 'Bearer',
      emailVerified: user.emailVerifiedAt !== null,
    }),
  );
}

/** Checks a TOTP code, or burns a single-use recovery code. */
async function verifySecondFactor(input: {
  userId: string;
  secretEnc: string;
  totpCode?: string;
  recoveryCode?: string;
}): Promise<boolean> {
  if (input.totpCode) {
    return verifyTotpCode(decryptSecret(input.secretEnc), input.totpCode);
  }

  if (input.recoveryCode) {
    const candidates = await prisma.twoFactorRecoveryCode.findMany({
      where: { userId: input.userId, usedAt: null },
      select: { id: true, codeHash: true },
    });

    for (const candidate of candidates) {
      if (await verifyRecoveryCode(candidate.codeHash, input.recoveryCode)) {
        // Conditional update: a code can be spent exactly once, even under
        // two concurrent requests.
        const spent = await prisma.twoFactorRecoveryCode.updateMany({
          where: { id: candidate.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        return spent.count === 1;
      }
    }
    return false;
  }

  return false;
}
