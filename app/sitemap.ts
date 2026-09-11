import type { MetadataRoute } from 'next';
import { ENABLED_LOCALES } from '@kurdora/i18n';
import { listingPath } from '@/domain/catalogue/slug';
import { loadSitemapCategories, loadSitemapListings } from '@/infra/catalogue/read-model';
import { canonicalUrl, sitemapAlternates } from '@/lib/seo/urls';

export const dynamic = 'force-dynamic';

/**
 * Sitemap.
 *
 * Every URL is emitted once per ENABLED locale with `alternates.languages`, so
 * a crawler is told about the Sorani version of a page rather than having to
 * discover it. Disabled locales are excluded for the reason given in
 * `src/lib/seo/urls.ts`.
 *
 * Search and filter URLs are deliberately absent: they are near-duplicate
 * views of listings that already appear here, and submitting every filter
 * permutation would spend the crawl budget on nothing.
 */

/**
 * A single sitemap document is capped at 50,000 URLs by the protocol. This
 * limit keeps one listing entry per locale inside that, and is the point at
 * which a sitemap index becomes necessary — tracked for Phase 11 (SEO).
 */
const MAX_LISTINGS = 10_000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [categories, listings] = await Promise.all([
    loadSitemapCategories(),
    loadSitemapListings(MAX_LISTINGS),
  ]);

  const entries: MetadataRoute.Sitemap = [];

  for (const locale of ENABLED_LOCALES) {
    entries.push({
      url: canonicalUrl(`/${locale}`),
      changeFrequency: 'daily',
      priority: 1,
      alternates: { languages: sitemapAlternates('/') },
    });

    entries.push({
      url: canonicalUrl(`/${locale}/sell`),
      changeFrequency: 'monthly',
      priority: 0.5,
      alternates: { languages: sitemapAlternates('/sell') },
    });

    for (const category of categories) {
      entries.push({
        url: canonicalUrl(`/${locale}/c/${category.slug}`),
        changeFrequency: 'daily',
        priority: 0.8,
        alternates: { languages: sitemapAlternates(`/c/${category.slug}`) },
      });
    }

    for (const listing of listings) {
      entries.push({
        url: canonicalUrl(listingPath(locale, listing.id, listing.slug)),
        lastModified: listing.updatedAt,
        changeFrequency: 'weekly',
        priority: 0.6,
        alternates: {
          languages: sitemapAlternates(`/listing/${listing.id}/${listing.slug}`),
        },
      });
    }
  }

  return entries;
}
