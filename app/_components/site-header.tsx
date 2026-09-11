import { useTranslations } from 'next-intl';
import { brand } from '@kurdora/brand';
import { Link } from '@/lib/i18n/navigation';
import type { CategoryTree } from '@/infra/catalogue/read-model';
import { LanguageSwitcher } from './language-switcher';
import { SearchForm } from './search-form';

/**
 * Site header.
 *
 * Top-level categories come from the database, never from a hard-coded list:
 * an admin adding a category must change the navigation without a deploy
 * (CLAUDE.md, non-negotiable 7).
 *
 * Layout uses logical properties throughout, so the whole bar mirrors for
 * Sorani and Arabic without a single direction-specific rule.
 */
export function SiteHeader({
  locale,
  categories,
  searchValue,
}: {
  locale: string;
  categories: CategoryTree;
  searchValue?: string;
}) {
  const t = useTranslations('nav');

  return (
    <header className="border-border bg-surface sticky top-0 z-20 border-b">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-lg font-semibold">
          <span className="bg-accent text-accent-ink flex size-8 items-center justify-center rounded-md text-sm font-bold">
            {brand.name.slice(0, 1)}
          </span>
          <span>{brand.name}</span>
        </Link>

        <div className="order-last w-full min-w-0 md:order-none md:w-auto md:flex-1">
          <SearchForm locale={locale} defaultValue={searchValue} />
        </div>

        <div className="ms-auto flex shrink-0 items-center gap-3">
          <LanguageSwitcher current={locale} />
          <Link
            href="/sell"
            className="border-border hover:border-border-strong hidden rounded-md border px-3 py-2 text-sm font-medium sm:inline-block"
          >
            {t('sell')}
          </Link>
        </div>
      </div>

      {categories.length === 0 ? null : (
        <nav aria-label={t('categories')} className="border-border border-t">
          <ul className="text-ink-muted mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 py-1.5 text-sm lg:px-8">
            {categories.map(({ node }) => (
              <li key={node.id}>
                <Link
                  href={`/c/${node.slug}`}
                  className="hover:text-ink hover:bg-surface-muted block rounded px-3 py-1.5 whitespace-nowrap transition-colors"
                >
                  {node.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
