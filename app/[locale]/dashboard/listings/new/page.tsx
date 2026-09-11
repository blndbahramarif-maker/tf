import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale, type Locale } from '@kurdora/i18n';
import { readSessionState } from '@/lib/auth/server-session';
import { loadCategoryTree, loadCategoryDetail } from '@/infra/catalogue/read-model';
import { loadAttributeDefinitions, loadCategoryBySlug } from '@/infra/catalogue/category-service';
import { prisma } from '@/infra/db/client';
import { CreateListingForm, type AttributeInput } from '../../dashboard-forms';

export const dynamic = 'force-dynamic';

/**
 * Create a listing.
 *
 * Step one picks a category, because the category decides which fields exist.
 * The form is then generated from that category's attribute definitions — an
 * attribute an administrator adds appears here with no deploy.
 */
export default async function NewListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ category?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale as Locale);

  const state = await readSessionState();
  if (state.kind !== 'authenticated') notFound();

  const { category: categorySlug } = await searchParams;
  const t = await getTranslations('dashboard.listingForm');

  if (!categorySlug) {
    const tree = await loadCategoryTree(locale);
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">{t('chooseCategory')}</h1>
        <p className="text-ink-muted mt-2 text-sm">{t('chooseCategoryHint')}</p>
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {tree.map(({ node }) => (
            <li key={node.id}>
              <a
                href={`/${locale}/dashboard/listings/new?category=${encodeURIComponent(node.slug)}`}
                className="border-border hover:border-accent block rounded-[--radius-card] border p-4 transition-colors"
              >
                <span className="font-medium">{node.name}</span>
              </a>
            </li>
          ))}
        </ul>
      </>
    );
  }

  const category = await loadCategoryBySlug(categorySlug);
  if (!category || !category.isActive) notFound();

  const detail = await loadCategoryDetail(categorySlug, locale);
  const definitions = await loadAttributeDefinitions(category);

  // Labels in the reader's language, falling back to English.
  const translations = await prisma.attributeDefinitionTranslation.findMany({
    where: {
      attributeDefinitionId: { in: definitions.map((d) => d.id) },
      locale: { in: [locale, 'en'] },
    },
    select: { attributeDefinitionId: true, locale: true, label: true },
  });
  const optionLabels = await prisma.attributeOptionTranslation.findMany({
    where: {
      attributeOptionId: { in: definitions.flatMap((d) => d.options.map((o) => o.id)) },
      locale: { in: [locale, 'en'] },
    },
    select: { attributeOptionId: true, locale: true, label: true },
  });

  const pick = <T extends { locale: string }>(rows: T[]): T | undefined =>
    rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === 'en');

  const attributes: AttributeInput[] = definitions.map((definition) => ({
    key: definition.key,
    dataType: definition.dataType,
    unit: definition.unit ?? null,
    isRequired: definition.isRequired,
    label:
      pick(translations.filter((tr) => tr.attributeDefinitionId === definition.id))?.label ??
      definition.key,
    options: definition.options.map((option) => ({
      value: option.value,
      label:
        pick(optionLabels.filter((o) => o.attributeOptionId === option.id))?.label ?? option.value,
    })),
  }));

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">
        {t('newIn', { category: detail?.name ?? categorySlug })}
      </h1>
      {category.requiresVerifiedSeller ? (
        <p className="border-warning/40 bg-warning-soft mt-4 rounded-md border p-3 text-sm">
          {t('verifiedSellerRequired')}
        </p>
      ) : null}
      <div className="mt-8 max-w-2xl">
        <CreateListingForm
          locale={locale}
          csrfToken={state.session.csrfToken}
          categorySlug={categorySlug}
          attributes={attributes}
        />
      </div>
    </>
  );
}
