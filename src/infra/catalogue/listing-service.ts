import { randomBytes } from 'node:crypto';
import { prisma } from '@/infra/db/client';
import { slugifyWithFallback } from '@/domain/catalogue/slug';
import type { AttributeValueRow } from '@/domain/catalogue/attributes';

/**
 * Listing persistence.
 *
 * The hybrid attribute write lives here: normalised rows and the JSONB
 * projection are written in ONE transaction, so the read model can never
 * disagree with the source of truth (docs/03-database-architecture.md).
 */

/**
 * Slugs carry random entropy rather than anything derived from an id.
 *
 * Phase 3 learned this the hard way: a UUIDv7 prefix is a millisecond
 * timestamp, so every row created in the same ~65-second window collided.
 */
export function buildListingSlug(title: string, fallback: string): string {
  return `${slugifyWithFallback(title, fallback)}-${randomBytes(4).toString('hex')}`;
}

export interface WriteAttributesInput {
  readonly listingId: string;
  readonly rows: readonly AttributeValueRow[];
  readonly json: Record<string, unknown>;
}

type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Replaces a listing's attribute values.
 *
 * Delete-then-insert rather than a diff: attribute sets are small, and a full
 * replace cannot leave a stale row behind when a seller clears a field.
 */
export async function writeAttributes(
  tx: TransactionClient,
  input: WriteAttributesInput,
): Promise<void> {
  await tx.listingAttributeValue.deleteMany({ where: { listingId: input.listingId } });

  if (input.rows.length > 0) {
    await tx.listingAttributeValue.createMany({
      data: input.rows.map((row) => ({
        listingId: input.listingId,
        attributeDefinitionId: row.attributeDefinitionId,
        valueText: row.valueText,
        valueNumber: row.valueNumber,
        valueInteger: row.valueInteger,
        valueBoolean: row.valueBoolean,
        valueDate: row.valueDate,
        optionId: row.optionId,
      })),
    });
  }

  // The JSONB projection is written in the SAME transaction. The database
  // trigger then rebuilds the search vector from it.
  await tx.listing.update({
    where: { id: input.listingId },
    data: { attributes: input.json as never },
  });
}

/** Everything a route needs to decide authorization and render a listing. */
export async function loadListingForOwner(id: string) {
  const listing = await prisma.listing.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      contentLocale: true,
      status: true,
      priceMinor: true,
      currency: true,
      priceType: true,
      condition: true,
      quantity: true,
      attributes: true,
      publishedAt: true,
      expiresAt: true,
      rejectionReason: true,
      createdAt: true,
      updatedAt: true,
      categoryId: true,
      countryId: true,
      cityId: true,
      sellerProfileId: true,
      category: {
        select: {
          slug: true,
          path: true,
          requiresApproval: true,
          listingDurationDays: true,
          maxImages: true,
        },
      },
      country: { select: { code: true } },
      city: { select: { slug: true, name: true } },
      sellerProfile: { select: { id: true, userId: true, slug: true, displayName: true } },
      images: {
        select: {
          id: true,
          url: true,
          position: true,
          isPrimary: true,
          width: true,
          height: true,
          altText: true,
          uploadStatus: true,
          moderationStatus: true,
          variants: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
      },
    },
  });

  if (listing === null) return null;
  // `ownerUserId` is read from the database, never from the request — this is
  // what the ownership guard compares against.
  return { ...listing, ownerUserId: listing.sellerProfile.userId };
}

export type LoadedListing = NonNullable<Awaited<ReturnType<typeof loadListingForOwner>>>;

/** Serialises a listing for its owner. Money becomes a string (ADR-0004). */
export function serialiseListing(listing: LoadedListing) {
  return {
    id: listing.id,
    slug: listing.slug,
    title: listing.title,
    description: listing.description,
    contentLocale: listing.contentLocale,
    status: listing.status,
    priceMinor: listing.priceMinor === null ? null : listing.priceMinor.toString(),
    currency: listing.currency,
    priceType: listing.priceType,
    condition: listing.condition,
    quantity: listing.quantity,
    attributes: listing.attributes,
    categorySlug: listing.category.slug,
    countryCode: listing.country.code,
    citySlug: listing.city?.slug ?? null,
    publishedAt: listing.publishedAt?.toISOString() ?? null,
    expiresAt: listing.expiresAt?.toISOString() ?? null,
    rejectionReason: listing.rejectionReason,
    createdAt: listing.createdAt.toISOString(),
    seller: {
      id: listing.sellerProfile.id,
      slug: listing.sellerProfile.slug,
      displayName: listing.sellerProfile.displayName,
    },
    images: listing.images
      // Only fully-processed, approved images are ever exposed.
      .filter((image) => image.uploadStatus === 'READY')
      .map((image) => ({
        id: image.id,
        url: image.url,
        position: image.position,
        isPrimary: image.isPrimary,
        width: image.width,
        height: image.height,
        altText: image.altText,
        moderationStatus: image.moderationStatus,
        variants: image.variants,
      })),
    /** Images still in the pipeline, shown to the OWNER only. */
    pendingImageCount: listing.images.filter((image) => image.uploadStatus !== 'READY').length,
  };
}
