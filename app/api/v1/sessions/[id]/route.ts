import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp, isUuid, notFound, requireAccess, requireOwner } from '@/lib/api/guards';
import { noStore } from '@/lib/api/route-helpers';
import { ok, requestId } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/v1/sessions/{id} — revoke ONE session.
 *
 * An owned resource addressed by id, so ownership is verified before anything
 * is changed. A session id belonging to another user returns 404: identical to
 * a non-existent id, so this cannot be used to discover which ids are real.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAccess(request, {
    all: ['account:manage_security'],
    requireVerifiedEmail: false,
  });
  if (!access.ok) return access.response;

  const { id } = await context.params;
  // An unparseable id cannot name a resource. Answering with the same 404 as
  // "not yours" keeps the response uniform and keeps Prisma from throwing.
  if (!isUuid(id)) return notFound(request);

  const owned = await requireOwner(request, access.value.principal, async () => {
    const session = await prisma.refreshToken.findUnique({
      where: { id },
      select: { id: true, userId: true, familyId: true, revokedAt: true },
    });
    // The id from the URL is a claim; `ownerUserId` comes from the database.
    return session === null ? null : { ...session, ownerUserId: session.userId };
  });
  if (!owned.ok) return owned.response;

  await prisma.refreshToken.updateMany({
    where: { familyId: owned.value.familyId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'user_revoked_session' },
  });

  await tryWriteAuditLog(prisma, {
    action: 'session.revoked',
    actorType: 'user',
    actorId: access.value.principal.userId,
    entityType: 'refresh_token',
    entityId: owned.value.id,
    after: { familyId: owned.value.familyId },
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  return noStore(ok({ status: 'revoked' }));
}
