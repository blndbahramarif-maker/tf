import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale, type Locale } from '@kurdora/i18n';
import { Link } from '@/lib/i18n/navigation';
import { readSessionState } from '@/lib/auth/server-session';
import { loadOffersForUser } from '@/infra/messaging/offer-service';
import { hasExpired } from '@/domain/offers/offer-status';
import { formatDate, formatMoney } from '@/lib/format/money';
import type { CurrencyCode } from '@/shared/money';
import { Badge } from '../../../_components/badge';

export const dynamic = 'force-dynamic';

const VIEWS = ['all', 'buyer', 'seller'] as const;

/**
 * Offers made and received.
 *
 * `role` narrows; nothing widens. The read model scopes by the viewer's id
 * whichever view is chosen, so a crafted query string cannot reach anyone
 * else's offers.
 *
 * The filter is a plain GET link, so the view is shareable and works without
 * JavaScript.
 */
export default async function OffersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ role?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale as Locale);

  const state = await readSessionState();
  if (state.kind !== 'authenticated') notFound();

  const { role } = await searchParams;
  const view = VIEWS.includes(role as never) ? (role as (typeof VIEWS)[number]) : 'all';

  const t = await getTranslations('messaging.offers');
  const tStatus = await getTranslations('messaging.offerStatus');

  const offers = await loadOffersForUser(state.session.principal.userId, {
    role: view === 'all' ? undefined : view,
  });

  const now = new Date();

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-ink-muted mt-2 text-sm">{t('noPayment')}</p>

      <nav
        aria-label={t('filterLabel')}
        className="border-border mt-6 flex flex-wrap gap-1 border-b pb-3"
      >
        {VIEWS.map((option) => (
          <a
            key={option}
            href={
              option === 'all'
                ? `/${locale}/dashboard/offers`
                : `/${locale}/dashboard/offers?role=${option}`
            }
            aria-current={option === view ? 'true' : undefined}
            className={`rounded px-3 py-1.5 text-sm transition-colors ${
              option === view
                ? 'bg-surface-sunken text-ink font-medium'
                : 'text-ink-muted hover:text-ink hover:bg-surface-muted'
            }`}
          >
            {t(`view.${option}`)}
          </a>
        ))}
      </nav>

      {offers.length === 0 ? (
        <p className="border-border text-ink-muted mt-8 rounded-[--radius-card] border border-dashed px-6 py-12 text-center text-sm">
          {t('empty')}
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[42rem] text-sm">
            <thead className="text-ink-muted border-border border-b text-xs uppercase">
              <tr>
                <th scope="col" className="py-2 text-start font-medium">
                  {t('columnListing')}
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  {t('columnRole')}
                </th>
                <th scope="col" className="py-2 text-end font-medium">
                  {t('columnAmount')}
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  {t('columnStatus')}
                </th>
                <th scope="col" className="py-2 text-end font-medium">
                  {t('columnExpires')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {offers.map((offer) => {
                /*
                 * Expiry is evaluated HERE as well as on the server that will
                 * refuse the move, so a row cannot claim to be answerable when
                 * a sweeper has not run. The database is not the authority on
                 * "still open"; the clock is.
                 */
                const expired = hasExpired(offer.status, offer.expiresAt, now);
                const shown = expired ? 'EXPIRED' : offer.status;

                return (
                  <tr key={offer.id}>
                    <td className="py-3 pe-3">
                      <Link
                        href={`/dashboard/offers/${offer.id}`}
                        className="font-medium hover:underline"
                        dir="auto"
                      >
                        {offer.listingTitle}
                      </Link>
                      <p className="text-ink-muted mt-0.5 text-xs" dir="auto">
                        {offer.counterpartName}
                      </p>
                    </td>
                    <td className="text-ink-muted py-3 pe-3">
                      {t(offer.viewerRole === 'buyer' ? 'roleBuyer' : 'roleSeller')}
                    </td>
                    <td className="py-3 pe-3 text-end font-medium whitespace-nowrap">
                      {formatMoney(offer.amountMinor, offer.currency as CurrencyCode, locale)}
                    </td>
                    <td className="py-3 pe-3">
                      <Badge tone={shown === 'ACCEPTED' ? 'accent' : 'neutral'}>
                        {tStatus(shown)}
                      </Badge>
                    </td>
                    <td className="text-ink-muted py-3 text-end whitespace-nowrap">
                      {formatDate(offer.expiresAt, locale)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
