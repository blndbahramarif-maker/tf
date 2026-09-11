import { hashToken } from '@/infra/auth/crypto';
import { prisma } from '@/infra/db/client';
import { clientIp } from '@/lib/api/guards';
import { enforceRateLimit, noStore, parseBody } from '@/lib/api/route-helpers';
import { fail, ok, requestId } from '@/lib/api/respond';
import { verifyEmailRequestSchema } from '@/shared/auth-contract';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/auth/verify-email
 *
 * Consumes a single-use verification token. Tokens are stored hashed, so a
 * database leak does not yield working links.
 */
export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, RATE_LIMITS.verifyEmail);
  if (!limited.ok) return limited.response;

  const body = await parseBody(request, verifyEmailRequestSchema);
  if (!body.ok) return body.response;

  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: hashToken(body.value.token) },
    select: { id: true, userId: true, purpose: true, expiresAt: true, consumedAt: true },
  });

  const now = new Date();
  const usable =
    record !== null &&
    record.purpose === 'EMAIL_VERIFY' &&
    record.consumedAt === null &&
    record.expiresAt.getTime() > now.getTime();

  if (!usable) {
    // One message for unknown, consumed and expired alike — the difference is
    // not useful to a legitimate user and is useful to an attacker.
    return fail('validation_failed', 'This verification link is invalid or has expired.', {
      request,
    });
  }

  await prisma.$transaction(async (tx) => {
    // Conditional update: if a concurrent request consumed it first, this
    // matches zero rows and the token is not double-spent.
    const consumed = await tx.verificationToken.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (consumed.count === 0) return;

    await tx.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: now },
    });

    await tx.auditLog.create({
      data: {
        action: 'auth.email_verified',
        actorType: 'user',
        actorId: record.userId,
        entityType: 'user',
        entityId: record.userId,
        ip: clientIp(request),
        userAgent: request.headers.get('user-agent'),
        correlationId: requestId(request),
      },
    });
  });

  return noStore(ok({ status: 'verified' }));
}
