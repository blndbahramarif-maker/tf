import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/infra/db/client';
import type { Facets, SearchPort, SearchResultItem, SearchResults } from '@/domain/ports/search';
import { decodeCursor, encodeCursor, type SearchQuery } from '@/domain/search/query';

/**
 * PostgreSQL search adapter.
 *
 * Full-text via the `search_document` tsvector (maintained by a trigger), with
 * trigram similarity as a fallback so a misspelling or a partial word still
 * matches. Attribute filtering uses JSONB containment against the GIN index.
 *
 * Configuration is `simple`, not `english`: Postgres has no Kurdish dictionary
 * and English stemming on Sorani produces nonsense (ADR-0003).
 *
 * Every value reaches the database as a BOUND PARAMETER through `Prisma.sql`.
 * No user input is ever concatenated into SQL.
 */

const MAX_COUNT = 1000;

/** Shared predicates: the listing must be publicly visible. */
function baseConditions(query: SearchQuery): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`l."status" = 'ACTIVE'::listing_status`,
    Prisma.sql`l."deleted_at" IS NULL`,
  ];

  if (query.categoryPath !== null) {
    // Prefix scan over the delimited materialised path. Both ends are
    // delimited, so `/car/` cannot match `/cargo/`.
    conditions.push(Prisma.sql`cat."path" LIKE ${`${query.categoryPath}%`}`);
  }
  if (query.countryCode !== null) {
    conditions.push(Prisma.sql`co."code" = ${query.countryCode}`);
  }
  if (query.citySlug !== null) {
    conditions.push(Prisma.sql`ci."slug" = ${query.citySlug}`);
  }
  if (query.minPriceMinor !== null) {
    conditions.push(Prisma.sql`l."price_minor" >= ${query.minPriceMinor}`);
  }
  if (query.maxPriceMinor !== null) {
    conditions.push(Prisma.sql`l."price_minor" <= ${query.maxPriceMinor}`);
  }
  if (query.condition !== null) {
    conditions.push(Prisma.sql`l."condition" = ${query.condition}::listing_condition`);
  }
  if (query.sellerType !== null) {
    conditions.push(Prisma.sql`sp."seller_type" = ${query.sellerType}::seller_type`);
  }

  for (const filter of query.attributes) {
    if (filter.anyOf && filter.anyOf.length > 0) {
      // JSONB containment, one object per candidate value, OR-ed together.
      // Uses the GIN index on listings.attributes.
      const alternatives = filter.anyOf.map(
        (value) => Prisma.sql`l."attributes" @> ${JSON.stringify({ [filter.key]: value })}::jsonb`,
      );
      conditions.push(Prisma.sql`(${Prisma.join(alternatives, ' OR ')})`);
      continue;
    }
    // Range filters read the value out of JSONB as a number.
    if (filter.min !== undefined) {
      conditions.push(Prisma.sql`(l."attributes" -> ${filter.key})::numeric >= ${filter.min}`);
    }
    if (filter.max !== undefined) {
      conditions.push(Prisma.sql`(l."attributes" -> ${filter.key})::numeric <= ${filter.max}`);
    }
  }

  if (query.text !== null) {
    // Full-text OR trigram: `websearch_to_tsquery` handles quoted phrases and
    // `-exclusion`; similarity catches typos and partial words that the
    // dictionary-free `simple` configuration would otherwise miss.
    conditions.push(
      Prisma.sql`(
        l."search_document" @@ websearch_to_tsquery('simple', unaccent(${query.text}))
        OR l."title" % ${query.text}
      )`,
    );
  }

  return conditions;
}

const FROM_CLAUSE = Prisma.sql`
  FROM "listings" l
  JOIN "categories" cat ON cat."id" = l."category_id"
  JOIN "countries" co ON co."id" = l."country_id"
  JOIN "seller_profiles" sp ON sp."id" = l."seller_profile_id"
  LEFT JOIN "cities" ci ON ci."id" = l."city_id"
`;

interface Row {
  id: string;
  slug: string;
  title: string;
  content_locale: string;
  price_minor: bigint | null;
  currency: string;
  price_type: string;
  condition: string;
  category_slug: string;
  country_code: string;
  city_slug: string | null;
  city_name: string | null;
  published_at: Date | null;
  primary_image_url: string | null;
  seller_display_name: string;
  seller_slug: string;
  sort_key: string;
}

export class PostgresSearchAdapter implements SearchPort {
  async search(query: SearchQuery): Promise<SearchResults> {
    const conditions = baseConditions(query);

    // Cursor pagination: resume strictly after the last row seen. Compared as
    // (sort_key, id) so ties on the sort key cannot skip or repeat a row.
    const cursor = query.cursor === null ? null : decodeCursor(query.cursor);

    const relevance =
      query.text === null
        ? Prisma.sql`0::real`
        : Prisma.sql`ts_rank(l."search_document", websearch_to_tsquery('simple', unaccent(${query.text})))`;

    let sortKey: Prisma.Sql;
    let orderBy: Prisma.Sql;
    switch (query.sort) {
      case 'price_asc':
        sortKey = Prisma.sql`lpad(coalesce(l."price_minor", 0)::text, 19, '0')`;
        orderBy = Prisma.sql`ORDER BY sort_key ASC, l."id" ASC`;
        break;
      case 'price_desc':
        sortKey = Prisma.sql`lpad((9223372036854775807 - coalesce(l."price_minor", 0))::text, 19, '0')`;
        orderBy = Prisma.sql`ORDER BY sort_key ASC, l."id" ASC`;
        break;
      case 'relevance':
        // Descending rank expressed as an ascending key, so one cursor
        // comparison works for every sort mode.
        sortKey = Prisma.sql`lpad(((1 - least(${relevance}, 0.999)) * 1000000)::bigint::text, 19, '0')`;
        orderBy = Prisma.sql`ORDER BY sort_key ASC, l."id" ASC`;
        break;
      case 'newest':
      default:
        sortKey = Prisma.sql`lpad((9223372036854775807 - (extract(epoch from coalesce(l."published_at", l."created_at")) * 1000)::bigint)::text, 19, '0')`;
        orderBy = Prisma.sql`ORDER BY sort_key ASC, l."id" ASC`;
        break;
    }

    /*
     * The count describes the WHOLE result set for this query, so it is built
     * BEFORE the cursor predicate narrows `conditions` to "rows after this
     * one". Sharing one `where` between the page and the count made
     * `totalMatches` count down as the reader paged — 7, then 4, then 1 for an
     * unchanged query — and the results header reported the remainder as if it
     * were the total.
     */
    const countWhere = Prisma.join(conditions, ' AND ');

    if (cursor !== null) {
      conditions.push(Prisma.sql`(${sortKey}, l."id"::text) > (${cursor.value}, ${cursor.id})`);
    }

    const where = Prisma.join(conditions, ' AND ');

    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT
        l."id"::text            AS id,
        l."slug"                AS slug,
        l."title"               AS title,
        l."content_locale"      AS content_locale,
        l."price_minor"         AS price_minor,
        l."currency"            AS currency,
        l."price_type"::text    AS price_type,
        l."condition"::text     AS condition,
        cat."slug"              AS category_slug,
        co."code"               AS country_code,
        ci."slug"               AS city_slug,
        ci."name"               AS city_name,
        l."published_at"        AS published_at,
        sp."display_name"       AS seller_display_name,
        sp."slug"               AS seller_slug,
        ${sortKey}              AS sort_key,
        (
          SELECT img."url" FROM "listing_images" img
           WHERE img."listing_id" = l."id"
             AND img."upload_status" = 'READY'::image_upload_status
             AND img."moderation_status" = 'APPROVED'::moderation_status
           ORDER BY img."is_primary" DESC, img."position" ASC
           LIMIT 1
        )                       AS primary_image_url
      ${FROM_CLAUSE}
      WHERE ${where}
      ${orderBy}
      LIMIT ${query.limit + 1}
    `);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);

    const countRows = await prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
      SELECT count(*)::bigint AS total
      FROM (
        SELECT l."id" ${FROM_CLAUSE} WHERE ${countWhere} LIMIT ${MAX_COUNT}
      ) capped
    `);

    return {
      items: page.map(toItem),
      hasMore,
      nextCursor: hasMore && last ? encodeCursor(last.sort_key, last.id) : null,
      totalMatches: Number(countRows[0]?.total ?? 0n),
    };
  }

  async facets(query: SearchQuery, attributeKeys: readonly string[]): Promise<Facets> {
    // Facet counts describe what ELSE the user could narrow to, so they are
    // computed with the attribute filters still applied — matching what the
    // result list shows.
    const where = Prisma.join(baseConditions(query), ' AND ');

    const [categories, conditions, cities] = await Promise.all([
      prisma.$queryRaw<{ value: string; count: bigint }[]>(Prisma.sql`
        SELECT cat."slug" AS value, count(*)::bigint AS count
        ${FROM_CLAUSE} WHERE ${where}
        GROUP BY cat."slug" ORDER BY count DESC, value ASC LIMIT 50
      `),
      prisma.$queryRaw<{ value: string; count: bigint }[]>(Prisma.sql`
        SELECT l."condition"::text AS value, count(*)::bigint AS count
        ${FROM_CLAUSE} WHERE ${where}
        GROUP BY l."condition" ORDER BY count DESC, value ASC LIMIT 20
      `),
      prisma.$queryRaw<{ value: string; count: bigint }[]>(Prisma.sql`
        SELECT ci."slug" AS value, count(*)::bigint AS count
        ${FROM_CLAUSE} WHERE ${where} AND ci."slug" IS NOT NULL
        GROUP BY ci."slug" ORDER BY count DESC, value ASC LIMIT 50
      `),
    ]);

    const attributes: Record<string, FacetValueList> = {};
    for (const key of attributeKeys) {
      // Keys come from the category's own attribute definitions, never from
      // the request, and are bound as parameters regardless.
      const rows = await prisma.$queryRaw<{ value: string; count: bigint }[]>(Prisma.sql`
        SELECT l."attributes" ->> ${key} AS value, count(*)::bigint AS count
        ${FROM_CLAUSE} WHERE ${where} AND l."attributes" ? ${key}
        GROUP BY value ORDER BY count DESC, value ASC LIMIT 30
      `);
      const values = rows.filter((row) => row.value !== null).map(toFacet);
      if (values.length > 0) attributes[key] = values;
    }

    return {
      categories: categories.map(toFacet),
      conditions: conditions.map(toFacet),
      cities: cities.map(toFacet),
      attributes,
    };
  }
}

type FacetValueList = { value: string; count: number }[];

function toFacet(row: { value: string; count: bigint }): { value: string; count: number } {
  return { value: row.value, count: Number(row.count) };
}

function toItem(row: Row): SearchResultItem {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    contentLocale: row.content_locale,
    // Money crosses the wire as a string (ADR-0004).
    priceMinor: row.price_minor === null ? null : row.price_minor.toString(),
    currency: row.currency,
    priceType: row.price_type,
    condition: row.condition,
    categorySlug: row.category_slug,
    countryCode: row.country_code,
    citySlug: row.city_slug,
    cityName: row.city_name,
    publishedAt: row.published_at?.toISOString() ?? null,
    primaryImageUrl: row.primary_image_url,
    sellerDisplayName: row.seller_display_name,
    sellerSlug: row.seller_slug,
  };
}

export const postgresSearch = new PostgresSearchAdapter();
