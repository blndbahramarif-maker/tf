/**
 * Search query normalisation.
 *
 * Pure: turns untrusted request parameters into a validated, bounded query
 * object. The adapter that talks to PostgreSQL (or, later, a dedicated search
 * engine) consumes this — so swapping the engine does not change how a query
 * is parsed or bounded.
 */

export type ListingSort = 'relevance' | 'newest' | 'price_asc' | 'price_desc';

export interface AttributeFilter {
  readonly key: string;
  /** Equality against one of these values. */
  readonly anyOf?: readonly (string | number | boolean)[];
  readonly min?: number;
  readonly max?: number;
}

export interface SearchQuery {
  readonly text: string | null;
  readonly categoryPath: string | null;
  readonly countryCode: string | null;
  readonly citySlug: string | null;
  readonly minPriceMinor: bigint | null;
  readonly maxPriceMinor: bigint | null;
  readonly condition: string | null;
  readonly sellerType: string | null;
  readonly attributes: readonly AttributeFilter[];
  readonly sort: ListingSort;
  readonly limit: number;
  readonly cursor: string | null;
}

export const DEFAULT_LIMIT = 24;
export const MAX_LIMIT = 100;
/** Long queries are pathological for full-text search and never legitimate. */
export const MAX_TEXT_LENGTH = 120;

const SORTS: readonly ListingSort[] = ['relevance', 'newest', 'price_asc', 'price_desc'];

export interface RawSearchParams {
  readonly q?: string | null;
  readonly category?: string | null;
  readonly country?: string | null;
  readonly city?: string | null;
  readonly minPrice?: string | null;
  readonly maxPrice?: string | null;
  readonly condition?: string | null;
  readonly sellerType?: string | null;
  readonly sort?: string | null;
  readonly limit?: string | null;
  readonly cursor?: string | null;
  /** `attr.<key>` parameters, already extracted by the caller. */
  readonly attributes?: Readonly<Record<string, readonly string[]>>;
}

function parseMinor(value: string | null | undefined): bigint | null {
  if (!value) return null;
  if (!/^\d{1,18}$/.test(value)) return null;
  return BigInt(value);
}

/**
 * Normalises free text for full-text search.
 *
 * Postgres has NO Kurdish dictionary, so Sorani and Kurmanji rely on the
 * `simple` configuration plus trigram similarity rather than stemming. This is
 * a documented quality compromise and the main trigger for moving to a
 * dedicated search engine in Phase 4b (ADR-0003).
 */
export function normaliseText(input: string): string {
  return input.trim().replace(/\s+/g, ' ').slice(0, MAX_TEXT_LENGTH);
}

export function parseSearchQuery(params: RawSearchParams): SearchQuery {
  const text = params.q ? normaliseText(params.q) : '';
  const requestedLimit = Number.parseInt(params.limit ?? '', 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const sort: ListingSort = SORTS.includes(params.sort as ListingSort)
    ? (params.sort as ListingSort)
    : // Relevance is meaningless without a search term, so default by recency.
      text.length > 0
      ? 'relevance'
      : 'newest';

  const attributes: AttributeFilter[] = [];
  for (const [key, values] of Object.entries(params.attributes ?? {})) {
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(key)) continue;
    const cleaned = values.filter((value) => value.length > 0 && value.length <= 80).slice(0, 20);
    if (cleaned.length === 0) continue;

    // A single `min:`/`max:` prefixed value expresses a range filter.
    const min = cleaned.find((value) => value.startsWith('min:'));
    const max = cleaned.find((value) => value.startsWith('max:'));
    if (min || max) {
      const minValue = min ? Number(min.slice(4)) : undefined;
      const maxValue = max ? Number(max.slice(4)) : undefined;
      attributes.push({
        key,
        ...(Number.isFinite(minValue) ? { min: minValue as number } : {}),
        ...(Number.isFinite(maxValue) ? { max: maxValue as number } : {}),
      });
      continue;
    }

    attributes.push({ key, anyOf: cleaned });
  }

  return {
    text: text.length > 0 ? text : null,
    categoryPath:
      params.category && /^[a-z0-9/-]{1,200}$/.test(params.category) ? params.category : null,
    countryCode:
      params.country && /^[A-Za-z]{2}$/.test(params.country) ? params.country.toUpperCase() : null,
    citySlug: params.city && /^[a-z0-9-]{1,80}$/.test(params.city) ? params.city : null,
    minPriceMinor: parseMinor(params.minPrice),
    maxPriceMinor: parseMinor(params.maxPrice),
    condition:
      params.condition && /^[A-Z_]{1,20}$/.test(params.condition) ? params.condition : null,
    sellerType:
      params.sellerType === 'INDIVIDUAL' || params.sellerType === 'BUSINESS'
        ? params.sellerType
        : null,
    attributes,
    sort,
    limit,
    cursor: params.cursor && params.cursor.length <= 200 ? params.cursor : null,
  };
}

/**
 * Cursor pagination, not offset (ADR-0004).
 *
 * The cursor encodes the sort key of the last row seen, so inserts during a
 * scroll cannot duplicate or skip rows.
 */
export interface DecodedCursor {
  readonly value: string;
  readonly id: string;
}

export function encodeCursor(value: string, id: string): string {
  return Buffer.from(`${value}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): DecodedCursor | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const separator = decoded.lastIndexOf('|');
    if (separator <= 0) return null;
    const value = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);
    if (!id) return null;
    return { value, id };
  } catch {
    return null;
  }
}
