import { appendMessage, loadConversationForViewer } from '@/infra/messaging/conversation-service';
import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp, isUuid, notFound, requireAccess } from '@/lib/api/guards';
import { enforceRateLimit, parseBody } from '@/lib/api/route-helpers';
import { fail, ok, requestId } from '@/lib/api/respond';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';
import { sendMessageSchema } from '@/shared/messaging-contract';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/conversations/{id}/messages — send a message.
 *
 * The sender is the token subject and the conversation is scoped to them, so
 * there is no way to post into someone else's thread or to post AS someone
 * else. Rate limited per user: spam comes from an account, not an address.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAccess(request, { all: ['message:send'] });
  if (!access.ok) return access.response;

  const viewerId = access.value.principal.userId;

  const limited = await enforceRateLimit(request, RATE_LIMITS.sendMessage, viewerId, {
    // Per ACCOUNT, not per address: a spammer rotating mobile IPs would
    // otherwise get a fresh allowance with every one.
    keyBy: 'subject',
  });
  if (!limited.ok) return limited.response;

  const { id } = await context.params;
  if (!isUuid(id)) return notFound(request);

  const conversation = await loadConversationForViewer(id, viewerId);
  if (conversation === null) return notFound(request);

  // A blocked or archived thread accepts no new messages.
  if (conversation.status === 'BLOCKED') {
    return fail('forbidden', 'This conversation is closed.', { request, status: 403 });
  }

  const body = await parseBody(request, sendMessageSchema);
  if (!body.ok) return body.response;

  const sent = await appendMessage({
    conversationId: id,
    senderId: viewerId,
    rawBody: body.value.body,
  });

  if (!sent.ok) {
    // Refused with a reason, never silently truncated or edited.
    return fail('validation_failed', 'That message could not be sent.', {
      request,
      fields: [{ path: 'body', message: sent.issue }],
    });
  }

  if (sent.flagged) {
    // Security-sensitive: a message that tripped the risk rules is audited so
    // the decision is reviewable later.
    await tryWriteAuditLog(prisma, {
      action: 'message.flagged',
      actorType: 'user',
      actorId: viewerId,
      entityType: 'message',
      entityId: sent.messageId,
      after: { conversationId: id },
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      correlationId: requestId(request),
    });
  }

  return ok({ messageId: sent.messageId, flagged: sent.flagged }, { status: 201 });
}
