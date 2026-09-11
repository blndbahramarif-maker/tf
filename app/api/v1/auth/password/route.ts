import { checkPassword } from '@/domain/auth/password';
import { hashPassword, verifyPassword } from '@/infra/auth/password-hasher';
import { revokeAllSessions } from '@/infra/auth/session-service';
import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp, requireAccess } from '@/lib/api/guards';
import { noStore, parseBody } from '@/lib/api/route-helpers';
import { fail, ok, requestId } from '@/lib/api/respond';
import { changePasswordRequestSchema } from '@/shared/auth-contract';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/auth/password — change password.
 *
 * Requires step-up: a stolen access token alone must not be able to take over
 * an account by changing its password.
 *
 * On success EVERY session is revoked, including the caller's. If the password
 * was changed because of a compromise, leaving the attacker's session alive
 * would defeat the point.
 */
export async function POST(request: Request) {
  const access = await requireAccess(request, {
    all: ['account:manage_security'],
    requireVerifiedEmail: false,
    requireStepUp: true,
  });
  if (!access.ok) return access.response;

  const body = await parseBody(request, changePasswordRequestSchema);
  if (!body.ok) return body.response;

  const user = await prisma.user.findUnique({
    where: { id: access.value.principal.userId },
    select: { id: true, email: true, passwordHash: true },
  });
  if (!user?.passwordHash) {
    return fail('unauthenticated', 'Re-authentication failed.', { request, status: 401 });
  }

  if (!(await verifyPassword(user.passwordHash, body.value.currentPassword))) {
    return fail('unauthenticated', 'Current password is incorrect.', { request, status: 401 });
  }

  const policy = checkPassword(body.value.newPassword, user.email);
  if (!policy.ok) {
    return fail('validation_failed', 'Password does not meet the policy.', {
      request,
      fields: policy.reasons.map((reason) => ({ path: 'newPassword', message: reason })),
    });
  }

  const now = new Date();
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(body.value.newPassword), passwordChangedAt: now },
  });

  const revoked = await revokeAllSessions(user.id, 'password_changed');

  await tryWriteAuditLog(prisma, {
    action: 'auth.password_changed',
    actorType: 'user',
    actorId: user.id,
    entityType: 'user',
    entityId: user.id,
    after: { sessionsRevoked: revoked },
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  return noStore(ok({ status: 'password_changed', sessionsRevoked: revoked }));
}
