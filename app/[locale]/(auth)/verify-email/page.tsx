import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale, type Locale } from '@kurdora/i18n';
import { VerifyEmailForm } from '../auth-forms';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: 'auth.verify' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * Email verification.
 *
 * The token arrives in the query string from the emailed link, and the form is
 * pre-filled with it. It is still a POST — a GET that verified an address
 * would be triggerable by any page that could make the browser load an image.
 */
export default async function VerifyEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale as Locale);

  const { token } = await searchParams;
  const t = await getTranslations('auth.verify');

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-ink-muted mt-2 text-sm">{t('subtitle')}</p>
      <div className="mt-8">
        <VerifyEmailForm locale={locale} token={token ?? ''} />
      </div>
    </>
  );
}
