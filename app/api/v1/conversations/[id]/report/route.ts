import { loadConversationForViewer } from '@/infra/messaging/conversation-service';
import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp, isUuid, notFound, requireAccess } from '@/lib/api/guards';
import { enforceRateLimit, parseBody } from '@/lib/api/route-helpers';
import { ok, requestId } from '@/lib/api/respond';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';
import { reportSchema } from '@/shared/messaging-contract';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/conversations/{id}/report — report a conversation.
 *
 * The abuse foundation, not the moderation dashboard: this records a report
 * and marks the thread, so a reviewer has something to work from when the
 * queue is built in a later phase.
 *
 * Reporting does NOT delete or edit any message. Evidence that disappears when
 * it is reported is useless, and the reported party is entitled to have their
 * words judged as written.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAccess(request, { all: ['report:create'] });
  if (!access.ok) return access.response;

  const viewerId = access.value.principal.userId;
  const limited = await enforceRateLimit(request, RATE_LIMITS.writeApi, viewerId, {
    keyBy: 'subject',
  });
  if (!limited.ok) return limited.response;

  const { id } = await context.params;
  if (!isUuid(id)) return notFound(request);

  // Only a participant can report a thread — otherwise reporting becomes a way
  // to probe which conversation ids exist.
  const conversation = await loadConversationForViewer(id, viewerId);
  if (conversation === null) return notFound(request);

  const body = await parseBody(request, reportSchema);
  if (!body.ok) return body.response;

  const report = await prisma.$transaction(async (tx) => {
    const created = await tx.report.create({
      data: {
        reporterId: viewerId,
        targetType: 'CONVERSATION',
        targetId: id,
        reasonCode: body.value.reasonCode,
        details: body.value.details ?? null,
        status: 'OPEN',
      },
      select: { id: true },
    });

    // Marks the thread for a reviewer. Messages are untouched.
    await tx.conversation.update({ where: { id }, data: { status: 'REPORTED' } });

    return created;
  });

  await tryWriteAuditLog(prisma, {
    action: 'conversation.reported',
    actorType: 'user',
    actorId: viewerId,
    entityType: 'conversation',
    entityId: id,
    after: { reportId: report.id, reasonCode: body.value.reasonCode },
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  return ok({ reportId: report.id, status: 'received' }, { status: 201 });
}
