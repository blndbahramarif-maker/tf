import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale, type Locale } from '@kurdora/i18n';
import { Link } from '@/lib/i18n/navigation';
import { readSessionState } from '@/lib/auth/server-session';
import { loadConversationForViewer } from '@/infra/messaging/conversation-service';
import { prisma } from '@/infra/db/client';
import { isUuid } from '@/lib/api/guards';
import { formatMoney } from '@/lib/format/money';
import type { CurrencyCode } from '@/shared/money';
import { ContactSellerForm, MakeOfferForm } from '../../messaging-forms';

export const dynamic = 'force-dynamic';

/**
 * Contact a seller about a listing.
 *
 * Reached from a listing page. It lives under the dashboard so the
 * authentication gate in the layout applies without this page repeating it —
 * though the ACTION it posts to repeats the whole guard anyway, because a
 * Server Action is a public POST endpoint and being behind a gated page is not
 * a security property.
 *
 * If a thread already exists, the visitor is sent straight to it rather than
 * being offered a second one: one thread per (listing, buyer, seller).
 */
export default async function ContactSellerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ listing?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale as Locale);

  const state = await readSessionState();
  if (state.kind !== 'authenticated') notFound();

  const { listing: listingId } = await searchParams;
  if (typeof listingId !== 'string' || !isUuid(listingId)) notFound();

  const viewerId = state.session.principal.userId;
  const t = await getTranslations('messaging.contact');

  const listing = await prisma.listing.findFirst({
    // Only a LIVE listing can be contacted, and a draft or paused one is
    // indistinguishable from one that does not exist.
    where: { id: listingId, status: 'ACTIVE', deletedAt: null },
    select: {
      id: true,
      title: true,
      priceMinor: true,
      currency: true,
      sellerProfile: { select: { userId: true, displayName: true } },
      category: { select: { transactionFlow: true } },
    },
  });
  if (listing === null) notFound();

  if (listing.sellerProfile.userId === viewerId) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-ink-muted mt-4 text-sm">{t('ownListing')}</p>
      </div>
    );
  }

  const existing = await prisma.conversation.findUnique({
    where: {
      listingId_buyerId_sellerId: {
        listingId: listing.id,
        buyerId: viewerId,
        sellerId: listing.sellerProfile.userId,
      },
    },
    select: { id: true },
  });

  // Re-checked through the viewer-scoped loader, so this page never renders a
  // link from an id it has not proven the viewer is a party to.
  const thread = existing === null ? null : await loadConversationForViewer(existing.id, viewerId);

  const currency = listing.currency as CurrencyCode;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-ink-muted mt-2 text-sm" dir="auto">
        {t('about', {
          title: listing.title,
          seller: listing.sellerProfile.displayName,
        })}
      </p>
      {listing.priceMinor === null ? null : (
        <p className="mt-1 text-sm font-medium">
          {formatMoney(listing.priceMinor, currency, locale)}
        </p>
      )}

      {thread === null ? (
        <div className="mt-6">
          <ContactSellerForm
            listingId={listing.id}
            csrfToken={state.session.csrfToken}
            locale={locale}
          />
        </div>
      ) : (
        <p className="mt-6 text-sm">
          <Link href={`/dashboard/messages/${thread.id}`} className="underline underline-offset-4">
            {t('existing')}
          </Link>
        </p>
      )}

      <section className="border-border mt-10 border-t pt-6">
        <h2 className="text-sm font-semibold">{t('offerTitle')}</h2>
        <p className="text-ink-muted mt-1 text-sm">
          {/*
            Keyed by the category's transaction flow, which is DATA on the
            category row. No branch here knows a category by name.
          */}
          {t(`offerNotice.${listing.category.transactionFlow}`)}
        </p>
        <div className="mt-4">
          <MakeOfferForm
            listingId={listing.id}
            {...(thread === null ? {} : { conversationId: thread.id })}
            currency={listing.currency}
            csrfToken={state.session.csrfToken}
            locale={locale}
          />
        </div>
      </section>
    </div>
  );
}
