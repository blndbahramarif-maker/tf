import { decryptSecret } from '@/infra/auth/crypto';
import { verifyPassword } from '@/infra/auth/password-hasher';
import { recordStepUp } from '@/infra/auth/session-service';
import { verifyTotpCode } from '@/infra/auth/totp';
import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp, requireAccess } from '@/lib/api/guards';
import { enforceRateLimit, noStore, parseBody } from '@/lib/api/route-helpers';
import { fail, ok, requestId } from '@/lib/api/respond';
import { stepUpRequestSchema } from '@/shared/auth-contract';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';
import { STEP_UP_WINDOW_MS } from '@/domain/auth/step-up';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/auth/step-up
 *
 * Re-authenticates an existing session and returns a NEW access token carrying
 * a fresh step-up timestamp. Sensitive routes require that timestamp to be
 * recent.
 *
 * From Phase 7 this gates refunds, payout release and commission changes. In
 * Phase 3 it gates password changes, two-factor removal and revoking every
 * session — the operations that can lock a user out of their own account.
 */
export async function POST(request: Request) {
  const access = await requireAccess(request, {
    all: ['account:read_self'],
    requireVerifiedEmail: false,
  });
  if (!access.ok) return access.response;

  const limited = await enforceRateLimit(
    request,
    RATE_LIMITS.stepUp,
    access.value.principal.userId,
  );
  if (!limited.ok) return limited.response;

  const body = await parseBody(request, stepUpRequestSchema);
  if (!body.ok) return body.response;

  const user = await prisma.user.findUnique({
    where: { id: access.value.principal.userId },
    select: { id: true, passwordHash: true, twoFactorSecretEnc: true, twoFactorEnabledAt: true },
  });

  const failStepUp = async () => {
    await tryWriteAuditLog(prisma, {
      action: 'auth.step_up_failed',
      actorType: 'user',
      actorId: access.value.principal.userId,
      entityType: 'user',
      entityId: access.value.principal.userId,
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      correlationId: requestId(request),
    });
    return fail('unauthenticated', 'Re-authentication failed.', { request, status: 401 });
  };

  if (!user?.passwordHash) return failStepUp();
  if (!(await verifyPassword(user.passwordHash, body.value.password))) return failStepUp();

  // Where two-factor is enrolled it must be presented again: a stolen session
  // plus a known password should not be enough to reach money operations.
  if (user.twoFactorEnabledAt !== null && user.twoFactorSecretEnc !== null) {
    if (!body.value.totpCode) {
      return fail('unauthenticated', 'A two-factor code is required.', { request, status: 401 });
    }
    const valid = await verifyTotpCode(decryptSecret(user.twoFactorSecretEnc), body.value.totpCode);
    if (!valid) return failStepUp();
  }

  const now = new Date();
  const issued = await recordStepUp(user.id, access.value.familyId, now);
  if (!issued) return failStepUp();

  await tryWriteAuditLog(prisma, {
    action: 'auth.step_up_succeeded',
    actorType: 'user',
    actorId: user.id,
    entityType: 'user',
    entityId: user.id,
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  return noStore(
    ok({
      accessToken: issued.accessToken,
      accessTokenExpiresAt: issued.accessTokenExpiresAt.toISOString(),
      stepUpExpiresAt: new Date(now.getTime() + STEP_UP_WINDOW_MS).toISOString(),
      tokenType: 'Bearer',
    }),
  );
}
