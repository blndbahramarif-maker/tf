import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale, type Locale } from '@kurdora/i18n';
import { Link } from '@/lib/i18n/navigation';
import { readSessionState } from '@/lib/auth/server-session';
import { FormNotice } from '../../../_components/form-field';
import { LoginForm } from '../auth-forms';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: 'auth.login' });
  // Sign-in pages have no business in a search index.
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string; verified?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale as Locale);

  const { next, verified } = await searchParams;

  // Already signed in? Do not show a login form.
  const state = await readSessionState();
  if (state.kind === 'authenticated') redirect(`/${locale}/dashboard`);

  const t = await getTranslations('auth.login');

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-ink-muted mt-2 text-sm">{t('subtitle')}</p>

      {verified === '1' ? (
        <div className="mt-6">
          <FormNotice>{t('verifiedNotice')}</FormNotice>
        </div>
      ) : null}

      <div className="mt-8">
        <LoginForm locale={locale} next={next} />
      </div>

      <p className="text-ink-muted mt-6 text-sm">
        {t('noAccount')}{' '}
        <Link href="/register" className="text-accent-strong underline underline-offset-4">
          {t('registerLink')}
        </Link>
      </p>
    </>
  );
}
