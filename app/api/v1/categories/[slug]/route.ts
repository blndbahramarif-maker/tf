import { loadAttributeDefinitions, loadCategoryBySlug } from '@/infra/catalogue/category-service';
import { prisma } from '@/infra/db/client';
import { enforceRateLimit } from '@/lib/api/route-helpers';
import { fail, ok } from '@/lib/api/respond';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';
import { resolveLocale } from '@/lib/api/locale';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/categories/{slug}
 *
 * One category with the attribute definitions that apply to it, INCLUDING
 * those inherited from ancestors. This is what drives the dynamic listing form:
 * the client renders whatever fields come back, so adding an attribute in the
 * admin panel changes the form with no deploy and no client release.
 */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const limited = await enforceRateLimit(request, RATE_LIMITS.readApi);
  if (!limited.ok) return limited.response;

  const { slug } = await context.params;
  const locale = resolveLocale(request);

  const category = await loadCategoryBySlug(slug);
  if (!category || !category.isActive) {
    return fail('not_found', 'Category not found.', { request });
  }

  const definitions = await loadAttributeDefinitions(category);

  // One query for every label, rather than one per attribute.
  const [categoryTranslations, attributeTranslations, optionTranslations] = await Promise.all([
    prisma.categoryTranslation.findMany({
      where: { categoryId: category.id, locale: { in: [locale, 'en'] } },
      select: { locale: true, name: true, description: true },
    }),
    prisma.attributeDefinitionTranslation.findMany({
      where: {
        attributeDefinitionId: { in: definitions.map((d) => d.id) },
        locale: { in: [locale, 'en'] },
      },
      select: { attributeDefinitionId: true, locale: true, label: true, helpText: true },
    }),
    prisma.attributeOptionTranslation.findMany({
      where: {
        attributeOptionId: { in: definitions.flatMap((d) => d.options.map((o) => o.id)) },
        locale: { in: [locale, 'en'] },
      },
      select: { attributeOptionId: true, locale: true, label: true },
    }),
  ]);

  const pick = <T extends { locale: string }>(rows: readonly T[]): T | undefined =>
    rows.find((row) => row.locale === locale) ?? rows.find((row) => row.locale === 'en');

  return ok({
    locale,
    category: {
      id: category.id,
      slug: category.slug,
      path: category.path,
      name: pick(categoryTranslations)?.name ?? category.slug,
      description: pick(categoryTranslations)?.description ?? null,
      transactionFlow: category.transactionFlow,
      allowsOnlinePayment: category.allowsOnlinePayment,
      requiresApproval: category.requiresApproval,
      requiresVerifiedSeller: category.requiresVerifiedSeller,
      maxImages: category.maxImages,
      listingDurationDays: category.listingDurationDays,
    },
    attributes: definitions.map((definition) => {
      const labels = attributeTranslations.filter((t) => t.attributeDefinitionId === definition.id);
      return {
        key: definition.key,
        dataType: definition.dataType,
        unit: definition.unit ?? null,
        isRequired: definition.isRequired,
        validation: definition.validation,
        label: pick(labels)?.label ?? definition.key,
        helpText: pick(labels)?.helpText ?? null,
        options: definition.options.map((option) => {
          const optionLabels = optionTranslations.filter((t) => t.attributeOptionId === option.id);
          return { value: option.value, label: pick(optionLabels)?.label ?? option.value };
        }),
      };
    }),
  });
}
