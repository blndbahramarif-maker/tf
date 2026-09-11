import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp, isUuid, notFound, requireAccess, requireOwner } from '@/lib/api/guards';
import { noStore, parseBody } from '@/lib/api/route-helpers';
import { ok, requestId } from '@/lib/api/respond';
import { updateSellerProfileRequestSchema } from '@/shared/auth-contract';

export const dynamic = 'force-dynamic';

/**
 * GET/PATCH /api/v1/seller-profiles/{id}
 *
 * The primary owned resource for Phase 3, and the main IDOR target.
 *
 * Both verbs resolve the profile from the database and compare its owner to
 * the authenticated principal. Support staff holding `user:read` may READ any
 * profile; nobody but the owner may WRITE one. A non-owner without that
 * permission gets 404 — the same response as a made-up id, so the endpoint
 * cannot be used to discover which profiles exist.
 */
async function loadProfile(id: string) {
  const profile = await prisma.sellerProfile.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      slug: true,
      displayName: true,
      about: true,
      sellerType: true,
      verificationStatus: true,
      payoutsEnabled: true,
      chargesEnabled: true,
      stripeAccountId: true,
      createdAt: true,
    },
  });
  // Ownership comes from the row, never from the URL.
  return profile === null ? null : { ...profile, ownerUserId: profile.userId };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAccess(request, { all: ['account:read_self'] });
  if (!access.ok) return access.response;

  const { id } = await context.params;
  // An unparseable id cannot name a resource. Answering with the same 404 as
  // "not yours" keeps the response uniform and keeps Prisma from throwing.
  if (!isUuid(id)) return notFound(request);

  const owned = await requireOwner(request, access.value.principal, () => loadProfile(id), {
    // Support and admin can read another seller's profile for assistance.
    overridePermission: 'user:read',
  });
  if (!owned.ok) return owned.response;

  const isOwner = owned.value.ownerUserId === access.value.principal.userId;

  return noStore(
    ok({
      id: owned.value.id,
      slug: owned.value.slug,
      displayName: owned.value.displayName,
      about: owned.value.about,
      sellerType: owned.value.sellerType,
      verificationStatus: owned.value.verificationStatus,
      createdAt: owned.value.createdAt.toISOString(),
      // Payment-account details are shown to the owner only. Staff reading
      // for support do not need the Stripe account id, so they do not get it.
      ...(isOwner
        ? {
            payoutsEnabled: owned.value.payoutsEnabled,
            chargesEnabled: owned.value.chargesEnabled,
            stripeAccountId: owned.value.stripeAccountId,
          }
        : {}),
    }),
  );
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAccess(request, { all: ['seller:update_own_profile'] });
  if (!access.ok) return access.response;

  const { id } = await context.params;
  // An unparseable id cannot name a resource. Answering with the same 404 as
  // "not yours" keeps the response uniform and keeps Prisma from throwing.
  if (!isUuid(id)) return notFound(request);

  // No override permission: writing someone else's profile is never allowed,
  // not even for an admin, through this route.
  const owned = await requireOwner(request, access.value.principal, () => loadProfile(id));
  if (!owned.ok) return owned.response;

  const body = await parseBody(request, updateSellerProfileRequestSchema);
  if (!body.ok) return body.response;

  const updated = await prisma.sellerProfile.update({
    where: { id: owned.value.id },
    data: {
      ...(body.value.displayName === undefined ? {} : { displayName: body.value.displayName }),
      ...(body.value.about === undefined ? {} : { about: body.value.about }),
    },
    select: { id: true, displayName: true, about: true },
  });

  await tryWriteAuditLog(prisma, {
    action: 'seller_profile.updated',
    actorType: 'user',
    actorId: access.value.principal.userId,
    entityType: 'seller_profile',
    entityId: updated.id,
    before: { displayName: owned.value.displayName, about: owned.value.about },
    after: { displayName: updated.displayName, about: updated.about },
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  return noStore(ok(updated));
}
