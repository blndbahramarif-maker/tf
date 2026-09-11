import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ALL_LOCALES, getDirection, isLocale, type Locale } from '@kurdora/i18n';
import { brand } from '@kurdora/brand';
import '@/styles/globals.css';

/** Pre-render every locale shell at build time. */
export function generateStaticParams() {
  return ALL_LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const t = await getTranslations({ locale, namespace: 'meta' });

  return {
    title: {
      default: t('siteName', { brandName: brand.name }),
      template: `%s · ${brand.name}`,
    },
    description: t('defaultDescription', { brandName: brand.name }),
    metadataBase: new URL(`https://${brand.domains.primary}`),
    // Per-locale alternates are generated per-route from Phase 4, once real
    // pages exist to point at.
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  // Enables static rendering for this locale segment.
  setRequestLocale(locale as Locale);

  const direction = getDirection(locale as Locale);

  return (
    <html lang={locale} dir={direction} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
