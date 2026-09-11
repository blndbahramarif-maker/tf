import { prisma } from '@/infra/db/client';
import { buildTree, type CategoryTreeNode } from '@/domain/catalogue/category-tree';
import { loadAttributeDefinitions, loadCategoryBySlug } from '@/infra/catalogue/category-service';

/**
 * Read model for server-rendered pages.
 *
 * Pages call this directly rather than fetching their own HTTP API. A server
 * component is already inside the trust boundary, and an internal round trip
 * would cost a second process hop, lose streaming, and force every page to
 * re-authenticate against itself. The REST API remains the contract for the
 * browser, for mobile clients and for tests — it is not the transport for our
 * own server rendering.
 *
 * Everything here reads PUBLIC data only: the visibility predicate
 * (`status = ACTIVE`, not deleted) is applied in this module, never passed in
 * by a caller.
 */

/** Localised label with an English fallback — never an English-only structure. */
function pick<T extends { locale: string }>(rows: readonly T[], locale: string): T | undefined {
  return rows.find((row) => row.locale === locale) ?? rows.find((row) => row.locale === 'en');
}

export interface CategorySummary {
  readonly id: string;
  readonly slug: string;
  readonly path: string;
  readonly depth: number;
  readonly icon: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly activeListingCount: number;
}

export type CategoryTree = readonly CategoryTreeNode<
  CategorySummary & { parentId: string | null; position: number; isActive: boolean }
>[];

/** The whole active tree, localised. Used by the home page and the header. */
export async function loadCategoryTree(locale: string): Promise<CategoryTree> {
  const rows = await prisma.category.findMany({
    where: { isActive: true, deletedAt: null },
    select: {
      id: true,
      parentId: true,
      slug: true,
      path: true,
      depth: true,
      position: true,
      isActive: true,
      icon: true,
      translations: {
        where: { locale: { in: [locale, 'en'] } },
        select: { locale: true, name: true, description: true },
      },
      _count: { select: { listings: { where: { status: 'ACTIVE', deletedAt: null } } } },
    },
    orderBy: { position: 'asc' },
  });

  return buildTree(
    rows.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      slug: row.slug,
      path: row.path,
      depth: row.depth,
      position: row.position,
      isActive: row.isActive,
      icon: row.icon,
      name: pick(row.translations, locale)?.name ?? row.slug,
      description: pick(row.translations, locale)?.description ?? null,
      activeListingCount: row._count.listings,
    })),
  );
}

export interface FilterOption {
  readonly value: string;
  readonly label: string;
}

export interface FilterableAttribute {
  readonly key: string;
  readonly dataType: string;
  readonly unit: string | null;
  readonly label: string;
  readonly helpText: string | null;
  readonly options: readonly FilterOption[];
}

export interface CategoryDetail {
  readonly id: string;
  readonly slug: string;
  readonly path: string;
  readonly name: string;
  readonly description: string | null;
  /**
   * Transaction behaviour as DATA. The UI adapts to these flags and never
   * branches on a category name — adding a category must not need a code
   * change (docs/12-decisions-log.md).
   */
  readonly transactionFlow: string;
  readonly allowsOnlinePayment: boolean;
  readonly requiresVerifiedSeller: boolean;
  readonly ancestors: readonly { slug: string; name: string }[];
  readonly children: readonly CategorySummary[];
  /** Only attributes an admin marked filterable reach the filter panel. */
  readonly filterable: readonly FilterableAttribute[];
}

export async function loadCategoryDetail(
  slug: string,
  locale: string,
): Promise<CategoryDetail | null> {
  const category = await loadCategoryBySlug(slug);
  if (!category || !category.isActive) return null;

  const definitions = await loadAttributeDefinitions(category);

  const [translations, filterableRows, children, ancestorRows] = await Promise.all([
    prisma.categoryTranslation.findMany({
      where: { categoryId: category.id, locale: { in: [locale, 'en'] } },
      select: { locale: true, name: true, description: true },
    }),
    prisma.attributeDefinition.findMany({
      where: { id: { in: definitions.map((d) => d.id) }, isFilterable: true },
      select: {
        id: true,
        key: true,
        dataType: true,
        unit: true,
        position: true,
        translations: {
          where: { locale: { in: [locale, 'en'] } },
          select: { locale: true, label: true, helpText: true },
        },
        options: {
          where: { isActive: true },
          orderBy: { position: 'asc' },
          select: {
            value: true,
            translations: {
              where: { locale: { in: [locale, 'en'] } },
              select: { locale: true, label: true },
            },
          },
        },
      },
      orderBy: { position: 'asc' },
    }),
    prisma.category.findMany({
      where: { parentId: category.id, isActive: true, deletedAt: null },
      select: {
        id: true,
        slug: true,
        path: true,
        depth: true,
        icon: true,
        translations: {
          where: { locale: { in: [locale, 'en'] } },
          select: { locale: true, name: true, description: true },
        },
        _count: { select: { listings: { where: { status: 'ACTIVE', deletedAt: null } } } },
      },
      orderBy: { position: 'asc' },
    }),
    loadAncestors(category.path, locale),
  ]);

  return {
    id: category.id,
    slug: category.slug,
    path: category.path,
    name: pick(translations, locale)?.name ?? category.slug,
    description: pick(translations, locale)?.description ?? null,
    transactionFlow: category.transactionFlow,
    allowsOnlinePayment: category.allowsOnlinePayment,
    requiresVerifiedSeller: category.requiresVerifiedSeller,
    ancestors: ancestorRows,
    children: children.map((child) => ({
      id: child.id,
      slug: child.slug,
      path: child.path,
      depth: child.depth,
      icon: child.icon,
      name: pick(child.translations, locale)?.name ?? child.slug,
      description: pick(child.translations, locale)?.description ?? null,
      activeListingCount: child._count.listings,
    })),
    filterable: filterableRows.map((row) => ({
      key: row.key,
      dataType: row.dataType,
      unit: row.unit,
      label: pick(row.translations, locale)?.label ?? row.key,
      helpText: pick(row.translations, locale)?.helpText ?? null,
      options: row.options.map((option) => ({
        value: option.value,
        label: pick(option.translations, locale)?.label ?? option.value,
      })),
    })),
  };
}

async function loadAncestors(
  path: string,
  locale: string,
): Promise<readonly { slug: string; name: string }[]> {
  const slugs = path.split('/').filter(Boolean).slice(0, -1);
  if (slugs.length === 0) return [];

  const rows = await prisma.category.findMany({
    where: { slug: { in: slugs }, deletedAt: null },
    select: {
      slug: true,
      depth: true,
      translations: {
        where: { locale: { in: [locale, 'en'] } },
        select: { locale: true, name: true },
      },
    },
  });

  // Ordered root-first to match the breadcrumb, not by however Postgres
  // happened to return them.
  return slugs.flatMap((slug) => {
    const row = rows.find((candidate) => candidate.slug === slug);
    return row ? [{ slug, name: pick(row.translations, locale)?.name ?? slug }] : [];
  });
}

export interface PublicListingAttribute {
  readonly key: string;
  readonly label: string;
  readonly unit: string | null;
  readonly displayValue: string;
}

export interface PublicListingImage {
  readonly url: string;
  readonly altText: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly variants: Readonly<Record<string, string>>;
}

export interface PublicListing {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly contentLocale: string;
  readonly priceMinor: bigint | null;
  readonly currency: string;
  readonly priceType: string;
  readonly condition: string;
  readonly quantity: number;
  readonly publishedAt: Date | null;
  readonly category: {
    readonly slug: string;
    readonly path: string;
    readonly name: string;
    readonly transactionFlow: string;
    readonly allowsOnlinePayment: boolean;
  };
  readonly countryCode: string;
  readonly cityName: string | null;
  readonly seller: {
    readonly slug: string;
    readonly displayName: string;
    readonly sellerType: string;
    readonly isVerified: boolean;
  };
  readonly images: readonly PublicListingImage[];
  readonly attributes: readonly PublicListingAttribute[];
}

/**
 * One publicly visible listing.
 *
 * Returns null for anything not ACTIVE — a draft, a paused or a rejected
 * listing is not merely hidden from the grid, it does not exist to an
 * anonymous reader. Owners view their own drafts through the authenticated
 * API, which applies the ownership guard.
 */
export async function loadPublicListing(id: string, locale: string): Promise<PublicListing | null> {
  const listing = await prisma.listing.findFirst({
    where: { id, status: 'ACTIVE', deletedAt: null },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      contentLocale: true,
      priceMinor: true,
      currency: true,
      priceType: true,
      condition: true,
      quantity: true,
      publishedAt: true,
      categoryId: true,
      category: {
        select: {
          id: true,
          slug: true,
          path: true,
          transactionFlow: true,
          allowsOnlinePayment: true,
          translations: {
            where: { locale: { in: [locale, 'en'] } },
            select: { locale: true, name: true },
          },
        },
      },
      country: { select: { code: true } },
      city: {
        select: {
          name: true,
          translations: {
            where: { locale: { in: [locale, 'en'] } },
            select: { locale: true, name: true },
          },
        },
      },
      sellerProfile: {
        select: {
          slug: true,
          displayName: true,
          sellerType: true,
          verificationStatus: true,
        },
      },
      images: {
        where: { uploadStatus: 'READY', moderationStatus: 'APPROVED' },
        orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
        select: { url: true, altText: true, width: true, height: true, variants: true },
      },
      attributeValues: {
        select: {
          valueText: true,
          valueNumber: true,
          valueInteger: true,
          valueBoolean: true,
          valueDate: true,
          attributeDefinition: {
            select: {
              key: true,
              dataType: true,
              unit: true,
              position: true,
              translations: {
                where: { locale: { in: [locale, 'en'] } },
                select: { locale: true, label: true },
              },
            },
          },
          option: {
            select: {
              value: true,
              translations: {
                where: { locale: { in: [locale, 'en'] } },
                select: { locale: true, label: true },
              },
            },
          },
        },
      },
    },
  });

  if (listing === null) return null;

  const attributes = listing.attributeValues
    .map((row) => {
      const definition = row.attributeDefinition;
      return {
        position: definition.position,
        key: definition.key,
        label: pick(definition.translations, locale)?.label ?? definition.key,
        unit: definition.unit,
        // The normalised row is the source of truth for display, not the JSONB
        // projection — the projection exists for filtering.
        displayValue: displayValue(row, locale),
      };
    })
    .filter((row) => row.displayValue.length > 0)
    .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key))
    .map(({ position: _position, ...rest }) => rest);

  return {
    id: listing.id,
    slug: listing.slug,
    title: listing.title,
    description: listing.description,
    contentLocale: listing.contentLocale,
    priceMinor: listing.priceMinor,
    currency: listing.currency,
    priceType: listing.priceType,
    condition: listing.condition,
    quantity: listing.quantity,
    publishedAt: listing.publishedAt,
    category: {
      slug: listing.category.slug,
      path: listing.category.path,
      name: pick(listing.category.translations, locale)?.name ?? listing.category.slug,
      transactionFlow: listing.category.transactionFlow,
      allowsOnlinePayment: listing.category.allowsOnlinePayment,
    },
    countryCode: listing.country.code,
    cityName: listing.city
      ? (pick(listing.city.translations, locale)?.name ?? listing.city.name)
      : null,
    seller: {
      slug: listing.sellerProfile.slug,
      displayName: listing.sellerProfile.displayName,
      sellerType: listing.sellerProfile.sellerType,
      isVerified: listing.sellerProfile.verificationStatus === 'VERIFIED',
    },
    images: listing.images.map((image) => ({
      url: image.url,
      altText: image.altText,
      width: image.width,
      height: image.height,
      variants: (image.variants ?? {}) as Record<string, string>,
    })),
    attributes,
  };
}

interface AttributeValueRow {
  valueText: string | null;
  valueNumber: unknown;
  valueInteger: bigint | null;
  valueBoolean: boolean | null;
  valueDate: Date | null;
  option: {
    value: string;
    translations: readonly { locale: string; label: string }[];
  } | null;
}

function displayValue(row: AttributeValueRow, locale: string): string {
  if (row.option !== null) {
    return pick(row.option.translations, locale)?.label ?? row.option.value;
  }
  if (row.valueText !== null) return row.valueText;
  if (row.valueInteger !== null) return String(row.valueInteger);
  if (row.valueNumber !== null && row.valueNumber !== undefined) return String(row.valueNumber);
  if (row.valueBoolean !== null) return row.valueBoolean ? 'true' : 'false';
  // Date-only, in ISO form: a locale-formatted date is the component's job.
  if (row.valueDate !== null) return row.valueDate.toISOString().slice(0, 10);
  return '';
}

/** Ids and slugs of publicly visible listings, for the sitemap. */
export async function loadSitemapListings(limit: number): Promise<
  readonly {
    id: string;
    slug: string;
    updatedAt: Date;
  }[]
> {
  return prisma.listing.findMany({
    where: { status: 'ACTIVE', deletedAt: null },
    select: { id: true, slug: true, updatedAt: true },
    orderBy: { publishedAt: 'desc' },
    take: limit,
  });
}

/** Active category slugs, for the sitemap. */
export async function loadSitemapCategories(): Promise<readonly { slug: string }[]> {
  return prisma.category.findMany({
    where: { isActive: true, deletedAt: null },
    select: { slug: true },
    orderBy: { position: 'asc' },
  });
}
