import { loadOfferForParty, loadOfferHistory, resolveActor } from '@/infra/messaging/offer-service';
import { availableTransitions, hasExpired } from '@/domain/offers/offer-status';
import { isUuid, notFound, requireAccess } from '@/lib/api/guards';
import { enforceRateLimit } from '@/lib/api/route-helpers';
import { ok } from '@/lib/api/respond';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/offers/{id} — one offer with its audit trail.
 *
 * Visible to the buyer and to the listing's seller, and to nobody else. A
 * third party gets 404, identical to a made-up id.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAccess(request, { all: ['offer:create'] });
  if (!access.ok) return access.response;

  const viewerId = access.value.principal.userId;
  const limited = await enforceRateLimit(request, RATE_LIMITS.readApi, viewerId);
  if (!limited.ok) return limited.response;

  const { id } = await context.params;
  if (!isUuid(id)) return notFound(request);

  const offer = await loadOfferForParty(id, viewerId);
  if (offer === null) return notFound(request);

  // Role comes from the database rows, never from the request.
  const actor = resolveActor(offer, viewerId);
  if (actor === null) return notFound(request);

  const history = await loadOfferHistory(id);
  const expired = hasExpired(offer.status, offer.expiresAt, new Date());

  return ok({
    offer: {
      id: offer.id,
      listingId: offer.listingId,
      listingTitle: offer.listingTitle,
      listingSlug: offer.listingSlug,
      conversationId: offer.conversationId,
      amountMinor: offer.amountMinor.toString(),
      currency: offer.currency,
      // Expiry is evaluated on read; a stale SUBMITTED row reports EXPIRED
      // rather than pretending it is still open because no sweeper ran.
      status: expired ? 'EXPIRED' : offer.status,
      expiresAt: offer.expiresAt.toISOString(),
      message: offer.message,
      viewerRole: actor,
    },
    /** What THIS actor may do next, straight from the transition table. */
    availableTransitions: expired
      ? []
      : availableTransitions(offer.status, actor).map((transition) => ({
          to: transition.to,
          description: transition.description,
        })),
    history: history.map((event) => ({
      id: event.id,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      actorRole: event.actorRole,
      amountMinor: event.amountMinor.toString(),
      currency: event.currency,
      note: event.note,
      createdAt: event.createdAt.toISOString(),
    })),
  });
}
