import { decryptSecret } from '@/infra/auth/crypto';
import { verifyTotpCode } from '@/infra/auth/totp';
import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp, requireAccess } from '@/lib/api/guards';
import { enforceRateLimit, noStore, parseBody } from '@/lib/api/route-helpers';
import { fail, ok, requestId } from '@/lib/api/respond';
import { totpVerifyRequestSchema } from '@/shared/auth-contract';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/auth/totp/verify
 *
 * Activates a pending enrolment by proving the authenticator works. Rate
 * limited, because this endpoint accepts a six-digit code.
 */
export async function POST(request: Request) {
  const access = await requireAccess(request, {
    all: ['account:manage_security'],
    requireVerifiedEmail: false,
  });
  if (!access.ok) return access.response;

  const limited = await enforceRateLimit(request, RATE_LIMITS.totp, access.value.principal.userId);
  if (!limited.ok) return limited.response;

  const body = await parseBody(request, totpVerifyRequestSchema);
  if (!body.ok) return body.response;

  const user = await prisma.user.findUnique({
    where: { id: access.value.principal.userId },
    select: { id: true, twoFactorSecretEnc: true, twoFactorEnabledAt: true },
  });

  if (!user?.twoFactorSecretEnc) {
    return fail('conflict', 'Start enrolment before verifying a code.', { request });
  }
  if (user.twoFactorEnabledAt !== null) {
    return fail('conflict', 'Two-factor authentication is already enabled.', { request });
  }

  const valid = await verifyTotpCode(decryptSecret(user.twoFactorSecretEnc), body.value.code);
  if (!valid) {
    await tryWriteAuditLog(prisma, {
      action: 'auth.totp_verification_failed',
      actorType: 'user',
      actorId: user.id,
      entityType: 'user',
      entityId: user.id,
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      correlationId: requestId(request),
    });
    return fail('unauthenticated', 'That code is not valid.', { request, status: 401 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorEnabledAt: new Date() },
  });

  await tryWriteAuditLog(prisma, {
    action: 'auth.totp_enrolled',
    actorType: 'user',
    actorId: user.id,
    entityType: 'user',
    entityId: user.id,
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  // The `tfa` claim only changes on the next token, so the client must refresh.
  return noStore(
    ok({ status: 'enabled', note: 'Refresh your session for the change to take effect.' }),
  );
}
