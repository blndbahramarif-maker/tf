import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale, type Locale } from '@kurdora/i18n';
import { Link } from '@/lib/i18n/navigation';
import { readSessionState } from '@/lib/auth/server-session';
import { loadConversationForViewer, loadMessages } from '@/infra/messaging/conversation-service';
import { loadOffersForUser } from '@/infra/messaging/offer-service';
import { prisma } from '@/infra/db/client';
import { isUuid } from '@/lib/api/guards';
import { formatMoney } from '@/lib/format/money';
import type { CurrencyCode } from '@/shared/money';
import { Badge } from '../../../../_components/badge';
import {
  MakeOfferForm,
  MarkReadForm,
  ReportConversationForm,
  SendMessageForm,
} from '../../messaging-forms';

export const dynamic = 'force-dynamic';

/**
 * One conversation.
 *
 * `loadConversationForViewer` puts the viewer's id INTO the query, so a
 * non-participant gets null and this page answers `notFound()` — the same
 * answer a made-up id gets. There is no branch here that compares ids after
 * the fact and could be forgotten.
 *
 * Message bodies are rendered as TEXT with `dir="auto"` and never as HTML.
 * That is the whole defence: there is no parsing step to defeat.
 */
export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale as Locale);

  const state = await readSessionState();
  if (state.kind !== 'authenticated') notFound();

  // An unparseable id makes Postgres raise; it cannot name a row anyway.
  if (!isUuid(id)) notFound();

  const viewerId = state.session.principal.userId;
  const conversation = await loadConversationForViewer(id, viewerId);
  if (conversation === null) notFound();

  const { cursor } = await searchParams;
  const t = await getTranslations('messaging.thread');
  const tStatus = await getTranslations('messaging.offerStatus');

  const [page, context, offers] = await Promise.all([
    loadMessages(conversation.id, { cursor: cursor ?? null }),
    prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
      select: {
        listing: {
          select: { id: true, title: true, slug: true, priceMinor: true, currency: true },
        },
        buyer: { select: { id: true, profile: { select: { displayName: true } } } },
        seller: { select: { id: true, profile: { select: { displayName: true } } } },
      },
    }),
    loadOffersForUser(viewerId),
  ]);

  const viewerRole = conversation.buyerId === viewerId ? 'buyer' : 'seller';
  const counterpart = viewerRole === 'buyer' ? context.seller : context.buyer;
  const unread = page.messages.filter((message) => message.senderId !== viewerId).length > 0;
  const threadOffers = offers.filter((offer) => offer.listingId === conversation.listingId);

  // Oldest first reads as a conversation; the query returns newest first
  // because that is what pagination needs.
  const ordered = [...page.messages].reverse();

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div>
        <Link
          href="/dashboard/messages"
          className="text-ink-muted text-sm underline underline-offset-4"
        >
          {t('backToInbox')}
        </Link>

        <h1 className="mt-3 text-2xl font-semibold tracking-tight" dir="auto">
          {context.listing?.title ?? t('noListing')}
        </h1>
        <p className="text-ink-muted mt-1 text-sm" dir="auto">
          {t(viewerRole === 'buyer' ? 'withSeller' : 'withBuyer', {
            name: counterpart.profile?.displayName ?? '',
          })}
        </p>

        {conversation.status === 'REPORTED' ? (
          <p className="border-warning-soft bg-warning-soft mt-4 rounded-md border px-3 py-2 text-sm">
            {t('reportedNotice')}
          </p>
        ) : null}

        {page.nextCursor ? (
          <p className="mt-6">
            {/* A plain link, so history works without JavaScript and the URL
                is shareable. Keyset, not offset: messages arriving mid-read
                must not duplicate or skip a row. */}
            <a
              href={`/${locale}/dashboard/messages/${conversation.id}?cursor=${encodeURIComponent(page.nextCursor)}`}
              className="text-sm underline underline-offset-4"
            >
              {t('older')}
            </a>
          </p>
        ) : null}

        <ol data-testid="message-list" className="mt-6 flex flex-col gap-4">
          {ordered.map((message) => {
            const mine = message.senderId === viewerId;
            return (
              <li
                key={message.id}
                className={`max-w-[46rem] rounded-[--radius-card] border px-4 py-3 ${
                  mine ? 'border-accent/30 bg-accent-soft ms-auto' : 'border-border bg-surface'
                }`}
              >
                <div className="text-ink-muted flex flex-wrap items-center gap-2 text-xs">
                  <span>{mine ? t('you') : (counterpart.profile?.displayName ?? '')}</span>
                  <time dateTime={message.createdAt.toISOString()}>
                    {new Intl.DateTimeFormat(locale, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: 'UTC',
                      numberingSystem: 'latn',
                    }).format(message.createdAt)}
                  </time>
                  {message.moderationStatus === 'PENDING' ? (
                    <Badge tone="warning">{t('underReview')}</Badge>
                  ) : null}
                </div>
                {/*
                  Plain text. `whitespace-pre-wrap` keeps the sender's line
                  breaks; React escapes the content on output. This is never
                  `dangerouslySetInnerHTML`, and there is no markdown step.
                */}
                <p className="mt-1 text-sm whitespace-pre-wrap" dir="auto">
                  {message.body}
                </p>
              </li>
            );
          })}
        </ol>

        <div className="mt-8">
          <SendMessageForm
            conversationId={conversation.id}
            csrfToken={state.session.csrfToken}
            locale={locale}
            disabled={conversation.status === 'BLOCKED'}
          />
        </div>
      </div>

      <aside className="flex flex-col gap-6">
        {unread ? (
          <MarkReadForm
            conversationId={conversation.id}
            csrfToken={state.session.csrfToken}
            locale={locale}
          />
        ) : null}

        {threadOffers.length > 0 ? (
          <section className="border-border rounded-[--radius-card] border p-4">
            <h2 className="text-sm font-semibold">{t('offersTitle')}</h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {threadOffers.map((offer) => (
                <li key={offer.id} className="flex items-center justify-between gap-2">
                  <Link href={`/dashboard/offers/${offer.id}`} className="hover:underline">
                    {formatMoney(offer.amountMinor, offer.currency as CurrencyCode, locale)}
                  </Link>
                  <Badge tone={offer.status === 'ACCEPTED' ? 'accent' : 'neutral'}>
                    {tStatus(offer.status)}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {viewerRole === 'buyer' && context.listing ? (
          <section className="border-border rounded-[--radius-card] border p-4">
            <h2 className="text-sm font-semibold">{t('makeOffer')}</h2>
            <div className="mt-3">
              <MakeOfferForm
                listingId={context.listing.id}
                conversationId={conversation.id}
                currency={context.listing.currency}
                csrfToken={state.session.csrfToken}
                locale={locale}
              />
            </div>
          </section>
        ) : null}

        <ReportConversationForm
          conversationId={conversation.id}
          csrfToken={state.session.csrfToken}
          locale={locale}
          alreadyReported={conversation.status === 'REPORTED'}
        />
      </aside>
    </div>
  );
}
