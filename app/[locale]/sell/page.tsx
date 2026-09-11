import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale, type Locale } from '@kurdora/i18n';
import { brand } from '@kurdora/brand';
import { Link } from '@/lib/i18n/navigation';
import { loadCategoryTree } from '@/infra/catalogue/read-model';
import { alternatesFor } from '@/lib/seo/urls';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const t = await getTranslations({ locale, namespace: 'sell' });

  return {
    title: t('title'),
    description: t('intro', { brandName: brand.name }),
    alternates: alternatesFor('/sell', locale),
  };
}

/**
 * How selling works.
 *
 * This page explains the seller journey and lists the categories open for
 * listings. It deliberately does NOT contain a listing form.
 *
 * The listing lifecycle itself is implemented and tested — create, edit,
 * publish, pause, images, per-category validation — but it is reached through
 * the authenticated API. The browser has no signed-in session yet: Phase 3
 * issues bearer tokens for API clients, and putting a session in the browser
 * is an auth-transport decision (httpOnly cookies, CSRF defence, refresh
 * rotation) that belongs with the account UI in Phase 5. Holding an access
 * token in JavaScript-reachable storage to ship a form sooner would hand any
 * XSS a full session, which non-negotiable 8 exists to prevent.
 *
 * So this page states what a seller can do today rather than presenting a form
 * that cannot submit.
 */
export default async function SellPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale as Locale);

  const t = await getTranslations('sell');
  const categories = await loadCategoryTree(locale);

  const steps = ['account', 'category', 'details', 'images', 'publish'] as const;

  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-12 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">{t('title')}</h1>
      <p className="text-ink-muted mt-3 text-pretty">{t('intro', { brandName: brand.name })}</p>

      <section aria-labelledby="steps-heading" className="mt-10">
        <h2 id="steps-heading" className="text-lg font-semibold">
          {t('stepsHeading')}
        </h2>
        <ol className="mt-4 space-y-4">
          {steps.map((step, index) => (
            <li key={step} className="flex gap-4">
              <span className="bg-surface-sunken text-ink-muted flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-medium tabular-nums">
                {index + 1}
              </span>
              <div>
                <h3 className="text-sm font-medium">{t(`steps.${step}.title`)}</h3>
                <p className="text-ink-muted mt-1 text-sm">{t(`steps.${step}.body`)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {categories.length === 0 ? null : (
        <section aria-labelledby="open-categories-heading" className="mt-10">
          <h2 id="open-categories-heading" className="text-lg font-semibold">
            {t('categoriesHeading')}
          </h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {categories.map(({ node }) => (
              <li key={node.id}>
                <Link
                  href={`/c/${node.slug}`}
                  className="border-border bg-surface hover:border-border-strong rounded-full border px-3.5 py-1.5 text-sm transition-colors"
                >
                  {node.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
       * Stated plainly rather than hidden: the seller dashboard is not built.
       * Nothing on this page pretends otherwise.
       */}
      <aside
        aria-labelledby="availability-heading"
        className="border-border bg-surface-muted mt-12 rounded-[--radius-card] border p-6"
      >
        <h2 id="availability-heading" className="text-sm font-semibold">
          {t('availabilityHeading')}
        </h2>
        <p className="text-ink-muted mt-2 text-sm text-pretty">{t('availabilityBody')}</p>
      </aside>
    </main>
  );
}
