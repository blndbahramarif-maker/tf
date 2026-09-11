import { useTranslations } from 'next-intl';
import { Link } from '@/lib/i18n/navigation';

/**
 * Locale-aware 404.
 *
 * Reached for an unknown route AND for a listing that is not publicly visible
 * — a draft, a paused listing, or one belonging to someone else. The two are
 * deliberately indistinguishable: a different answer for "exists but hidden"
 * would let anyone enumerate private listings by id.
 */
export default function NotFound() {
  const t = useTranslations('errors');

  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-24 text-center lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t('notFound')}</h1>
      <p className="text-ink-muted mt-3 text-sm">{t('notFoundHint')}</p>
      <Link
        href="/"
        className="bg-accent text-accent-ink hover:bg-accent-strong mt-8 inline-block rounded-md px-5 py-2.5 text-sm font-medium transition-colors"
      >
        {t('backHome')}
      </Link>
    </main>
  );
}
