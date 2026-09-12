import { createOffer, loadOffersForUser } from '@/infra/messaging/offer-service';
import { appendMessage, loadConversationForViewer } from '@/infra/messaging/conversation-service';
import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp, requireAccess } from '@/lib/api/guards';
import { enforceRateLimit, parseBody } from '@/lib/api/route-helpers';
import { fail, ok, requestId } from '@/lib/api/respond';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';
import { createOfferSchema } from '@/shared/messaging-contract';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/offers — offers the caller is a party to.
 *
 * `role=buyer` narrows to offers made, `role=seller` to offers received.
 * Without it, both. There is no parameter that widens the result beyond the
 * caller's own offers.
 */
export async function GET(request: Request) {
  const access = await requireAccess(request, { all: ['offer:create'] });
  if (!access.ok) return access.response;

  const viewerId = access.value.principal.userId;
  const limited = await enforceRateLimit(request, RATE_LIMITS.readApi, viewerId);
  if (!limited.ok) return limited.response;

  const roleRaw = new URL(request.url).searchParams.get('role');
  const role = roleRaw === 'buyer' || roleRaw === 'seller' ? roleRaw : undefined;

  const offers = await loadOffersForUser(viewerId, { role });

  return ok({
    data: offers.map((offer) => ({
      id: offer.id,
      listingId: offer.listingId,
      listingTitle: offer.listingTitle,
      listingSlug: offer.listingSlug,
      // Money crosses the wire as an integer minor-unit string (ADR-0004).
      amountMinor: offer.amountMinor.toString(),
      currency: offer.currency,
      status: offer.status,
      expiresAt: offer.expiresAt.toISOString(),
      createdAt: offer.createdAt.toISOString(),
      counterpartName: offer.counterpartName,
      viewerRole: offer.viewerRole,
    })),
  });
}

/**
 * POST /api/v1/offers — make an offer.
 *
 * The buyer is the token subject. The amount is validated against the
 * LISTING's price, currency and category minimum, all re-read from the
 * database — the request supplies a candidate number and nothing else.
 *
 * No money moves here and none will in this phase. An accepted offer is a
 * record of agreement; charging the marketplace fee against it is Phase 7.
 */
export async function POST(request: Request) {
  const access = await requireAccess(request, { all: ['offer:create'] });
  if (!access.ok) return access.response;

  const viewerId = access.value.principal.userId;

  const limited = await enforceRateLimit(request, RATE_LIMITS.createOffer, viewerId, {
    keyBy: 'subject',
  });
  if (!limited.ok) return limited.response;

  const body = await parseBody(request, createOfferSchema);
  if (!body.ok) return body.response;

  // When the offer belongs to a thread, prove the caller is in that thread
  // before attaching it — otherwise an offer could be posted into someone
  // else's conversation.
  let conversationId: string | null = null;
  const requested = (body.value as { conversationId?: string }).conversationId;
  if (typeof requested === 'string' && requested !== '') {
    const conversation = await loadConversationForViewer(requested, viewerId);
    if (conversation === null) {
      return fail('not_found', 'Not found.', { request, status: 404 });
    }
    conversationId = conversation.id;
  }

  const created = await createOffer({
    listingId: body.value.listingId,
    buyerId: viewerId,
    amountMinor: body.value.amountMinor,
    currency: body.value.currency,
    message: body.value.message,
    expiresInDays: body.value.expiresInDays,
    asDraft: body.value.asDraft,
    conversationId,
  });

  if (!created.ok) {
    if (created.issue === 'listing_not_found') {
      return fail('not_found', 'Not found.', { request, status: 404 });
    }
    if (created.issue === 'own_listing') {
      return fail('conflict', 'You cannot make an offer on your own listing.', { request });
    }
    if (created.issue === 'offer_already_open') {
      return fail('conflict', 'You already have an open offer on this listing.', { request });
    }
    return fail('validation_failed', 'That offer could not be made.', {
      request,
      fields: [{ path: 'amountMinor', message: created.issue }],
    });
  }

  // A submitted offer posts a system message so the thread reads as one story
  // rather than the offer happening invisibly beside it.
  if (conversationId !== null && created.status === 'SUBMITTED') {
    await appendMessage({
      conversationId,
      senderId: viewerId,
      rawBody: body.value.message ?? 'Made an offer.',
    });
  }

  await tryWriteAuditLog(prisma, {
    action: 'offer.created',
    actorType: 'user',
    actorId: viewerId,
    entityType: 'offer',
    entityId: created.offerId,
    after: { listingId: body.value.listingId, status: created.status },
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  return ok({ id: created.offerId, status: created.status }, { status: 201 });
}
