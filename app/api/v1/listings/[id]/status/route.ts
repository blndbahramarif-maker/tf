import {
  availableTransitions,
  canTransition,
  publishTarget,
  type ListingActor,
  type ListingStatus,
} from '@/domain/catalogue/listing-status';
import { decidePublication, recordScreening } from '@/infra/safety/listing-screening';
import { loadListingForOwner } from '@/infra/catalogue/listing-service';
import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp, isUuid, notFound, requireAccess } from '@/lib/api/guards';
import { enforceRateLimit, parseBody } from '@/lib/api/route-helpers';
import { fail, ok, requestId } from '@/lib/api/respond';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';
import { listingTransitionSchema } from '@/shared/listing-contract';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/listings/{id}/status — move a listing through its lifecycle.
 *
 * ONE endpoint for every transition, decided by the state machine in
 * `src/domain/catalogue/listing-status.ts`. Adding a transition needs no new
 * route, and no route can invent a move the table does not permit.
 *
 * The caller's ACTOR is derived from permissions and ownership, never from the
 * request: a seller cannot claim to be a moderator by asking.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAccess(request, { any: ['listing:publish', 'listing:moderate'] });
  if (!access.ok) return access.response;

  const limited = await enforceRateLimit(
    request,
    RATE_LIMITS.writeApi,
    access.value.principal.userId,
  );
  if (!limited.ok) return limited.response;

  const { id } = await context.params;
  if (!isUuid(id)) return notFound(request);

  const listing = await loadListingForOwner(id);
  if (listing === null) return notFound(request);

  const principal = access.value.principal;
  const isOwner = listing.ownerUserId === principal.userId;
  const canModerate = principal.permissions.has('listing:moderate');

  // A non-owner without moderation rights must not learn the listing exists.
  if (!isOwner && !canModerate) return notFound(request);

  const body = await parseBody(request, listingTransitionSchema);
  if (!body.ok) return body.response;

  const from = listing.status as ListingStatus;
  // Moderators act as moderators even on their own listing — the stronger
  // capability is the one that matters for what the table permits.
  const actor: ListingActor =
    canModerate && !isOwner ? 'moderator' : isOwner ? 'owner' : 'moderator';

  // "Publish" is a request to become visible; the category's approval flag
  // decides whether that means ACTIVE or PENDING_REVIEW. No category name is
  // consulted anywhere.
  const requested = body.value.to as ListingStatus;
  let target =
    requested === 'ACTIVE' && actor === 'owner'
      ? publishTarget(listing.category.requiresApproval)
      : requested;

  const decision = canTransition(from, target, actor);
  if (!decision.allowed) {
    return fail(
      'conflict',
      decision.reason === 'actor_not_allowed'
        ? `You are not permitted to move this listing from ${from} to ${target}.`
        : `A listing cannot move from ${from} to ${target}.`,
      {
        request,
        status: decision.reason === 'actor_not_allowed' ? 403 : 409,
      },
    );
  }

  if (target === 'REJECTED' && !body.value.reason) {
    // A rejection without a reason is not actionable by the seller, and the
    // DSA expects a statement of reasons for moderation decisions.
    return fail('validation_failed', 'A rejection must include a reason.', {
      request,
      fields: [{ path: 'reason', message: 'required_for_rejection' }],
    });
  }

  const now = new Date();
  // Whether the caller ASKED to go live. Screening below can still divert that
  // to PENDING_REVIEW, so what actually happened is re-read afterwards.
  const publishRequested = target === 'ACTIVE';

  // Publishing requires at least one processed, approved image: a listing with
  // no picture is the most common low-quality and scam pattern.
  if (publishRequested) {
    const readyImages = await prisma.listingImage.count({
      where: { listingId: listing.id, uploadStatus: 'READY', moderationStatus: 'APPROVED' },
    });
    if (readyImages === 0) {
      return fail('conflict', 'Add at least one image before publishing.', { request });
    }

    /*
     * Prohibited-content screening, from the STORED text.
     *
     * The same `decidePublication` the dashboard action uses — one
     * implementation, so this route cannot drift into missing a rule type.
     *
     * A MODERATOR approving out of PENDING_REVIEW is exempt. They have read the
     * listing and decided; re-running a keyword match over their judgement
     * would make approval impossible for anything a FLAG rule touches, which is
     * exactly the set of listings that most needs a human to be able to say
     * yes.
     */
    if (actor === 'owner') {
      const publication = await decidePublication(listing.id);
      if (publication === null) return notFound(request);

      if (!publication.ok) {
        await recordScreening({
          listingId: listing.id,
          screening: publication.screening,
          outcome: 'blocked',
        });
        return fail(
          'conflict',
          'This listing cannot be published because its content matches a prohibited-item rule.',
          { request },
        );
      }

      if (publication.status === 'PENDING_REVIEW') {
        target = 'PENDING_REVIEW';
        await recordScreening({
          listingId: listing.id,
          screening: publication.screening,
          outcome: 'sent_for_review',
        });
      }
    }
  }

  /*
   * Re-read AFTER screening, not before.
   *
   * Screening can divert a publish to PENDING_REVIEW. Deciding "is this going
   * live" up front and reusing that answer would stamp `published_at` and an
   * expiry on a listing sitting in a moderation queue — publicly unlisted, but
   * carrying every field that says it went live.
   */
  const becomingActive = target === 'ACTIVE';

  await prisma.$transaction(async (tx) => {
    await tx.listing.update({
      where: { id: listing.id },
      data: {
        status: target,
        ...(becomingActive && listing.publishedAt === null ? { publishedAt: now } : {}),
        ...(becomingActive
          ? {
              expiresAt: new Date(
                now.getTime() + listing.category.listingDurationDays * 24 * 60 * 60_000,
              ),
            }
          : {}),
        ...(target === 'SOLD' ? { soldAt: now } : {}),
        ...(target === 'REJECTED' ? { rejectionReason: body.value.reason ?? null } : {}),
        ...(target === 'DRAFT' ? { rejectionReason: null } : {}),
        ...(target === 'REMOVED' ? { deletedAt: now } : {}),
      },
    });

    /*
     * A moderator's decision gets its own row, in the SAME transaction as the
     * status change.
     *
     * The audit log records that a transition happened; this records that a
     * HUMAN made a moderation decision, who they were and on what grounds.
     * Writing it in the same transaction means there is no window in which a
     * listing is removed with no record of who removed it.
     *
     * Only for moderator actions. A seller pausing their own listing is not
     * moderation, and filling the moderation history with it would bury the
     * decisions that matter.
     */
    if (
      actor === 'moderator' &&
      (target === 'REJECTED' || target === 'REMOVED' || target === 'ACTIVE')
    ) {
      await tx.moderationAction.create({
        data: {
          moderatorId: principal.userId,
          targetType: 'LISTING',
          targetId: listing.id,
          action: target === 'ACTIVE' ? 'approve' : target === 'REJECTED' ? 'reject' : 'remove',
          // The transition table already refuses REJECTED without a reason, so
          // this is never the empty string in practice.
          reason: body.value.reason ?? 'no reason given',
          notes: `from ${from}`,
        },
      });

      // Any open reports on this listing are now a reviewer's answered
      // question, not an outstanding one.
      if (target === 'REJECTED' || target === 'REMOVED') {
        await tx.report.updateMany({
          where: { targetType: 'LISTING', targetId: listing.id, status: 'OPEN' },
          data: { status: 'ACTIONED', resolvedAt: now, assignedTo: principal.userId },
        });
      }
    }
  });

  await tryWriteAuditLog(prisma, {
    action: 'listing.transitioned',
    actorType: actor === 'moderator' ? 'admin' : 'user',
    actorId: principal.userId,
    actorRole: principal.roles.join(','),
    entityType: 'listing',
    entityId: listing.id,
    before: { status: from },
    after: { status: target, requested, reason: body.value.reason ?? null },
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  return ok({
    id: listing.id,
    status: target,
    publishedAt: becomingActive ? now.toISOString() : (listing.publishedAt?.toISOString() ?? null),
    // Lets a UI render exactly the buttons that will work.
    availableTransitions: availableTransitions(target, actor).map((t) => ({
      to: t.to,
      description: t.description,
    })),
  });
}
