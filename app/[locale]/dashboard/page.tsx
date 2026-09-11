import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale, type Locale } from '@kurdora/i18n';
import { Link } from '@/lib/i18n/navigation';
import { readSessionState } from '@/lib/auth/server-session';
import { loadSellerListings, loadSellerOverview } from '@/infra/catalogue/dashboard-read-model';
import { formatMoney } from '@/lib/format/money';
import { Badge } from '../../_components/badge';

export const dynamic = 'force-dynamic';

const TRACKED = ['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'SOLD', 'REJECTED'] as const;

export default async function DashboardHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale as Locale);

  // The layout already gated this, but the page re-reads rather than trusting
  // that: defence in depth costs one cached call.
  const state = await readSessionState();
  if (state.kind !== 'authenticated') notFound();

  const t = await getTranslations('dashboard.home');
  const tStatus = await getTranslations('dashboard.status');

  const overview = await loadSellerOverview(state.session.principal.userId);

  if (overview === null) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <div className="border-border mt-8 rounded-[--radius-card] border border-dashed p-8 text-center">
          <p className="text-ink-muted text-sm">{t('noSellerProfile')}</p>
          <Link
            href="/dashboard/profile"
            className="bg-accent text-accent-ink hover:bg-accent-strong mt-4 inline-block rounded-md px-4 py-2 text-sm font-medium"
          >
            {t('createSellerProfile')}
          </Link>
        </div>
      </>
    );
  }

  const recent = await loadSellerListings(state.session.principal.userId, { limit: 5 });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-ink-muted mt-1 text-sm" dir="auto">
            {overview.displayName}
            {overview.verificationStatus === 'VERIFIED' ? (
              <span className="ms-2 align-middle">
                <Badge tone="accent">{t('verified')}</Badge>
              </span>
            ) : null}
          </p>
        </div>
        <Link
          href="/dashboard/listings/new"
          className="bg-accent text-accent-ink hover:bg-accent-strong rounded-md px-4 py-2 text-sm font-medium"
        >
          {t('newListing')}
        </Link>
      </div>

      <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {TRACKED.map((status) => (
          <div key={status} className="border-border rounded-[--radius-card] border p-4">
            <dt className="text-ink-muted text-xs">{tStatus(status)}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">
              {overview.counts[status] ?? 0}
            </dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="recent-heading" className="mt-10">
        <h2 id="recent-heading" className="text-lg font-semibold">
          {t('recentHeading')}
        </h2>
        {recent.length === 0 ? (
          <p className="text-ink-muted mt-3 text-sm">{t('noListings')}</p>
        ) : (
          <ul className="border-border divide-border mt-3 divide-y rounded-[--radius-card] border">
            {recent.map((listing) => (
              <li key={listing.id} className="flex flex-wrap items-center gap-3 p-4">
                <Link
                  href={`/dashboard/listings/${listing.id}`}
                  className="flex-1 text-sm font-medium hover:underline"
                  dir="auto"
                >
                  {listing.title}
                </Link>
                <Badge>{tStatus(listing.status)}</Badge>
                {listing.priceMinor === null ? null : (
                  <span className="text-sm tabular-nums">
                    {formatMoney(listing.priceMinor, listing.currency, locale)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
