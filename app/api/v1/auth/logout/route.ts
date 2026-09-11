import { revokeFamily } from '@/infra/auth/session-service';
import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp, requireAccess } from '@/lib/api/guards';
import { noStore } from '@/lib/api/route-helpers';
import { ok, requestId } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/auth/logout
 *
 * Revokes the current session's family. Requires only authentication — no
 * permission and no verified email, because a user must always be able to end
 * their own session.
 */
export async function POST(request: Request) {
  const access = await requireAccess(request, {
    all: ['account:read_self'],
    requireVerifiedEmail: false,
  });
  if (!access.ok) return access.response;

  const revoked = await revokeFamily(access.value.familyId, 'logout');

  await tryWriteAuditLog(prisma, {
    action: 'auth.logout',
    actorType: 'user',
    actorId: access.value.principal.userId,
    entityType: 'refresh_token_family',
    entityId: null,
    after: { familyId: access.value.familyId, revoked },
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  return noStore(ok({ status: 'signed_out', sessionsRevoked: revoked }));
}
