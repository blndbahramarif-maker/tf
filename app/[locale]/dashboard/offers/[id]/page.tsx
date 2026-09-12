import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale, type Locale } from '@kurdora/i18n';
import { Link } from '@/lib/i18n/navigation';
import { readSessionState } from '@/lib/auth/server-session';
import { loadOfferForParty, loadOfferHistory, resolveActor } from '@/infra/messaging/offer-service';
import { availableTransitions, hasExpired } from '@/domain/offers/offer-status';
import { isUuid } from '@/lib/api/guards';
import { formatMoney } from '@/lib/format/money';
import type { CurrencyCode } from '@/shared/money';
import { Badge } from '../../../../_components/badge';
import { OfferActions } from '../../messaging-forms';

export const dynamic = 'force-dynamic';

/**
 * One offer, its available moves, and its history.
 *
 * `loadOfferForParty` scopes by the viewer — the buyer is the offer's
 * `buyerId`, the seller is the listing's owner — so anyone else gets null and
 * this page answers `notFound()`. The viewer's ROLE is then resolved from
 * those same rows; nothing about who is acting comes from the URL.
 *
 * The buttons are rendered from the transition table for that resolved role.
 * They are a convenience, not the control: submitting a move the table does
 * not grant this actor is refused server-side with a conflict.
 */
export default async function OfferPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale as Locale);

  const state = await readSessionState();
  if (state.kind !== 'authenticated') notFound();
  if (!isUuid(id)) notFound();

  const viewerId = state.session.principal.userId;
  const offer = await loadOfferForParty(id, viewerId);
  if (offer === null) notFound();

  const actor = resolveActor(offer, viewerId);
  if (actor === null) notFound();

  const t = await getTranslations('messaging.offerDetail');
  const tStatus = await getTranslations('messaging.offerStatus');

  const history = await loadOfferHistory(offer.id);
  const now = new Date();
  // Evaluated on read: an offer past its window reports EXPIRED rather than
  // pretending it is still answerable because nothing swept it.
  const expired = hasExpired(offer.status, offer.expiresAt, now);
  const shown = expired ? 'EXPIRED' : offer.status;

  const moves = expired
    ? []
    : availableTransitions(offer.status, actor).map((transition) => ({
        to: transition.to,
        description: transition.description,
      }));

  const currency = offer.currency as CurrencyCode;
  const dateTime = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
    numberingSystem: 'latn',
  });

  return (
    <div className="max-w-3xl">
      <Link
        href="/dashboard/offers"
        className="text-ink-muted text-sm underline underline-offset-4"
      >
        {t('backToOffers')}
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" dir="auto">
            {offer.listingTitle}
          </h1>
          <p className="text-ink-muted mt-1 text-sm">
            {t(actor === 'buyer' ? 'youOffered' : 'theyOffered')}
          </p>
        </div>
        <Badge tone={shown === 'ACCEPTED' ? 'accent' : 'neutral'}>{tStatus(shown)}</Badge>
      </div>

      <dl className="border-border mt-6 grid grid-cols-1 gap-4 rounded-[--radius-card] border p-4 sm:grid-cols-3">
        <div>
          <dt className="text-ink-muted text-xs uppercase">{t('amount')}</dt>
          <dd className="mt-1 text-lg font-semibold">
            {formatMoney(offer.amountMinor, currency, locale)}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted text-xs uppercase">{t('expires')}</dt>
          <dd className="mt-1 text-sm">{dateTime.format(offer.expiresAt)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted text-xs uppercase">{t('listing')}</dt>
          <dd className="mt-1 text-sm">
            <a
              href={`/${locale}/listing/${offer.listingId}/${offer.listingSlug}`}
              className="underline underline-offset-4"
            >
              {t('viewListing')}
            </a>
          </dd>
        </div>
      </dl>

      {offer.message ? (
        <section className="mt-6">
          <h2 className="text-sm font-semibold">{t('messageTitle')}</h2>
          {/* Buyer-written text: plain, with its own direction, never HTML. */}
          <p className="mt-2 text-sm whitespace-pre-wrap" dir="auto">
            {offer.message}
          </p>
        </section>
      ) : null}

      {offer.conversationId ? (
        <p className="mt-6">
          <Link
            href={`/dashboard/messages/${offer.conversationId}`}
            className="text-sm underline underline-offset-4"
          >
            {t('openThread')}
          </Link>
        </p>
      ) : null}

      <section className="mt-8">
        <h2 className="text-sm font-semibold">{t('actionsTitle')}</h2>
        <p className="text-ink-muted mt-1 text-xs">{t('noPayment')}</p>
        <div className="mt-3">
          <OfferActions
            offerId={offer.id}
            transitions={moves}
            csrfToken={state.session.csrfToken}
            locale={locale}
          />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">{t('historyTitle')}</h2>
        <p className="text-ink-muted mt-1 text-xs">{t('historyNote')}</p>

        <ol className="border-border mt-3 divide-y rounded-[--radius-card] border">
          {history.map((event) => (
            <li key={event.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <span className="text-sm font-medium">{tStatus(event.toStatus)}</span>
              <span className="text-ink-muted text-xs">{t(`actor.${event.actorRole}`)}</span>
              <time
                dateTime={event.createdAt.toISOString()}
                className="text-ink-muted ms-auto text-xs"
              >
                {dateTime.format(event.createdAt)}
              </time>
              {event.note ? (
                <p className="text-ink-muted w-full text-xs" dir="auto">
                  {event.note}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
