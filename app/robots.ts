import type { MetadataRoute } from 'next';
import { canonicalUrl } from '@/lib/seo/urls';

/**
 * Crawl rules.
 *
 * `/api/` and `/media/` are disallowed: the API is a machine contract with its
 * own rate limits, and media derivatives are already reachable through the
 * pages that embed them. `/*\/search` is disallowed for the reason given on the
 * search page itself — indexing filter permutations buries real listings.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/media/', '/*/search'],
      },
    ],
    sitemap: canonicalUrl('/sitemap.xml'),
  };
}
