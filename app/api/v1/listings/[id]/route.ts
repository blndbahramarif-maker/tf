import { validateAttributes } from '@/domain/catalogue/attributes';
import { isEditable, isPubliclyVisible } from '@/domain/catalogue/listing-status';
import { loadAttributeDefinitions, loadCategoryBySlug } from '@/infra/catalogue/category-service';
import {
  loadListingForOwner,
  serialiseListing,
  writeAttributes,
} from '@/infra/catalogue/listing-service';
import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp, isUuid, notFound, requireAccess, requireOwner } from '@/lib/api/guards';
import { enforceRateLimit, parseBody } from '@/lib/api/route-helpers';
import { fail, ok, requestId } from '@/lib/api/respond';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';
import { updateListingSchema } from '@/shared/listing-contract';
import { resolvePrincipal } from '@/lib/api/principal';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/listings/{id}
 *
 * Public for an ACTIVE listing; otherwise owner-only (or staff with
 * `listing:moderate`, who need to see what they are moderating).
 *
 * A draft belonging to someone else returns 404, identical to a listing that
 * does not exist — so this cannot be used to discover unpublished ids.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const limited = await enforceRateLimit(request, RATE_LIMITS.readApi);
  if (!limited.ok) return limited.response;

  const { id } = await context.params;
  if (!isUuid(id)) return notFound(request);

  const listing = await loadListingForOwner(id);
  if (listing === null) return notFound(request);

  if (isPubliclyVisible(listing.status)) {
    // Counted for the seller's analytics. Best-effort: a failed increment must
    // never fail the page.
    void prisma.listing
      .update({ where: { id: listing.id }, data: { viewCount: { increment: 1 } } })
      .catch(() => undefined);
    return ok({ listing: serialiseListing(listing), viewerIsOwner: false });
  }

  // Not public — identity is required, and it comes only from the token.
  const resolution = await resolvePrincipal(request);
  if (!resolution.ok) return notFound(request);

  const principal = resolution.value.principal;
  const isOwner = listing.ownerUserId === principal.userId;
  const canModerate = principal.permissions.has('listing:moderate');

  if (!isOwner && !canModerate) return notFound(request);

  return ok({ listing: serialiseListing(listing), viewerIsOwner: isOwner });
}

/**
 * PATCH /api/v1/listings/{id} — owner edits.
 *
 * Only permitted in editable states. An ACTIVE listing must be taken back to
 * DRAFT or PAUSED first, so a published listing cannot silently become a
 * different item after buyers have seen it.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAccess(request, { all: ['listing:update_own'] });
  if (!access.ok) return access.response;

  const limited = await enforceRateLimit(
    request,
    RATE_LIMITS.writeApi,
    access.value.principal.userId,
  );
  if (!limited.ok) return limited.response;

  const { id } = await context.params;
  if (!isUuid(id)) return notFound(request);

  // No override permission: nobody edits another seller's listing content.
  const owned = await requireOwner(request, access.value.principal, () => loadListingForOwner(id));
  if (!owned.ok) return owned.response;

  const listing = owned.value;

  if (!isEditable(listing.status)) {
    return fail('conflict', `A listing in ${listing.status} cannot be edited. Pause it first.`, {
      request,
    });
  }

  const body = await parseBody(request, updateListingSchema);
  if (!body.ok) return body.response;
  const input = body.value;

  const category = await loadCategoryBySlug(listing.category.slug);
  if (!category)
    return fail('conflict', 'This listing’s category is no longer available.', { request });

  // Attributes are re-validated in full on every edit, because a partial
  // update could otherwise leave a required field cleared.
  const definitions = await loadAttributeDefinitions(category);
  const submitted = input.attributes ?? ((listing.attributes ?? {}) as Record<string, unknown>);
  const validated = validateAttributes(definitions, submitted);
  if (!validated.ok) {
    return fail('validation_failed', 'Category attributes are invalid.', {
      request,
      fields: validated.issues.map((issue) => ({
        path: `attributes.${issue.key}`,
        message: issue.message,
      })),
    });
  }

  let cityId = listing.cityId;
  if (input.citySlug !== undefined) {
    if (input.citySlug === null) {
      cityId = null;
    } else {
      const city = await prisma.city.findFirst({
        where: { slug: input.citySlug, countryId: listing.countryId, isActive: true },
        select: { id: true },
      });
      if (!city) {
        return fail('validation_failed', 'Unknown city for this listing’s country.', {
          request,
          fields: [{ path: 'citySlug', message: 'unknown_city' }],
        });
      }
      cityId = city.id;
    }
  }

  const priceMinor = input.priceMinor === undefined ? listing.priceMinor : BigInt(input.priceMinor);
  const priceType = input.priceType ?? listing.priceType;
  if (priceType === 'FIXED' && priceMinor === null) {
    return fail('validation_failed', 'A fixed-price listing needs a price.', {
      request,
      fields: [{ path: 'priceMinor', message: 'required_for_fixed_price' }],
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.listing.update({
      where: { id: listing.id },
      data: {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.contentLocale === undefined ? {} : { contentLocale: input.contentLocale }),
        ...(input.condition === undefined ? {} : { condition: input.condition }),
        ...(input.quantity === undefined ? {} : { quantity: input.quantity }),
        ...(input.currency === undefined ? {} : { currency: input.currency }),
        priceMinor,
        priceType,
        cityId,
      },
    });

    await writeAttributes(tx, {
      listingId: listing.id,
      rows: validated.rows,
      json: validated.json,
    });
  });

  await tryWriteAuditLog(prisma, {
    action: 'listing.updated',
    actorType: 'user',
    actorId: access.value.principal.userId,
    entityType: 'listing',
    entityId: listing.id,
    before: { title: listing.title, priceMinor: listing.priceMinor?.toString() ?? null },
    after: { title: input.title ?? listing.title, priceMinor: priceMinor?.toString() ?? null },
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  const updated = await loadListingForOwner(listing.id);
  return ok({ listing: updated === null ? null : serialiseListing(updated) });
}

/** DELETE /api/v1/listings/{id} — soft delete, owner only. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAccess(request, { all: ['listing:delete_own'] });
  if (!access.ok) return access.response;

  const { id } = await context.params;
  if (!isUuid(id)) return notFound(request);

  const owned = await requireOwner(request, access.value.principal, () => loadListingForOwner(id));
  if (!owned.ok) return owned.response;

  // Soft delete: order and audit history must keep resolving the listing.
  await prisma.listing.update({
    where: { id: owned.value.id },
    data: { status: 'REMOVED', deletedAt: new Date() },
  });

  await tryWriteAuditLog(prisma, {
    action: 'listing.transitioned',
    actorType: 'user',
    actorId: access.value.principal.userId,
    entityType: 'listing',
    entityId: owned.value.id,
    after: { from: owned.value.status, to: 'REMOVED', deleted: true },
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  return ok({ status: 'removed' });
}
