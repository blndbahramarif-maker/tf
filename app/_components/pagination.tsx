import { useTranslations } from 'next-intl';
import { withParams, type PageSearchParams } from '@/lib/search/params';

/**
 * Cursor pagination.
 *
 * Forward-only by design. A keyset cursor encodes "resume after this row" for
 * one particular ordering; it cannot be reversed, and offset pagination over a
 * large, constantly-changing listing table both drifts (rows shift between
 * pages as listings are published) and degrades. Readers get a next link and a
 * way back to the first page; crawlers get `rel="next"`, which is what they
 * actually follow.
 */
export function Pagination({
  basePath,
  params,
  nextCursor,
}: {
  basePath: string;
  params: PageSearchParams;
  nextCursor: string | null;
}) {
  const t = useTranslations('search');
  const isFirstPage = params.cursor === undefined;

  if (nextCursor === null && isFirstPage) return null;

  return (
    <nav aria-label={t('paginationLabel')} className="mt-10 flex items-center justify-center gap-4">
      {isFirstPage ? null : (
        <a
          href={`${basePath}${withParams(params, { cursor: null })}`}
          className="border-border hover:border-border-strong rounded-md border px-4 py-2 text-sm font-medium"
        >
          {t('firstPage')}
        </a>
      )}
      {nextCursor === null ? null : (
        <a
          rel="next"
          href={`${basePath}${withParams(params, { cursor: nextCursor })}`}
          className="bg-accent text-accent-ink hover:bg-accent-strong rounded-md px-5 py-2 text-sm font-medium transition-colors"
        >
          {t('nextPage')}
        </a>
      )}
    </nav>
  );
}
