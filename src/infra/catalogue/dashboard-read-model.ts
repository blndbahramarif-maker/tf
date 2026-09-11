import { prisma } from '@/infra/db/client';

/**
 * Read model for the signed-in seller.
 *
 * Every query here is scoped by the OWNER's user id, which the caller takes
 * from the session token. There is no function that accepts a seller-profile
 * id or a listing id on its own — the scoping is structural, so a page cannot
 * accidentally read someone else's data by passing the wrong parameter.
 */

export interface SellerOverview {
  readonly sellerProfileId: string;
  readonly slug: string;
  readonly displayName: string;
  readonly about: string | null;
  readonly sellerType: string;
  readonly verificationStatus: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly totalListings: number;
}

export async function loadSellerOverview(userId: string): Promise<SellerOverview | null> {
  const profile = await prisma.sellerProfile.findFirst({
    where: { userId, deletedAt: null },
    select: {
      id: true,
      slug: true,
      displayName: true,
      about: true,
      sellerType: true,
      verificationStatus: true,
    },
  });
  if (!profile) return null;

  const grouped = await prisma.listing.groupBy({
    by: ['status'],
    where: { sellerProfileId: profile.id, deletedAt: null },
    _count: { _all: true },
  });

  const counts: Record<string, number> = {};
  let total = 0;
  for (const row of grouped) {
    counts[row.status] = row._count._all;
    total += row._count._all;
  }

  return {
    sellerProfileId: profile.id,
    slug: profile.slug,
    displayName: profile.displayName,
    about: profile.about,
    sellerType: profile.sellerType,
    verificationStatus: profile.verificationStatus,
    counts,
    totalListings: total,
  };
}

export interface DashboardListing {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly status: string;
  readonly priceMinor: bigint | null;
  readonly currency: string;
  readonly priceType: string;
  readonly categoryName: string;
  readonly categorySlug: string;
  readonly imageCount: number;
  readonly readyImageCount: number;
  readonly updatedAt: Date;
  readonly publishedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly rejectionReason: string | null;
}

export async function loadSellerListings(
  userId: string,
  options: { status?: string | null; limit?: number } = {},
): Promise<readonly DashboardListing[]> {
  const rows = await prisma.listing.findMany({
    where: {
      // Scoped through the relation, so an id from the browser plays no part.
      sellerProfile: { userId, deletedAt: null },
      deletedAt: null,
      ...(options.status ? { status: options.status as never } : {}),
    },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      priceMinor: true,
      currency: true,
      priceType: true,
      updatedAt: true,
      publishedAt: true,
      expiresAt: true,
      rejectionReason: true,
      category: {
        select: {
          slug: true,
          translations: { where: { locale: 'en' }, select: { name: true } },
        },
      },
      images: { select: { uploadStatus: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: options.limit ?? 100,
  });

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    priceMinor: row.priceMinor,
    currency: row.currency,
    priceType: row.priceType,
    categoryName: row.category.translations[0]?.name ?? row.category.slug,
    categorySlug: row.category.slug,
    imageCount: row.images.length,
    readyImageCount: row.images.filter((image) => image.uploadStatus === 'READY').length,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
    expiresAt: row.expiresAt,
    rejectionReason: row.rejectionReason,
  }));
}

/**
 * One listing, for the edit screen.
 *
 * Takes the owner's user id as well as the listing id and returns null when
 * they do not match — so "not yours" and "does not exist" are the same answer
 * at the data layer, not just at the page layer.
 */
export async function loadOwnedListingDetail(listingId: string, userId: string) {
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, deletedAt: null, sellerProfile: { userId, deletedAt: null } },
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
      publishedAt: true,
      expiresAt: true,
      rejectionReason: true,
      attributes: true,
      category: {
        select: { id: true, slug: true, path: true, requiresApproval: true, maxImages: true },
      },
      images: {
        orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
        select: {
          id: true,
          url: true,
          isPrimary: true,
          position: true,
          altText: true,
          uploadStatus: true,
          failureReason: true,
          variants: true,
        },
      },
    },
  });
  return listing;
}

export type OwnedListingDetail = NonNullable<Awaited<ReturnType<typeof loadOwnedListingDetail>>>;

/** The caller's own active sessions, for the security screen. */
export async function loadOwnSessions(userId: string) {
  return prisma.refreshToken.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: {
      id: true,
      familyId: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      ip: true,
      userAgent: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}
