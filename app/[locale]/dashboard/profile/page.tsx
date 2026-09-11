import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale, type Locale } from '@kurdora/i18n';
import { readSessionState } from '@/lib/auth/server-session';
import { loadSellerOverview } from '@/infra/catalogue/dashboard-read-model';
import { Badge } from '../../../_components/badge';
import { SellerProfileForm } from '../dashboard-forms';

export const dynamic = 'force-dynamic';

export default async function SellerProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale as Locale);

  const state = await readSessionState();
  if (state.kind !== 'authenticated') notFound();

  const t = await getTranslations('dashboard.profile');
  // Scoped by the session's user id — there is no profile id in the URL to
  // tamper with, so this page has no IDOR surface by construction.
  const overview = await loadSellerOverview(state.session.principal.userId);

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>

      {overview === null ? (
        <p className="text-ink-muted mt-4 text-sm">{t('noProfile')}</p>
      ) : (
        <>
          <dl className="text-ink-muted mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div className="flex gap-2">
              <dt>{t('publicSlug')}</dt>
              <dd className="text-ink font-mono">{overview.slug}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt>{t('verification')}</dt>
              <dd>
                <Badge tone={overview.verificationStatus === 'VERIFIED' ? 'accent' : 'neutral'}>
                  {t(`verificationStatus.${overview.verificationStatus}`)}
                </Badge>
              </dd>
            </div>
            <div className="flex gap-2">
              <dt>{t('totalListings')}</dt>
              <dd className="text-ink tabular-nums">{overview.totalListings}</dd>
            </div>
          </dl>

          <div className="mt-8">
            <SellerProfileForm
              locale={locale}
              csrfToken={state.session.csrfToken}
              defaults={{ displayName: overview.displayName, about: overview.about ?? '' }}
            />
          </div>
        </>
      )}
    </>
  );
}
