import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale, type Locale } from '@kurdora/i18n';
import { Link } from '@/lib/i18n/navigation';
import { readSessionState } from '@/lib/auth/server-session';
import { loadInbox } from '@/infra/messaging/conversation-service';
import { formatCount, formatDate } from '@/lib/format/money';
import { Badge } from '../../../_components/badge';

export const dynamic = 'force-dynamic';

/**
 * The inbox.
 *
 * A server component reading through the messaging read model rather than
 * fetching our own HTTP API. The read model scopes every query by the viewer's
 * id, so there is no filter on this page that could widen it — the list simply
 * cannot contain a thread the viewer is not in.
 *
 * Desktop-first: a table at `md` and up, stacked cards below. Both render the
 * same data, and neither depends on JavaScript.
 */
export default async function InboxPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale as Locale);

  const state = await readSessionState();
  if (state.kind !== 'authenticated') notFound();

  const t = await getTranslations('messaging.inbox');
  const threads = await loadInbox(state.session.principal.userId);

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-ink-muted mt-2 text-sm">{t('intro')}</p>

      {threads.length === 0 ? (
        <p className="border-border text-ink-muted mt-8 rounded-[--radius-card] border border-dashed px-6 py-12 text-center text-sm">
          {t('empty')}
        </p>
      ) : (
        <>
          {/* Stacked on phones. */}
          <ul className="mt-6 flex flex-col gap-3 md:hidden">
            {threads.map((thread) => (
              <li key={thread.id} className="border-border rounded-[--radius-card] border p-4">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={`/dashboard/messages/${thread.id}`}
                    className="font-medium hover:underline"
                    dir="auto"
                  >
                    {thread.listingTitle ?? t('noListing')}
                  </Link>
                  {thread.unreadCount > 0 ? (
                    <Badge tone="accent">{formatCount(thread.unreadCount, locale)}</Badge>
                  ) : null}
                </div>
                <p className="text-ink-muted mt-1 text-xs">
                  {t(thread.viewerRole === 'buyer' ? 'withSeller' : 'withBuyer', {
                    name: thread.counterpartName,
                  })}
                </p>
                {/* Seller-written text: its own direction, never HTML. */}
                <p className="text-ink-muted mt-2 line-clamp-2 text-sm" dir="auto">
                  {thread.lastMessagePreview}
                </p>
                {thread.lastMessageAt ? (
                  <p className="text-ink-muted mt-2 text-xs">
                    {formatDate(thread.lastMessageAt, locale)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>

          <div className="mt-6 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="text-ink-muted border-border border-b text-xs uppercase">
                <tr>
                  <th scope="col" className="py-2 text-start font-medium">
                    {t('columnListing')}
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    {t('columnWith')}
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    {t('columnLatest')}
                  </th>
                  <th scope="col" className="py-2 text-end font-medium">
                    {t('columnUnread')}
                  </th>
                  <th scope="col" className="py-2 text-end font-medium">
                    {t('columnUpdated')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {threads.map((thread) => (
                  <tr key={thread.id}>
                    <td className="py-3 pe-3">
                      <Link
                        href={`/dashboard/messages/${thread.id}`}
                        className="font-medium hover:underline"
                        dir="auto"
                      >
                        {thread.listingTitle ?? t('noListing')}
                      </Link>
                    </td>
                    <td className="py-3 pe-3" dir="auto">
                      {thread.counterpartName}
                      <span className="text-ink-muted ms-2 text-xs">
                        {t(thread.viewerRole === 'buyer' ? 'asBuyer' : 'asSeller')}
                      </span>
                    </td>
                    <td className="text-ink-muted max-w-sm truncate py-3 pe-3" dir="auto">
                      {thread.lastMessagePreview}
                    </td>
                    <td className="py-3 pe-3 text-end">
                      {thread.unreadCount > 0 ? (
                        <Badge tone="accent">{formatCount(thread.unreadCount, locale)}</Badge>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                    <td className="text-ink-muted py-3 text-end whitespace-nowrap">
                      {thread.lastMessageAt ? formatDate(thread.lastMessageAt, locale) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
