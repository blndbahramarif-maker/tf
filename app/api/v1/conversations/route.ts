import { prisma } from '@/infra/db/client';
import { appendMessage, loadInbox } from '@/infra/messaging/conversation-service';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp, requireAccess } from '@/lib/api/guards';
import { enforceRateLimit, parseBody } from '@/lib/api/route-helpers';
import { fail, ok, requestId } from '@/lib/api/respond';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';
import { startConversationSchema } from '@/shared/messaging-contract';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/conversations — the caller's inbox.
 *
 * Scoped by the user id from the token. There is no "all conversations" query
 * and no user-id parameter: the only inbox a caller can ask for is their own.
 */
export async function GET(request: Request) {
  const access = await requireAccess(request, { all: ['message:read_own'] });
  if (!access.ok) return access.response;

  const limited = await enforceRateLimit(
    request,
    RATE_LIMITS.readApi,
    access.value.principal.userId,
  );
  if (!limited.ok) return limited.response;

  const url = new URL(request.url);
  const beforeRaw = url.searchParams.get('before');
  const before =
    beforeRaw !== null && !Number.isNaN(Date.parse(beforeRaw)) ? new Date(beforeRaw) : undefined;

  const conversations = await loadInbox(access.value.principal.userId, { before });

  return ok({
    data: conversations.map((entry) => ({
      id: entry.id,
      listingId: entry.listingId,
      listingTitle: entry.listingTitle,
      listingSlug: entry.listingSlug,
      counterpartName: entry.counterpartName,
      viewerRole: entry.viewerRole,
      status: entry.status,
      lastMessageAt: entry.lastMessageAt?.toISOString() ?? null,
      lastMessagePreview: entry.lastMessagePreview,
      unreadCount: entry.unreadCount,
    })),
  });
}

/**
 * POST /api/v1/conversations — contact a seller about a listing.
 *
 * The buyer is the token subject; the seller is read from the listing. Neither
 * party can be supplied by the request, which is what prevents a caller from
 * inserting themselves into — or someone else into — a conversation.
 *
 * Conversations are unique per (listing, buyer, seller), so contacting the
 * same seller about the same listing twice appends to the existing thread
 * rather than fragmenting the history across duplicates.
 */
export async function POST(request: Request) {
  const access = await requireAccess(request, { all: ['message:send'] });
  if (!access.ok) return access.response;

  const viewerId = access.value.principal.userId;

  const limited = await enforceRateLimit(request, RATE_LIMITS.startConversation, viewerId, {
    keyBy: 'subject',
  });
  if (!limited.ok) return limited.response;

  const body = await parseBody(request, startConversationSchema);
  if (!body.ok) return body.response;

  const listing = await prisma.listing.findFirst({
    where: { id: body.value.listingId, status: 'ACTIVE', deletedAt: null },
    select: { id: true, sellerProfile: { select: { userId: true } } },
  });
  // A draft, paused or non-existent listing gives the same answer.
  if (listing === null) {
    return fail('not_found', 'Not found.', { request, status: 404 });
  }

  const sellerId = listing.sellerProfile.userId;
  if (sellerId === viewerId) {
    return fail('conflict', 'You cannot start a conversation with yourself.', { request });
  }

  const conversation = await prisma.conversation.upsert({
    where: {
      listingId_buyerId_sellerId: { listingId: listing.id, buyerId: viewerId, sellerId },
    },
    create: { listingId: listing.id, buyerId: viewerId, sellerId, status: 'OPEN' },
    update: {},
    select: { id: true },
  });

  const sent = await appendMessage({
    conversationId: conversation.id,
    senderId: viewerId,
    rawBody: body.value.body,
  });

  if (!sent.ok) {
    return fail('validation_failed', 'That message could not be sent.', {
      request,
      fields: [{ path: 'body', message: sent.issue }],
    });
  }

  await tryWriteAuditLog(prisma, {
    action: 'conversation.started',
    actorType: 'user',
    actorId: viewerId,
    entityType: 'conversation',
    entityId: conversation.id,
    after: { listingId: listing.id, flagged: sent.flagged },
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  return ok(
    { conversationId: conversation.id, messageId: sent.messageId, flagged: sent.flagged },
    { status: 201 },
  );
}
