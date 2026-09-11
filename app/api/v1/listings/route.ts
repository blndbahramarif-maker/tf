import { validateAttributes } from '@/domain/catalogue/attributes';
import { parseSearchQuery } from '@/domain/search/query';
import {
  loadAttributeDefinitions,
  loadCategoryBySlug,
  loadFilterableKeys,
} from '@/infra/catalogue/category-service';
import { buildListingSlug, writeAttributes } from '@/infra/catalogue/listing-service';
import { prisma } from '@/infra/db/client';
import { postgresSearch } from '@/infra/search/postgres-search';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp, requireAccess } from '@/lib/api/guards';
import { enforceRateLimit, parseBody } from '@/lib/api/route-helpers';
import { fail, ok, requestId } from '@/lib/api/respond';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';
import { createListingSchema } from '@/shared/listing-contract';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/listings — public search and filter.
 *
 * Public by design: browsing is how a marketplace is discovered. Every
 * parameter is normalised and bounded by `parseSearchQuery` before reaching
 * the database, and every value is a bound parameter.
 */
export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, RATE_LIMITS.readApi);
  if (!limited.ok) return limited.response;

  const url = new URL(request.url);

  // `attr.<key>=value` (repeatable) becomes an attribute filter.
  const attributes: Record<string, string[]> = {};
  for (const [rawKey, value] of url.searchParams.entries()) {
    if (!rawKey.startsWith('attr.')) continue;
    const key = rawKey.slice(5);
    (attributes[key] ??= []).push(value);
  }

  const query = parseSearchQuery({
    q: url.searchParams.get('q'),
    category: url.searchParams.get('category'),
    country: url.searchParams.get('country'),
    city: url.searchParams.get('city'),
    minPrice: url.searchParams.get('minPrice'),
    maxPrice: url.searchParams.get('maxPrice'),
    condition: url.searchParams.get('condition'),
    sellerType: url.searchParams.get('sellerType'),
    sort: url.searchParams.get('sort'),
    limit: url.searchParams.get('limit'),
    cursor: url.searchParams.get('cursor'),
    attributes,
  });

  const results = await postgresSearch.search(query);

  // Facets are only meaningful inside a category — the attribute keys come
  // from that category's own definitions, never from the request.
  let facets = null;
  if (url.searchParams.get('facets') === 'true' && query.categoryPath !== null) {
    const slug = query.categoryPath.split('/').filter(Boolean).at(-1) ?? '';
    const category = await loadCategoryBySlug(slug);
    if (category) {
      const keys = await loadFilterableKeys(category);
      facets = await postgresSearch.facets(query, keys);
    }
  }

  return ok({
    data: results.items,
    page: { nextCursor: results.nextCursor, hasMore: results.hasMore },
    totalMatches: results.totalMatches,
    ...(facets === null ? {} : { facets }),
  });
}

/**
 * POST /api/v1/listings — create a DRAFT.
 *
 * Creation never publishes. A listing becomes visible only through an explicit
 * transition, which is where the category's approval rule is applied.
 *
 * The seller is taken from the token: the body has no seller field.
 */
export async function POST(request: Request) {
  const access = await requireAccess(request, { all: ['listing:create'] });
  if (!access.ok) return access.response;

  const limited = await enforceRateLimit(
    request,
    RATE_LIMITS.writeApi,
    access.value.principal.userId,
  );
  if (!limited.ok) return limited.response;

  const body = await parseBody(request, createListingSchema);
  if (!body.ok) return body.response;

  const input = body.value;

  const sellerProfile = await prisma.sellerProfile.findUnique({
    where: { userId: access.value.principal.userId },
    select: { id: true, verificationStatus: true, deletedAt: true },
  });
  if (!sellerProfile || sellerProfile.deletedAt !== null) {
    return fail('forbidden', 'Create a seller profile before listing.', { request, status: 403 });
  }

  const category = await loadCategoryBySlug(input.categorySlug);
  if (!category || !category.isActive) {
    return fail('validation_failed', 'Unknown category.', {
      request,
      fields: [{ path: 'categorySlug', message: 'unknown_category' }],
    });
  }

  // A per-category FLAG, not a check against a category name.
  if (category.requiresVerifiedSeller && sellerProfile.verificationStatus !== 'VERIFIED') {
    return fail('forbidden', 'This category requires a verified seller account.', {
      request,
      status: 403,
    });
  }

  const country = await prisma.country.findUnique({
    where: { code: input.countryCode },
    select: { id: true, isActive: true },
  });
  if (!country || !country.isActive) {
    return fail('validation_failed', 'Listings are not available in that country yet.', {
      request,
      fields: [{ path: 'countryCode', message: 'unsupported_country' }],
    });
  }

  let cityId: string | null = null;
  if (input.citySlug) {
    const city = await prisma.city.findFirst({
      where: { slug: input.citySlug, countryId: country.id, isActive: true },
      select: { id: true },
    });
    if (!city) {
      return fail('validation_failed', 'Unknown city for that country.', {
        request,
        fields: [{ path: 'citySlug', message: 'unknown_city' }],
      });
    }
    cityId = city.id;
  }

  const definitions = await loadAttributeDefinitions(category);
  const validated = validateAttributes(definitions, input.attributes);
  if (!validated.ok) {
    return fail('validation_failed', 'Category attributes are invalid.', {
      request,
      fields: validated.issues.map((issue) => ({
        path: `attributes.${issue.key}`,
        message: issue.message,
      })),
    });
  }

  const priceMinor = input.priceMinor === undefined ? null : BigInt(input.priceMinor);
  if (input.priceType === 'FIXED' && priceMinor === null) {
    return fail('validation_failed', 'A fixed-price listing needs a price.', {
      request,
      fields: [{ path: 'priceMinor', message: 'required_for_fixed_price' }],
    });
  }
  if (
    category.minPriceMinor !== null &&
    priceMinor !== null &&
    priceMinor < category.minPriceMinor
  ) {
    return fail('validation_failed', 'Price is below the minimum for this category.', {
      request,
      fields: [{ path: 'priceMinor', message: 'below_category_minimum' }],
    });
  }

  const created = await prisma.$transaction(async (tx) => {
    const listing = await tx.listing.create({
      data: {
        sellerProfileId: sellerProfile.id,
        categoryId: category.id,
        title: input.title,
        slug: buildListingSlug(input.title, category.slug),
        description: input.description,
        contentLocale: input.contentLocale,
        priceMinor,
        currency: input.currency,
        priceType: input.priceType,
        countryId: country.id,
        cityId,
        condition: input.condition,
        quantity: input.quantity,
        status: 'DRAFT',
      },
      select: { id: true, slug: true, status: true },
    });

    // Normalised rows AND the JSONB projection, in one transaction.
    await writeAttributes(tx, {
      listingId: listing.id,
      rows: validated.rows,
      json: validated.json,
    });

    return listing;
  });

  await tryWriteAuditLog(prisma, {
    action: 'listing.created',
    actorType: 'user',
    actorId: access.value.principal.userId,
    entityType: 'listing',
    entityId: created.id,
    after: { categorySlug: category.slug, status: created.status },
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  return ok({ id: created.id, slug: created.slug, status: created.status }, { status: 201 });
}
