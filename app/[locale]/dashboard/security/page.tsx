import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale, type Locale } from '@kurdora/i18n';
import { readSessionState } from '@/lib/auth/server-session';
import { loadOwnSessions } from '@/infra/catalogue/dashboard-read-model';
import { formatDate } from '@/lib/format/money';
import { Badge } from '../../../_components/badge';

export const dynamic = 'force-dynamic';

/**
 * Account security.
 *
 * Lists the caller's own live sessions, scoped by the user id from the token.
 * Revoking a session and changing a password both require step-up
 * authentication, which the browser does not have a flow for yet — so those
 * controls are not shown. An unusable button would be worse than an honest
 * statement of where to do it.
 */
export default async function SecurityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale as Locale);

  const state = await readSessionState();
  if (state.kind !== 'authenticated') notFound();

  const t = await getTranslations('dashboard.security');
  const sessions = await loadOwnSessions(state.session.principal.userId);
  const { principal, familyId } = state.session;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>

      <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="border-border rounded-[--radius-card] border p-4">
          <dt className="text-ink-muted text-xs">{t('emailVerified')}</dt>
          <dd className="mt-1">
            <Badge tone={principal.emailVerified ? 'accent' : 'warning'}>
              {principal.emailVerified ? t('yes') : t('no')}
            </Badge>
          </dd>
        </div>
        <div className="border-border rounded-[--radius-card] border p-4">
          <dt className="text-ink-muted text-xs">{t('twoFactor')}</dt>
          <dd className="mt-1">
            <Badge tone={principal.twoFactorEnabled ? 'accent' : 'neutral'}>
              {principal.twoFactorEnabled ? t('enabled') : t('disabled')}
            </Badge>
          </dd>
        </div>
        <div className="border-border rounded-[--radius-card] border p-4">
          <dt className="text-ink-muted text-xs">{t('roles')}</dt>
          <dd className="mt-1 text-sm">{principal.roles.join(', ') || '—'}</dd>
        </div>
      </dl>

      <section aria-labelledby="sessions-heading" className="mt-10">
        <h2 id="sessions-heading" className="text-lg font-semibold">
          {t('sessionsHeading')}
        </h2>
        <p className="text-ink-muted mt-1 text-sm">{t('sessionsHint')}</p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="text-ink-muted border-border border-b text-xs uppercase">
              <tr>
                <th scope="col" className="py-2 text-start font-medium">
                  {t('columnStarted')}
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  {t('columnLastUsed')}
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  {t('columnIp')}
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  {t('columnDevice')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {sessions.map((session) => (
                <tr key={session.id}>
                  <td className="py-3 pe-3">
                    {formatDate(session.createdAt, locale)}
                    {session.familyId === familyId ? (
                      <span className="ms-2">
                        <Badge tone="accent">{t('thisSession')}</Badge>
                      </span>
                    ) : null}
                  </td>
                  <td className="text-ink-muted py-3 pe-3">
                    {session.lastUsedAt === null ? '—' : formatDate(session.lastUsedAt, locale)}
                  </td>
                  <td className="text-ink-muted py-3 pe-3 font-mono text-xs">
                    {session.ip ?? '—'}
                  </td>
                  <td className="text-ink-muted max-w-xs truncate py-3 text-xs">
                    {session.userAgent ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-ink-muted mt-6 text-sm">{t('stepUpNotice')}</p>
      </section>
    </>
  );
}
