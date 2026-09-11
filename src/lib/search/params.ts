import { parseDecimalToMinor } from '@/shared/money';
import { parseSearchQuery, type RawSearchParams, type SearchQuery } from '@/domain/search/query';

/**
 * Page query parameters → a bounded domain `SearchQuery`.
 *
 * The PAGE and the API deliberately speak different price units:
 *
 *   API  — `minPrice` / `maxPrice` in integer MINOR units, because a machine
 *          client must never be asked to do decimal arithmetic (ADR-0004).
 *   Page — `priceFrom` / `priceTo` as decimal MAJOR units, because that is
 *          what a person types into a form, and a GET form cannot transform
 *          its own values.
 *
 * The conversion happens here, exactly once, through `parseDecimalToMinor` —
 * integer string arithmetic, no floating point (ADR-0006). Unparseable input
 * is dropped rather than rejected: a stray character in a URL should narrow
 * nothing, not produce an error page.
 */

export const PRICE_FROM_PARAM = 'priceFrom';
export const PRICE_TO_PARAM = 'priceTo';
/** `attrMin.<key>` / `attrMax.<key>` express a numeric range from a plain form. */
export const ATTRIBUTE_PREFIX = 'attr.';
export const ATTRIBUTE_MIN_PREFIX = 'attrMin.';
export const ATTRIBUTE_MAX_PREFIX = 'attrMax.';

/** Next.js hands page search params as string | string[] | undefined. */
export type PageSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function all(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function toMinorOrNull(value: string | null, currency: string): string | null {
  if (value === null || value.trim() === '') return null;
  try {
    const minor = parseDecimalToMinor(value, currency);
    return minor < 0n ? null : minor.toString();
  } catch {
    // Not a decimal amount. Silently ignored — see the note above.
    return null;
  }
}

export interface BuildQueryOptions {
  readonly params: PageSearchParams;
  /** Set by the category page; the free-text page leaves it null. */
  readonly categoryPath?: string | null;
  /** Currency whose minor-unit precision the price inputs are read in. */
  readonly currency: string;
  readonly limit?: number;
}

export function buildSearchQuery(options: BuildQueryOptions): SearchQuery {
  const { params, currency } = options;

  const attributes: Record<string, string[]> = {};

  for (const [key, value] of Object.entries(params)) {
    if (key.startsWith(ATTRIBUTE_PREFIX)) {
      const name = key.slice(ATTRIBUTE_PREFIX.length);
      (attributes[name] ??= []).push(...all(value).filter((entry) => entry !== ''));
      continue;
    }
    if (key.startsWith(ATTRIBUTE_MIN_PREFIX)) {
      const name = key.slice(ATTRIBUTE_MIN_PREFIX.length);
      const bound = first(value);
      if (bound && bound !== '') (attributes[name] ??= []).push(`min:${bound}`);
      continue;
    }
    if (key.startsWith(ATTRIBUTE_MAX_PREFIX)) {
      const name = key.slice(ATTRIBUTE_MAX_PREFIX.length);
      const bound = first(value);
      if (bound && bound !== '') (attributes[name] ??= []).push(`max:${bound}`);
    }
  }

  const raw: RawSearchParams = {
    q: first(params.q),
    category: options.categoryPath ?? null,
    country: first(params.country),
    city: first(params.city),
    minPrice: toMinorOrNull(first(params[PRICE_FROM_PARAM]), currency),
    maxPrice: toMinorOrNull(first(params[PRICE_TO_PARAM]), currency),
    condition: first(params.condition),
    sellerType: first(params.sellerType),
    sort: first(params.sort),
    limit: options.limit === undefined ? null : String(options.limit),
    cursor: first(params.cursor),
    attributes,
  };

  // Everything is bounded and normalised by the domain parser, not here.
  return parseSearchQuery(raw);
}

/**
 * Rebuilds a query string with some parameters replaced.
 *
 * Used for sort links and pagination, so changing one control never silently
 * drops the reader's other filters.
 */
export function withParams(
  params: PageSearchParams,
  overrides: Readonly<Record<string, string | null>>,
): string {
  const next = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (key in overrides) continue;
    for (const entry of all(value)) next.append(key, entry);
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value !== null && value !== '') next.append(key, value);
  }

  next.sort();
  const query = next.toString();
  return query === '' ? '' : `?${query}`;
}

/** True when anything is narrowing the result set, so "clear" can be offered. */
export function hasActiveFilters(params: PageSearchParams): boolean {
  return Object.entries(params).some(([key, value]) => {
    if (key === 'q' || key === 'sort' || key === 'cursor') return false;
    return all(value).some((entry) => entry !== '');
  });
}
