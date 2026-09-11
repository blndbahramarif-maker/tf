import type { SearchQuery } from '@/domain/search/query';

/**
 * Listing search port.
 *
 * PostgreSQL implements this today. When search quality for Arabic-script
 * Sorani forces a dedicated engine (Phase 4b, ADR-0003), only the adapter
 * changes — callers and the query parser do not.
 */

export interface SearchResultItem {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly contentLocale: string;
  readonly priceMinor: string | null;
  readonly currency: string;
  readonly priceType: string;
  readonly condition: string;
  readonly categorySlug: string;
  readonly countryCode: string;
  readonly citySlug: string | null;
  /** Proper name, for display. The slug is for URLs. */
  readonly cityName: string | null;
  readonly publishedAt: string | null;
  readonly primaryImageUrl: string | null;
  readonly sellerDisplayName: string;
  readonly sellerSlug: string;
}

export interface SearchResults {
  readonly items: readonly SearchResultItem[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  /** Total matches, capped — an exact count over a large table is wasteful. */
  readonly totalMatches: number;
}

export interface FacetValue {
  readonly value: string;
  readonly count: number;
}

export interface Facets {
  readonly categories: readonly FacetValue[];
  readonly conditions: readonly FacetValue[];
  readonly cities: readonly FacetValue[];
  /** Attribute key → observed values with counts, for the filter panel. */
  readonly attributes: Readonly<Record<string, readonly FacetValue[]>>;
}

export interface SearchPort {
  search(query: SearchQuery): Promise<SearchResults>;
  facets(query: SearchQuery, attributeKeys: readonly string[]): Promise<Facets>;
}
