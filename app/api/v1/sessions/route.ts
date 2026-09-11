import { revokeAllSessions } from '@/infra/auth/session-service';
import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp, requireAccess } from '@/lib/api/guards';
import { noStore } from '@/lib/api/route-helpers';
import { ok, requestId } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/sessions — the caller's own active sessions.
 *
 * Scoped by `userId` from the token, never by a client-supplied filter, so
 * there is no parameter that could widen the result set.
 */
export async function GET(request: Request) {
  const access = await requireAccess(request, {
    all: ['account:read_self'],
    requireVerifiedEmail: false,
  });
  if (!access.ok) return access.response;

  const sessions = await prisma.refreshToken.findMany({
    where: { userId: access.value.principal.userId, revokedAt: null },
    select: {
      id: true,
      familyId: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      ip: true,
      userAgent: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return noStore(
    ok({
      data: sessions.map((session) => ({
        id: session.id,
        familyId: session.familyId,
        current: session.familyId === access.value.familyId,
        createdAt: session.createdAt.toISOString(),
        lastUsedAt: session.lastUsedAt?.toISOString() ?? null,
        expiresAt: session.expiresAt.toISOString(),
        ip: session.ip,
        userAgent: session.userAgent,
      })),
    }),
  );
}

/**
 * DELETE /api/v1/sessions — revoke every session for this user.
 *
 * Requires step-up: this is how someone locks an attacker out, and it must not
 * be reachable with only a stolen access token.
 */
export async function DELETE(request: Request) {
  const access = await requireAccess(request, {
    all: ['account:manage_security'],
    requireVerifiedEmail: false,
    requireStepUp: true,
  });
  if (!access.ok) return access.response;

  const revoked = await revokeAllSessions(access.value.principal.userId, 'user_revoked_all');

  await tryWriteAuditLog(prisma, {
    action: 'auth.logout_all',
    actorType: 'user',
    actorId: access.value.principal.userId,
    entityType: 'user',
    entityId: access.value.principal.userId,
    after: { revoked },
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  return noStore(ok({ status: 'revoked', sessionsRevoked: revoked }));
}
