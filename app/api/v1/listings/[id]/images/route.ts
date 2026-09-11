import { MAX_UPLOAD_BYTES } from '@/infra/images/processor';
import { loadListingForOwner } from '@/infra/catalogue/listing-service';
import { getStorage } from '@/infra/storage';
import { prisma } from '@/infra/db/client';
import { isUuid, notFound, requireAccess, requireOwner } from '@/lib/api/guards';
import { enforceRateLimit, parseBody } from '@/lib/api/route-helpers';
import { fail, ok } from '@/lib/api/respond';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';
import { createImageUploadSchema } from '@/shared/listing-contract';

export const dynamic = 'force-dynamic';

/** Upload tickets are short-lived: they exist to be used immediately. */
const UPLOAD_TTL_SECONDS = 15 * 60;

/**
 * POST /api/v1/listings/{id}/images — begin an upload.
 *
 * Returns an upload ticket and a placeholder row in PENDING_UPLOAD. Bytes go
 * to storage, NOT through this endpoint — in production that is an S3
 * presigned PUT, so image data never transits the API
 * (docs/08-security-architecture.md).
 *
 * The row is created first so an abandoned upload is visible and can be swept,
 * rather than leaving an orphaned object in the bucket.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
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

  const owned = await requireOwner(request, access.value.principal, () => loadListingForOwner(id));
  if (!owned.ok) return owned.response;
  const listing = owned.value;

  const body = await parseBody(request, createImageUploadSchema);
  if (!body.ok) return body.response;

  // Per-category cap, so an admin can allow more photos for Cars than for
  // Clothing without a deploy.
  const existing = await prisma.listingImage.count({
    where: { listingId: listing.id, uploadStatus: { not: 'FAILED' } },
  });
  if (existing >= listing.category.maxImages) {
    return fail('conflict', `This category allows at most ${listing.category.maxImages} images.`, {
      request,
    });
  }

  const storage = getStorage();
  const intent = await storage.createUploadIntent({
    prefix: `listings/${listing.id}`,
    declaredContentType: body.value.declaredContentType ?? 'application/octet-stream',
    maxBytes: MAX_UPLOAD_BYTES,
    ttlSeconds: UPLOAD_TTL_SECONDS,
  });

  const image = await prisma.listingImage.create({
    data: {
      listingId: listing.id,
      storageKey: intent.storageKey,
      position: existing,
      altText: body.value.altText ?? null,
      uploadStatus: 'PENDING_UPLOAD',
      // The first image becomes primary automatically.
      isPrimary: existing === 0,
    },
    select: { id: true, position: true, isPrimary: true },
  });

  return ok(
    {
      imageId: image.id,
      upload: {
        url: intent.uploadUrl,
        method: intent.method,
        headers: intent.headers,
        expiresAt: intent.expiresAt.toISOString(),
        maxBytes: intent.maxBytes,
      },
      /** Call this once the bytes are uploaded to validate and re-encode. */
      finaliseUrl: `/api/v1/listings/${listing.id}/images/${image.id}`,
      position: image.position,
      isPrimary: image.isPrimary,
    },
    { status: 201 },
  );
}
