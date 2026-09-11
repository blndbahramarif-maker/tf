import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getLocale, isLocale, type Locale } from '@kurdora/i18n';
import { brand } from '@kurdora/brand';
import { notFound } from 'next/navigation';

/**
 * Foundation page.
 *
 * This is NOT the marketplace home page. It exists so that Phase 1 has a
 * running, inspectable surface proving that locale routing, direction
 * switching, message loading and brand interpolation all work end to end.
 * It is replaced by the real home page in Phase 4.
 */
export default async function FoundationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale as Locale);

  const t = await getTranslations('foundation');
  const definition = getLocale(locale as Locale);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">
        {t('heading', { brandName: brand.name })}
      </h1>

      <p className="text-ink-muted">{t('status')}</p>

      <ul className="border-border divide-border divide-y rounded-lg border text-sm">
        <li className="px-4 py-3">
          {t('localeLine', { locale: definition.code, nativeName: definition.nativeName })}
        </li>
        <li className="px-4 py-3">{t('directionLine', { direction: definition.direction })}</li>
      </ul>

      <p className="text-ink-muted text-sm">{t('docsHint')}</p>
    </main>
  );
}
