import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale, type Locale } from '@kurdora/i18n';
import { loadCategoryDetail } from '@/infra/catalogue/read-model';
import { postgresSearch } from '@/infra/search/postgres-search';
import { Link } from '@/lib/i18n/navigation';
import { buildSearchQuery, type PageSearchParams } from '@/lib/search/params';
import { alternatesFor, canonicalUrl } from '@/lib/seo/urls';
import { Breadcrumbs } from '../../../_components/breadcrumbs';
import { FilterPanel } from '../../../_components/filter-panel';
import { JsonLd } from '../../../_components/json-ld';
import { ListingGrid } from '../../../_components/listing-grid';
import { Pagination } from '../../../_components/pagination';
import { ResultToolbar } from '../../../_components/result-toolbar';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 24;
/** Matches the adapter's capped count, so the UI never over-promises. */
const COUNT_CAP = 1000;

/**
 * Listing currency for the price filter's decimal precision.
 *
 * UK launch is GBP (DL-4). When a second country goes live this becomes the
 * country's currency rather than a constant — the value is already threaded
 * through as a parameter so that change touches one line.
 */
const FILTER_CURRENCY = 'GBP';

type PageProps = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<PageSearchParams>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};

  const category = await loadCategoryDetail(slug, locale);
  if (category === null) return {};

  const t = await getTranslations({ locale, namespace: 'category' });

  return {
    title: category.name,
    description: category.description ?? t('metaDescription', { category: category.name }),
    alternates: alternatesFor(`/c/${slug}`, locale),
  };
}

/**
 * Category browse.
 *
 * The filter panel is generated from the category's own attribute definitions,
 * so a category with different attributes gets a different panel with no code
 * change. Nothing in this file branches on a category name.
 */
export default async function CategoryPage({ params, searchParams }: PageProps) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale as Locale);

  const category = await loadCategoryDetail(slug, locale);
  if (category === null) notFound();

  const resolvedSearchParams = await searchParams;

  const query = buildSearchQuery({
    params: resolvedSearchParams,
    // The materialised path scopes results to this category AND its subtree.
    categoryPath: category.path,
    currency: FILTER_CURRENCY,
    limit: PAGE_SIZE,
  });

  const [results, facets] = await Promise.all([
    postgresSearch.search(query),
    category.filterable.length === 0
      ? Promise.resolve(null)
      : postgresSearch.facets(
          query,
          category.filterable.map((attribute) => attribute.key),
        ),
  ]);

  const t = await getTranslations('category');
  const tNav = await getTranslations('nav');

  const basePath = `/${locale}/c/${slug}`;

  return (
    <main id="main" className="mx-auto max-w-7xl px-4 py-8 lg:px-8">
      <Breadcrumbs
        crumbs={[
          { label: tNav('home'), href: '/' },
          ...category.ancestors.map((ancestor) => ({
            label: ancestor.name,
            href: `/c/${ancestor.slug}`,
          })),
          { label: category.name },
        ]}
      />

      <header className="mt-4">
        <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">{category.name}</h1>
        {category.description === null ? null : (
          <p className="text-ink-muted mt-2 max-w-3xl text-sm text-pretty">
            {category.description}
          </p>
        )}
        {/*
          Transaction behaviour is DATA on the category row. The notice tells a
          buyer what to expect before they invest time in a listing; the copy is
          keyed by the flow value, so a new flow adds a message, not a branch.
        */}
        <p className="text-ink-muted mt-3 text-sm">{t(`flowNotice.${category.transactionFlow}`)}</p>
      </header>

      {category.children.length === 0 ? null : (
        <nav aria-label={t('subcategories')} className="mt-6">
          <ul className="flex flex-wrap gap-2">
            {category.children.map((child) => (
              <li key={child.id}>
                <Link
                  href={`/c/${child.slug}`}
                  className="border-border bg-surface hover:border-border-strong inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors"
                >
                  <span>{child.name}</span>
                  <span className="text-ink-muted text-xs tabular-nums">
                    {child.activeListingCount}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-32 lg:self-start">
          <FilterPanel
            locale={locale}
            categorySlug={slug}
            attributes={category.filterable}
            facets={facets}
            params={resolvedSearchParams}
            currency={FILTER_CURRENCY}
          />
        </aside>

        <section aria-label={t('results')}>
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
            <ListingGrid items={results.items} locale={locale} />
          </div>

          <Pagination
            basePath={basePath}
            params={resolvedSearchParams}
            nextCursor={results.nextCursor}
          />
        </section>
      </div>

      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { label: tNav('home'), path: `/${locale}` },
            ...category.ancestors.map((ancestor) => ({
              label: ancestor.name,
              path: `/${locale}/c/${ancestor.slug}`,
            })),
            { label: category.name, path: basePath },
          ].map((crumb, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: crumb.label,
            item: canonicalUrl(crumb.path),
          })),
        }}
      />
    </main>
  );
}
