import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale, type Locale } from '@kurdora/i18n';
import { brand } from '@kurdora/brand';
import { readSessionState } from '@/lib/auth/server-session';
import { loadOnboardingSnapshot, refreshAccountState } from '@/infra/payments/onboarding-service';
import { connectGateway, PaymentsUnavailableError } from '@/infra/payments/gateway-provider';
import { alternatesFor } from '@/lib/seo/urls';
import { Badge } from '../../../_components/badge';
import { RefreshPayoutStatusForm, StartPayoutOnboardingForm } from './payout-forms';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dashboard.payouts' });
  return {
    title: t('title'),
    // A seller's payout standing is nobody else's business, and least of all a
    // crawler's.
    robots: { index: false, follow: false },
    alternates: alternatesFor('/dashboard/payouts', locale),
  };
}

/** Statuses where the seller still has somewhere to go at the provider. */
const RESUMABLE = new Set(['NOT_STARTED', 'ONBOARDING_STARTED', 'RESTRICTED', 'DISABLED']);

export default async function PayoutsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string; link?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale as Locale);

  const state = await readSessionState();
  if (state.kind !== 'authenticated') notFound();

  const { from, link } = await searchParams;
  const t = await getTranslations('dashboard.payouts');

  /*
   * Coming back from Stripe. The redirect itself proves NOTHING — Stripe is
   * explicit that it "only means the flow was entered and exited properly" —
   * so the marker triggers a re-READ of the account and the answer comes from
   * the provider.
   *
   * A provider read on a GET is deliberate and safe here: it takes no input
   * from the caller, its entire effect is to mirror the provider's own answer,
   * and an attacker who forced it would achieve precisely what the honest path
   * does. It is a cache refresh, not a state change the seller chose.
   *
   * A failure is swallowed on purpose: the page must still render the last
   * known state rather than 500 because Stripe was slow. The refresh button
   * below is the retry.
   */
  if (from === 'stripe') {
    try {
      await refreshAccountState({
        userId: state.session.principal.userId,
        gateway: connectGateway(),
      });
    } catch (error) {
      if (!(error instanceof PaymentsUnavailableError)) throw error;
    }
  }

  const snapshot = await loadOnboardingSnapshot(state.session.principal.userId);

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>

      {snapshot === null ? (
        <p className="text-ink-muted mt-4 text-sm">{t('noProfile')}</p>
      ) : (
        <>
          {/*
            The expired-link case. Stripe's guidance is that the refresh URL
            should mint a new link; this asks the seller to press a button
            instead. An account that cannot produce a usable link would
            otherwise bounce them between Stripe and here indefinitely.
          */}
          {link === 'expired' ? (
            <p className="text-ink-muted mt-4 text-sm">{t('linkExpired')}</p>
          ) : null}

          <dl className="text-ink-muted mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div className="flex items-center gap-2">
              <dt>{t('statusLabel')}</dt>
              <dd>
                <Badge tone={snapshot.status === 'ACTIVE' ? 'accent' : 'neutral'}>
                  {t(`status.${snapshot.status}`)}
                </Badge>
              </dd>
            </div>
            <div className="flex gap-2">
              <dt>{t('chargesEnabled')}</dt>
              <dd className="text-ink">{t(snapshot.chargesEnabled ? 'yes' : 'no')}</dd>
            </div>
            <div className="flex gap-2">
              <dt>{t('payoutsEnabled')}</dt>
              <dd className="text-ink">{t(snapshot.payoutsEnabled ? 'yes' : 'no')}</dd>
            </div>
            {snapshot.payoutDelayDays === null ? null : (
              <div className="flex gap-2">
                <dt>{t('payoutDelay')}</dt>
                <dd className="text-ink tabular-nums">
                  {t('payoutDelayDays', { days: snapshot.payoutDelayDays })}
                </dd>
              </div>
            )}
          </dl>

          <p className="text-ink-muted mt-4 text-sm">
            {/* `brandName` is interpolated, never written into a catalogue:
                a rename must not require editing four translation files. */}
            {t(`explain.${snapshot.status}`, { brandName: brand.name })}
          </p>

          {/*
            What Stripe is waiting for, as REQUIREMENT KEYS. They are provider
            identifiers, not seller-written text, so they are safe to render —
            but they are still shown through the catalogue where a translation
            exists, and fall back to the raw key rather than to English prose
            that would be wrong in four languages.
          */}
          {snapshot.currentlyDue.length === 0 ? null : (
            <section className="mt-6">
              <h2 className="text-sm font-medium">{t('outstanding')}</h2>
              <ul className="text-ink-muted mt-2 list-disc space-y-1 ps-5 text-sm">
                {snapshot.currentlyDue.map((requirement) => (
                  <li key={requirement} className="font-mono text-xs">
                    {requirement}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {snapshot.status === 'REJECTED' ? (
            // No button. Stripe's rejection is terminal, and offering a link
            // that cannot help would be a worse answer than none.
            <p className="text-ink-muted mt-6 text-sm">{t('rejectedHelp')}</p>
          ) : (
            <StartPayoutOnboardingForm
              csrfToken={state.session.csrfToken}
              resuming={RESUMABLE.has(snapshot.status) && snapshot.hasAccount}
            />
          )}

          {snapshot.hasAccount ? (
            <RefreshPayoutStatusForm csrfToken={state.session.csrfToken} />
          ) : null}

          {snapshot.syncedAt === null ? null : (
            <p className="text-ink-muted mt-4 text-xs">
              {t('lastSynced', { at: snapshot.syncedAt.toISOString() })}
            </p>
          )}
        </>
      )}
    </>
  );
}
