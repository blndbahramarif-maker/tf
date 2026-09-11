import { randomBytes } from 'node:crypto';
import { encryptSecret } from '@/infra/auth/crypto';
import { hashPassword } from '@/infra/auth/password-hasher';
import { generateTotpSecret, totpEnrolmentUri } from '@/infra/auth/totp';
import { prisma } from '@/infra/db/client';
import { requireAccess } from '@/lib/api/guards';
import { enforceRateLimit, noStore } from '@/lib/api/route-helpers';
import { fail, ok } from '@/lib/api/respond';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';

export const dynamic = 'force-dynamic';

const RECOVERY_CODE_COUNT = 10;

/**
 * POST /api/v1/auth/totp/enroll
 *
 * Begins two-factor enrolment: generates a secret, stores it ENCRYPTED, and
 * returns the otpauth URI plus one-time recovery codes.
 *
 * The secret is not active until a valid code is submitted to
 * `/auth/totp/verify`. Activating on enrolment would let someone lock
 * themselves out by scanning nothing.
 *
 * Recovery codes are returned exactly once, in plaintext, and stored hashed.
 * Without them, mandatory staff two-factor turns a lost phone into permanent
 * loss of the platform owner's account (R-13).
 */
export async function POST(request: Request) {
  const access = await requireAccess(request, {
    all: ['account:manage_security'],
    requireVerifiedEmail: false,
  });
  if (!access.ok) return access.response;

  const limited = await enforceRateLimit(request, RATE_LIMITS.totp, access.value.principal.userId);
  if (!limited.ok) return limited.response;

  const user = await prisma.user.findUnique({
    where: { id: access.value.principal.userId },
    select: { id: true, email: true, twoFactorEnabledAt: true },
  });
  if (!user) return fail('not_found', 'Not found.', { request });

  if (user.twoFactorEnabledAt !== null) {
    // Re-enrolling would silently invalidate the existing authenticator.
    // Removing two-factor is a separate, step-up-protected action.
    return fail('conflict', 'Two-factor authentication is already enabled.', { request });
  }

  const secret = generateTotpSecret();
  const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    randomBytes(8).toString('hex'),
  );

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      // Encrypted at rest: a database leak alone must not yield working codes.
      data: { twoFactorSecretEnc: encryptSecret(secret) },
    });

    await tx.twoFactorRecoveryCode.deleteMany({ where: { userId: user.id } });
    for (const code of recoveryCodes) {
      await tx.twoFactorRecoveryCode.create({
        data: { userId: user.id, codeHash: await hashPassword(code) },
      });
    }
  });

  return noStore(
    ok({
      secret,
      otpauthUri: totpEnrolmentUri(secret, user.email),
      recoveryCodes,
      status: 'pending_verification',
      note: 'Submit a code to /api/v1/auth/totp/verify to activate. Recovery codes are shown once.',
    }),
  );
}
