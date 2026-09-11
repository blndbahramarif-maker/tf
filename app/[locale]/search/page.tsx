import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale, type Locale } from '@kurdora/i18n';
import { postgresSearch } from '@/infra/search/postgres-search';
import { loadCategoryTree } from '@/infra/catalogue/read-model';
import { Link } from '@/lib/i18n/navigation';
import { buildSearchQuery, withParams, type PageSearchParams } from '@/lib/search/params';
import { alternatesFor } from '@/lib/seo/urls';
import { ListingGrid } from '../../_components/listing-grid';
import { Pagination } from '../../_components/pagination';
import { ResultToolbar } from '../../_components/result-toolbar';
import { SearchForm } from '../../_components/search-form';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 24;
const COUNT_CAP = 1000;
const FILTER_CURRENCY = 'GBP';

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<PageSearchParams>;
};

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const { q } = await searchParams;
  const term = typeof q === 'string' ? q : '';
  const t = await getTranslations({ locale, namespace: 'search' });

  return {
    title: term === '' ? t('title') : t('titleWithTerm', { term }),
    alternates: alternatesFor('/search', locale),
    /*
     * A result page is thin, near-duplicate content that a crawler should
     * reach through its links but never index in its own right. Indexing
     * every filter permutation is how a marketplace buries its own listings.
     */
    robots: { index: false, follow: true },
  };
}

/** Cross-category search. Narrowing by category is a link into that category. */
export default async function SearchPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale as Locale);

  const resolvedSearchParams = await searchParams;
  const term = typeof resolvedSearchParams.q === 'string' ? resolvedSearchParams.q : '';

  const query = buildSearchQuery({
    params: resolvedSearchParams,
    categoryPath: null,
    currency: FILTER_CURRENCY,
    limit: PAGE_SIZE,
  });

  const [results, categories] = await Promise.all([
    postgresSearch.search(query),
    loadCategoryTree(locale),
  ]);

  const t = await getTranslations('search');
  const basePath = `/${locale}/search`;

  return (
    <main id="main" className="mx-auto max-w-7xl px-4 py-8 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">
        {term === '' ? t('title') : t('titleWithTerm', { term })}
      </h1>

      <div className="mt-6 max-w-2xl">
        <SearchForm locale={locale} defaultValue={term} size="lg" />
      </div>

      {categories.length === 0 ? null : (
        <nav aria-label={t('narrowByCategory')} className="mt-6">
          <ul className="flex flex-wrap gap-2">
            {categories.map(({ node }) => (
              <li key={node.id}>
                <Link
                  href={`/c/${node.slug}${withParams({ q: term }, {})}`}
                  className="border-border bg-surface hover:border-border-strong rounded-full border px-3.5 py-1.5 text-sm transition-colors"
                >
                  {node.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div className="mt-8">
        <ResultToolbar
          basePath={basePath}
          locale={locale}
          params={resolvedSearchParams}
          totalMatches={results.totalMatches}
          cappedAt={COUNT_CAP}
          activeSort={query.sort}
          hasText={query.text !== null}
        />

        <div className="mt-6">
          <ListingGrid
            items={results.items}
            locale={locale}
            emptyMessage={term === '' ? t('emptyPrompt') : undefined}
          />
        </div>

        <Pagination
          basePath={basePath}
          params={resolvedSearchParams}
          nextCursor={results.nextCursor}
        />
      </div>
    </main>
  );
}
