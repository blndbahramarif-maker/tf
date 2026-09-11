import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale, type Locale } from '@kurdora/i18n';
import { Link } from '@/lib/i18n/navigation';
import { readSessionState } from '@/lib/auth/server-session';
import { RegisterForm } from '../auth-forms';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: 'auth.register' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale as Locale);

  const state = await readSessionState();
  if (state.kind === 'authenticated') redirect(`/${locale}/dashboard`);

  const t = await getTranslations('auth.register');

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-ink-muted mt-2 text-sm">{t('subtitle')}</p>

      <div className="mt-8">
        <RegisterForm locale={locale} />
      </div>

      <p className="text-ink-muted mt-6 text-sm">
        {t('haveAccount')}{' '}
        <Link href="/login" className="text-accent-strong underline underline-offset-4">
          {t('loginLink')}
        </Link>
      </p>
    </>
  );
}
