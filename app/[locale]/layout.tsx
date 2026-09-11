import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ALL_LOCALES, getDirection, isLocale, type Locale } from '@kurdora/i18n';
import { brand } from '@kurdora/brand';
import { loadCategoryTree } from '@/infra/catalogue/read-model';
import { SiteHeader } from '../_components/site-header';
import { SiteFooter } from '../_components/site-footer';
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
  // One query for the whole shell rather than one per page.
  const categories = await loadCategoryTree(locale);

  const t = await getTranslations({ locale, namespace: 'common' });

  return (
    <html lang={locale} dir={direction} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <NextIntlClientProvider>
          <a
            href="#main"
            className="bg-accent text-accent-ink sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:px-4 focus:py-2"
          >
            {t('skipToContent')}
          </a>
          <SiteHeader locale={locale} categories={categories} />
          <div className="flex-1">{children}</div>
          <SiteFooter locale={locale} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
