import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale, type Locale } from '@kurdora/i18n';
import { Link } from '@/lib/i18n/navigation';
import { readSessionState } from '@/lib/auth/server-session';
import { loadSellerListings } from '@/infra/catalogue/dashboard-read-model';
import { formatDate, formatMoney } from '@/lib/format/money';
import { Badge } from '../../../_components/badge';

export const dynamic = 'force-dynamic';

const FILTERS = ['ALL', 'DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'SOLD'] as const;

export default async function SellerListingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale as Locale);

  const state = await readSessionState();
  if (state.kind !== 'authenticated') notFound();

  const { status } = await searchParams;
  const active = FILTERS.includes(status as never) ? (status as string) : 'ALL';

  const t = await getTranslations('dashboard.listings');
  const tStatus = await getTranslations('dashboard.status');

  const listings = await loadSellerListings(state.session.principal.userId, {
    status: active === 'ALL' ? null : active,
  });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <Link
          href="/dashboard/listings/new"
          className="bg-accent text-accent-ink hover:bg-accent-strong rounded-md px-4 py-2 text-sm font-medium"
        >
          {t('newListing')}
        </Link>
      </div>

      <nav
        aria-label={t('filterLabel')}
        className="border-border mt-6 flex flex-wrap gap-1 border-b pb-3"
      >
        {FILTERS.map((filter) => (
          <a
            key={filter}
            href={
              filter === 'ALL'
                ? `/${locale}/dashboard/listings`
                : `/${locale}/dashboard/listings?status=${filter}`
            }
            aria-current={filter === active ? 'true' : undefined}
            className={`rounded px-3 py-1.5 text-sm transition-colors ${
              filter === active
                ? 'bg-surface-sunken text-ink font-medium'
                : 'text-ink-muted hover:text-ink hover:bg-surface-muted'
            }`}
          >
            {filter === 'ALL' ? t('all') : tStatus(filter)}
          </a>
        ))}
      </nav>

      {listings.length === 0 ? (
        <p className="border-border text-ink-muted mt-8 rounded-[--radius-card] border border-dashed px-6 py-12 text-center text-sm">
          {t('empty')}
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="text-ink-muted border-border border-b text-xs uppercase">
              <tr>
                <th scope="col" className="py-2 text-start font-medium">
                  {t('columnTitle')}
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  {t('columnStatus')}
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  {t('columnCategory')}
                </th>
                <th scope="col" className="py-2 text-end font-medium">
                  {t('columnPrice')}
                </th>
                <th scope="col" className="py-2 text-end font-medium">
                  {t('columnImages')}
                </th>
                <th scope="col" className="py-2 text-end font-medium">
                  {t('columnUpdated')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {listings.map((listing) => (
                <tr key={listing.id}>
                  <td className="py-3 pe-3">
                    <Link
                      href={`/dashboard/listings/${listing.id}`}
                      className="font-medium hover:underline"
                      dir="auto"
                    >
                      {listing.title}
                    </Link>
                    {listing.rejectionReason ? (
                      <p className="text-danger mt-1 text-xs">{listing.rejectionReason}</p>
                    ) : null}
                  </td>
                  <td className="py-3 pe-3">
                    <Badge tone={listing.status === 'ACTIVE' ? 'accent' : 'neutral'}>
                      {tStatus(listing.status)}
                    </Badge>
                  </td>
                  <td className="text-ink-muted py-3 pe-3">{listing.categoryName}</td>
                  <td className="py-3 pe-3 text-end tabular-nums">
                    {listing.priceMinor === null
                      ? '—'
                      : formatMoney(listing.priceMinor, listing.currency, locale)}
                  </td>
                  <td className="py-3 pe-3 text-end tabular-nums">
                    {listing.readyImageCount}
                    {listing.imageCount !== listing.readyImageCount
                      ? ` / ${listing.imageCount}`
                      : ''}
                  </td>
                  <td className="text-ink-muted py-3 text-end">
                    {formatDate(listing.updatedAt, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
