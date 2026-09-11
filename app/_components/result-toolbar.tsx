import { useTranslations } from 'next-intl';
import { formatCount } from '@/lib/format/money';
import { withParams, type PageSearchParams } from '@/lib/search/params';

const SORTS = ['relevance', 'newest', 'price_asc', 'price_desc'] as const;

/**
 * Result count and sort control.
 *
 * Sort options are links, not a scripted `<select>`: each sort order gets its
 * own URL, which is shareable and does not need a client bundle. Changing sort
 * drops the pagination cursor — resuming a cursor built for a different
 * ordering would silently skip rows.
 */
export function ResultToolbar({
  basePath,
  locale,
  params,
  totalMatches,
  cappedAt,
  activeSort,
  hasText,
}: {
  basePath: string;
  locale: string;
  params: PageSearchParams;
  totalMatches: number;
  cappedAt: number;
  activeSort: string;
  hasText: boolean;
}) {
  const t = useTranslations('search');

  const countLabel =
    totalMatches >= cappedAt
      ? t('resultsCapped', { count: formatCount(cappedAt, locale) })
      : t('resultsCount', { count: totalMatches });

  return (
    <div className="border-border flex flex-wrap items-center justify-between gap-4 border-b pb-3">
      <p className="text-ink-muted text-sm" aria-live="polite">
        {countLabel}
      </p>

      <nav aria-label={t('sortLabel')} className="flex flex-wrap items-center gap-1">
        <span className="text-ink-muted me-1 text-sm">{t('sortLabel')}</span>
        {SORTS
          // Relevance ranking is meaningless without a search term.
          .filter((sort) => sort !== 'relevance' || hasText)
          .map((sort) => {
            const isActive = sort === activeSort;
            return (
              <a
                key={sort}
                href={`${basePath}${withParams(params, { sort, cursor: null })}`}
                aria-current={isActive ? 'true' : undefined}
                className={`rounded px-2.5 py-1 text-sm transition-colors ${
                  isActive
                    ? 'bg-surface-sunken text-ink font-medium'
                    : 'text-ink-muted hover:text-ink hover:bg-surface-muted'
                }`}
              >
                {t(`sort.${sort}`)}
              </a>
            );
          })}
      </nav>
    </div>
  );
}
