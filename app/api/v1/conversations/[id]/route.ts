import { loadConversationForViewer, loadMessages } from '@/infra/messaging/conversation-service';
import { prisma } from '@/infra/db/client';
import { isUuid, notFound, requireAccess } from '@/lib/api/guards';
import { enforceRateLimit } from '@/lib/api/route-helpers';
import { ok } from '@/lib/api/respond';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/conversations/{id} — one thread with a page of history.
 *
 * Participation is proven by the QUERY: `loadConversationForViewer` scopes on
 * the viewer's id, so a non-participant gets null and this route answers 404 —
 * the same answer a made-up id produces. A 403 would confirm the thread exists
 * and let anyone enumerate conversation ids.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAccess(request, { all: ['message:read_own'] });
  if (!access.ok) return access.response;

  const viewerId = access.value.principal.userId;
  const limited = await enforceRateLimit(request, RATE_LIMITS.readApi, viewerId);
  if (!limited.ok) return limited.response;

  const { id } = await context.params;
  // An unparseable id cannot name a row, and letting it reach Postgres turns
  // a 404 into a 500 carrying a database error.
  if (!isUuid(id)) return notFound(request);

  const conversation = await loadConversationForViewer(id, viewerId);
  if (conversation === null) return notFound(request);

  const url = new URL(request.url);
  const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
  const page = await loadMessages(id, {
    limit: Number.isFinite(limitRaw) ? limitRaw : 30,
    cursor: url.searchParams.get('cursor'),
  });

  const listing =
    conversation.listingId === null
      ? null
      : await prisma.listing.findUnique({
          where: { id: conversation.listingId },
          select: {
            id: true,
            title: true,
            slug: true,
            status: true,
            priceMinor: true,
            currency: true,
          },
        });

  const counterpartId =
    conversation.buyerId === viewerId ? conversation.sellerId : conversation.buyerId;
  const counterpart = await prisma.user.findUnique({
    where: { id: counterpartId },
    // An explicit allowlist: the other party's email is never exposed here.
    select: { profile: { select: { displayName: true } } },
  });

  return ok({
    conversation: {
      id: conversation.id,
      status: conversation.status,
      viewerRole: conversation.buyerId === viewerId ? 'buyer' : 'seller',
      counterpartName: counterpart?.profile?.displayName ?? '',
      listing:
        listing === null
          ? null
          : {
              id: listing.id,
              title: listing.title,
              slug: listing.slug,
              status: listing.status,
              priceMinor: listing.priceMinor === null ? null : listing.priceMinor.toString(),
              currency: listing.currency,
            },
    },
    messages: page.messages.map((message) => ({
      id: message.id,
      body: message.body,
      senderId: message.senderId,
      mine: message.senderId === viewerId,
      type: message.type,
      moderationStatus: message.moderationStatus,
      createdAt: message.createdAt.toISOString(),
    })),
    page: { nextCursor: page.nextCursor },
  });
}
