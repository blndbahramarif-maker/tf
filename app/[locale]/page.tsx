import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale, type Locale } from '@kurdora/i18n';
import { brand } from '@kurdora/brand';
import { Link } from '@/lib/i18n/navigation';
import { loadCategoryTree } from '@/infra/catalogue/read-model';
import { postgresSearch } from '@/infra/search/postgres-search';
import { parseSearchQuery } from '@/domain/search/query';
import { formatCount } from '@/lib/format/money';
import { alternatesFor, canonicalUrl } from '@/lib/seo/urls';
import { ListingGrid } from '../_components/listing-grid';
import { SearchForm } from '../_components/search-form';
import { JsonLd } from '../_components/json-ld';

export const dynamic = 'force-dynamic';

const RECENT_LIMIT = 8;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const t = await getTranslations({ locale, namespace: 'meta' });

  return {
    title: t('tagline'),
    description: t('defaultDescription', { brandName: brand.name }),
    alternates: alternatesFor('/', locale),
  };
}

/**
 * Marketplace home.
 *
 * Categories and recent listings both come from the database. There is no
 * hard-coded category list, no hard-coded copy and no hard-coded price — a
 * launch in a second country is configuration, not a release.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale as Locale);

  const t = await getTranslations('home');
  const tNav = await getTranslations('nav');

  const [categories, recent] = await Promise.all([
    loadCategoryTree(locale),
    postgresSearch.search(parseSearchQuery({ sort: 'newest', limit: String(RECENT_LIMIT) })),
  ]);

  return (
    <main id="main">
      <section className="bg-surface-inverse text-ink-inverse">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center lg:px-8 lg:py-24">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl lg:text-5xl">
            {t('heroHeading')}
          </h1>
          <p className="text-ink-inverse-muted mx-auto mt-4 max-w-2xl text-base text-pretty sm:text-lg">
            {t('heroSubheading', { brandName: brand.name })}
          </p>
          <div className="mx-auto mt-8 max-w-2xl">
            <SearchForm locale={locale} size="lg" />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 py-12 lg:px-8">
        <section aria-labelledby="categories-heading">
          <h2 id="categories-heading" className="text-xl font-semibold tracking-tight">
            {t('browseHeading')}
          </h2>

          {categories.length === 0 ? (
            <p className="text-ink-muted mt-4 text-sm">{t('noCategories')}</p>
          ) : (
            <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {categories.map(({ node, children }) => (
                <li key={node.id}>
                  <Link
                    href={`/c/${node.slug}`}
                    className="border-border bg-surface hover:border-accent focus-visible:border-accent flex h-full flex-col gap-2 rounded-[--radius-card] border p-5 transition-colors"
                  >
                    <span className="text-base font-medium">{node.name}</span>
                    {node.description === null ? null : (
                      <span className="text-ink-muted line-clamp-2 text-sm">
                        {node.description}
                      </span>
                    )}
                    <span className="text-ink-muted mt-auto pt-3 text-xs">
                      {t('categoryListingCount', { count: node.activeListingCount })}
                    </span>
                    {children.length === 0 ? null : (
                      <span className="text-ink-muted text-xs">
                        {t('categorySubcount', { count: children.length })}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="recent-heading" className="mt-14">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="recent-heading" className="text-xl font-semibold tracking-tight">
              {t('recentHeading')}
            </h2>
            <Link
              href="/search"
              className="text-accent-strong text-sm underline underline-offset-4"
            >
              {tNav('browseAll')}
            </Link>
          </div>

          <div className="mt-6">
            <ListingGrid items={recent.items} locale={locale} emptyMessage={t('noListings')} />
          </div>

          {recent.totalMatches === 0 ? null : (
            <p className="text-ink-muted mt-4 text-sm">
              {t('totalActive', { count: formatCount(recent.totalMatches, locale) })}
            </p>
          )}
        </section>
      </div>

      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: brand.name,
          url: canonicalUrl(`/${locale}`),
          inLanguage: locale,
          potentialAction: {
            '@type': 'SearchAction',
            target: {
              '@type': 'EntryPoint',
              urlTemplate: `${canonicalUrl(`/${locale}/search`)}?q={search_term_string}`,
            },
            'query-input': 'required name=search_term_string',
          },
        }}
      />
    </main>
  );
}
