import { useTranslations } from 'next-intl';
import { Link } from '@/lib/i18n/navigation';

export interface Crumb {
  readonly label: string;
  /** Absent on the final crumb, which is the current page. */
  readonly href?: string;
}

/**
 * Breadcrumb trail.
 *
 * The separator is a CSS pseudo-element rather than a character in the markup,
 * so it is not announced by a screen reader and does not need mirroring for
 * RTL — the list itself flips with the document direction.
 */
export function Breadcrumbs({ crumbs }: { crumbs: readonly Crumb[] }) {
  const t = useTranslations('nav');

  return (
    <nav aria-label={t('breadcrumb')}>
      <ol className="text-ink-muted flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {crumbs.map((crumb, index) => (
          <li key={`${crumb.label}-${index}`} className="flex items-center gap-x-2">
            {index === 0 ? null : (
              <span aria-hidden="true" className="text-border-strong">
                /
              </span>
            )}
            {crumb.href === undefined ? (
              <span aria-current="page" className="text-ink">
                {crumb.label}
              </span>
            ) : (
              <Link href={crumb.href} className="hover:text-ink underline-offset-2 hover:underline">
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
