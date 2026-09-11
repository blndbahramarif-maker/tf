import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp, requireAccess } from '@/lib/api/guards';
import { noStore } from '@/lib/api/route-helpers';
import { ok, requestId } from '@/lib/api/respond';
import { paginationQuerySchema } from '@/shared/api-contract';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/admin/users
 *
 * The staff-only surface for Phase 3. It exists to exercise the permission
 * guard and the mandatory-two-factor rule for staff roles — it is NOT the
 * admin console, which is Phase 11.
 *
 * Requires `user:read`, held by support, moderator, admin and super_admin.
 * Finance does not hold it, which is the separation of duties working: the
 * role that can move money cannot browse the user base.
 */
export async function GET(request: Request) {
  const access = await requireAccess(request, { all: ['user:read'] });
  if (!access.ok) return access.response;

  const url = new URL(request.url);
  const pagination = paginationQuerySchema.safeParse({
    limit: url.searchParams.get('limit') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
  });
  const limit = pagination.success ? pagination.data.limit : 24;

  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      email: true,
      status: true,
      emailVerifiedAt: true,
      createdAt: true,
      profile: { select: { displayName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  // Reading the user base is itself sensitive, so it is audited.
  await tryWriteAuditLog(prisma, {
    action: 'admin.users_listed',
    actorType: 'admin',
    actorId: access.value.principal.userId,
    actorRole: access.value.principal.roles.join(','),
    entityType: 'user',
    entityId: null,
    after: { count: users.length },
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  return noStore(
    ok({
      data: users.map((user) => ({
        id: user.id,
        email: user.email,
        displayName: user.profile?.displayName ?? null,
        status: user.status,
        emailVerified: user.emailVerifiedAt !== null,
        createdAt: user.createdAt.toISOString(),
      })),
      page: { nextCursor: null, hasMore: false },
    }),
  );
}
