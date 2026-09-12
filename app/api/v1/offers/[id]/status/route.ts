import {
  OfferConflictError,
  loadOfferForParty,
  resolveActor,
  transitionOffer,
} from '@/infra/messaging/offer-service';
import { appendMessage } from '@/infra/messaging/conversation-service';
import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp, isUuid, notFound, requireAccess } from '@/lib/api/guards';
import { enforceRateLimit, parseBody } from '@/lib/api/route-helpers';
import { fail, ok, requestId } from '@/lib/api/respond';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';
import { offerTransitionSchema } from '@/shared/messaging-contract';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/offers/{id}/status — move an offer.
 *
 * ONE endpoint driven by the state machine, rather than accept/decline/withdraw
 * routes. Adding a transition then needs no new route and no new permission.
 *
 * Who may make which move is table data resolved against the DATABASE: the
 * buyer is the offer's `buyerId`, the seller is the listing's owner. A seller
 * attempting to withdraw a buyer's offer is refused by the table, not by a
 * hand-written check that could be forgotten on the next route.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  // Either half of the offer permissions gets you here; the transition table
  // decides what you can actually do.
  const access = await requireAccess(request, { any: ['offer:create', 'offer:respond'] });
  if (!access.ok) return access.response;

  const viewerId = access.value.principal.userId;
  const limited = await enforceRateLimit(request, RATE_LIMITS.writeApi, viewerId);
  if (!limited.ok) return limited.response;

  const { id } = await context.params;
  if (!isUuid(id)) return notFound(request);

  const offer = await loadOfferForParty(id, viewerId);
  if (offer === null) return notFound(request);

  const actor = resolveActor(offer, viewerId);
  if (actor === null) return notFound(request);

  const body = await parseBody(request, offerTransitionSchema);
  if (!body.ok) return body.response;

  let result;
  try {
    result = await transitionOffer({
      offer,
      actor,
      actorId: viewerId,
      to: body.value.to,
      note: body.value.note,
    });
  } catch (error) {
    // Someone else moved the offer between our read and our write.
    if (error instanceof OfferConflictError) {
      return fail('conflict', 'The offer changed. Reload and try again.', { request });
    }
    throw error;
  }

  if (!result.ok) {
    if (result.issue === 'expired') {
      return fail('conflict', 'This offer has expired.', { request });
    }
    const message =
      result.issue === 'wrong_actor'
        ? 'You cannot make that change to this offer.'
        : 'That change is not allowed from the offer’s current state.';
    return fail('conflict', message, { request });
  }

  // Keep the thread readable: a decision that happened silently beside the
  // conversation is a support ticket waiting to happen.
  if (offer.conversationId !== null) {
    await appendMessage({
      conversationId: offer.conversationId,
      senderId: viewerId,
      rawBody: body.value.note ?? `Offer ${result.status.toLowerCase()}.`,
    });
  }

  await tryWriteAuditLog(prisma, {
    action: 'offer.transitioned',
    actorType: 'user',
    actorId: viewerId,
    entityType: 'offer',
    entityId: offer.id,
    before: { status: offer.status },
    after: { status: result.status, actorRole: actor },
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  return ok({ id: offer.id, status: result.status });
}
