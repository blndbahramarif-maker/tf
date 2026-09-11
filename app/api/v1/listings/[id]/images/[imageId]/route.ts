import { processImage } from '@/infra/images/processor';
import { loadListingForOwner } from '@/infra/catalogue/listing-service';
import { getStorage } from '@/infra/storage';
import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp, isUuid, notFound, requireAccess, requireOwner } from '@/lib/api/guards';
import { enforceRateLimit, parseBody } from '@/lib/api/route-helpers';
import { fail, ok, requestId } from '@/lib/api/respond';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';
import { finaliseImageSchema } from '@/shared/listing-contract';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/listings/{id}/images/{imageId} — validate and re-encode.
 *
 * This is where uploaded bytes are treated as hostile: format is decided by
 * magic bytes (never the client's Content-Type), the image is FULLY
 * RE-ENCODED — stripping EXIF including GPS, and destroying anything appended
 * to a valid image — and derivatives are written under fresh keys.
 *
 * The original is DELETED once derivatives exist. It is attacker-supplied and
 * is never served.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; imageId: string }> },
) {
  const access = await requireAccess(request, { all: ['listing:update_own'] });
  if (!access.ok) return access.response;

  const limited = await enforceRateLimit(
    request,
    RATE_LIMITS.writeApi,
    access.value.principal.userId,
  );
  if (!limited.ok) return limited.response;

  const { id, imageId } = await context.params;
  if (!isUuid(id) || !isUuid(imageId)) return notFound(request);

  const owned = await requireOwner(request, access.value.principal, () => loadListingForOwner(id));
  if (!owned.ok) return owned.response;

  const body = await parseBody(request, finaliseImageSchema);
  if (!body.ok) return body.response;

  // Scoped by listing id as well as image id: an image id from another listing
  // cannot be finalised through this listing.
  const image = await prisma.listingImage.findFirst({
    where: { id: imageId, listingId: owned.value.id },
    select: { id: true, storageKey: true, uploadStatus: true, isPrimary: true },
  });
  if (!image) return notFound(request);
  if (image.uploadStatus === 'READY') {
    return fail('conflict', 'This image has already been processed.', { request });
  }

  const storage = getStorage();

  let original: Buffer;
  try {
    original = await storage.getObject(image.storageKey);
  } catch {
    await prisma.listingImage.update({
      where: { id: image.id },
      data: { uploadStatus: 'FAILED', failureReason: 'upload_missing' },
    });
    return fail('conflict', 'No uploaded file was found for this image.', { request });
  }

  await prisma.listingImage.update({
    where: { id: image.id },
    data: { uploadStatus: 'PROCESSING' },
  });

  const result = await processImage(original);

  if (!result.ok) {
    await prisma.listingImage.update({
      where: { id: image.id },
      data: { uploadStatus: 'FAILED', failureReason: result.reason },
    });
    // The rejected original is removed immediately — there is no reason to
    // keep bytes we have refused.
    await storage.deleteObject(image.storageKey).catch(() => undefined);

    await tryWriteAuditLog(prisma, {
      action: 'listing.image_rejected',
      actorType: 'user',
      actorId: access.value.principal.userId,
      entityType: 'listing_image',
      entityId: image.id,
      after: { reason: result.reason, detail: result.detail ?? null },
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      correlationId: requestId(request),
    });

    return fail('validation_failed', `Image rejected: ${result.reason}.`, {
      request,
      fields: [{ path: 'file', message: result.reason }],
    });
  }

  const variants: Record<string, string> = {};
  let primaryUrl = '';
  for (const variant of result.variants) {
    const key = `${image.storageKey}-${variant.name}.webp`;
    await storage.putObject(key, variant.body, variant.contentType);
    variants[variant.name] = storage.publicUrl(key);
    if (variant.name === 'card') primaryUrl = storage.publicUrl(key);
  }
  primaryUrl ||= Object.values(variants)[0] ?? '';

  // Drop the untrusted original now that safe derivatives exist.
  await storage.deleteObject(image.storageKey).catch(() => undefined);

  const wantsPrimary = body.value.isPrimary;

  /*
   * A listing has at most one primary image, enforced by the partial unique
   * index `listing_images_one_primary_per_listing`. That index is NOT
   * deferrable, so a promotion must demote the incumbent FIRST or the write is
   * rejected mid-transaction — which is why this is a transaction and not a
   * single update.
   */
  const updated = await prisma.$transaction(async (tx) => {
    if (wantsPrimary === true) {
      await tx.listingImage.updateMany({
        where: { listingId: owned.value.id, isPrimary: true, id: { not: image.id } },
        data: { isPrimary: false },
      });
    }

    // Demoting the only primary would leave a listing with images and none
    // marked primary, so the next image by position takes over. If there is no
    // other image, the demotion is refused rather than breaking the invariant.
    let nextPrimaryId: string | null = null;
    let keepPrimary = false;
    if (wantsPrimary === false && image.isPrimary) {
      const next = await tx.listingImage.findFirst({
        where: { listingId: owned.value.id, id: { not: image.id }, uploadStatus: 'READY' },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      if (next === null) {
        keepPrimary = true;
      } else {
        nextPrimaryId = next.id;
      }
    }

    const row = await tx.listingImage.update({
      where: { id: image.id },
      data: {
        uploadStatus: 'READY',
        // The DETECTED format, not anything the client claimed.
        contentType: `image/${result.detectedFormat}`,
        byteSize: result.byteSize,
        checksumSha256: result.checksumSha256,
        width: result.width,
        height: result.height,
        url: primaryUrl,
        variants: variants as never,
        processedAt: new Date(),
        failureReason: null,
        ...(body.value.altText === undefined ? {} : { altText: body.value.altText }),
        ...(wantsPrimary === undefined || keepPrimary ? {} : { isPrimary: wantsPrimary }),
        // Auto-approved at launch; the moderation queue lands in Phase 9, and
        // this column is what it will gate on.
        moderationStatus: 'APPROVED',
      },
      select: { id: true, url: true, width: true, height: true, isPrimary: true, position: true },
    });

    if (nextPrimaryId !== null) {
      await tx.listingImage.update({ where: { id: nextPrimaryId }, data: { isPrimary: true } });
    }

    return row;
  });

  await tryWriteAuditLog(prisma, {
    action: 'listing.image_uploaded',
    actorType: 'user',
    actorId: access.value.principal.userId,
    entityType: 'listing_image',
    entityId: image.id,
    after: {
      format: result.detectedFormat,
      bytes: result.byteSize,
      variants: Object.keys(variants),
    },
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  return ok({ image: { ...updated, variants } });
}

/** DELETE /api/v1/listings/{id}/images/{imageId} — remove an image. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; imageId: string }> },
) {
  const access = await requireAccess(request, { all: ['listing:update_own'] });
  if (!access.ok) return access.response;

  const { id, imageId } = await context.params;
  if (!isUuid(id) || !isUuid(imageId)) return notFound(request);

  const owned = await requireOwner(request, access.value.principal, () => loadListingForOwner(id));
  if (!owned.ok) return owned.response;

  const image = await prisma.listingImage.findFirst({
    where: { id: imageId, listingId: owned.value.id },
    select: { id: true, storageKey: true, variants: true, isPrimary: true },
  });
  if (!image) return notFound(request);

  const storage = getStorage();
  await storage.deleteObject(image.storageKey).catch(() => undefined);
  for (const name of ['thumb', 'card', 'full']) {
    await storage.deleteObject(`${image.storageKey}-${name}.webp`).catch(() => undefined);
  }

  await prisma.$transaction(async (tx) => {
    await tx.listingImage.delete({ where: { id: image.id } });

    // Promote another image so a listing is never left without a primary.
    if (image.isPrimary) {
      const next = await tx.listingImage.findFirst({
        where: { listingId: owned.value.id, uploadStatus: 'READY' },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      if (next) {
        await tx.listingImage.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
    }
  });

  await tryWriteAuditLog(prisma, {
    action: 'listing.image_deleted',
    actorType: 'user',
    actorId: access.value.principal.userId,
    entityType: 'listing_image',
    entityId: image.id,
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  return ok({ status: 'deleted' });
}
