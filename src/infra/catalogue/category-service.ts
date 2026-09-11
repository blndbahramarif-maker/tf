import { prisma } from '@/infra/db/client';
import { ancestorPaths, resolveAttributes } from '@/domain/catalogue/category-tree';
import type { AttributeDefinition } from '@/domain/catalogue/attributes';

/**
 * Category and attribute loading.
 *
 * Attribute definitions are resolved WITH INHERITANCE: a subcategory gets its
 * own attributes plus those its ancestors marked inheritable, with the nearest
 * definition of a key winning.
 */

export interface LoadedCategory {
  readonly id: string;
  readonly slug: string;
  readonly path: string;
  readonly isActive: boolean;
  readonly transactionFlow: string;
  readonly allowsOnlinePayment: boolean;
  readonly requiresApproval: boolean;
  readonly requiresVerifiedSeller: boolean;
  readonly maxImages: number;
  readonly listingDurationDays: number;
  readonly maxOnlineAmountMinor: bigint | null;
  readonly minPriceMinor: bigint | null;
}

interface AttributeRow {
  id: string;
  key: string;
  categoryId: string;
  dataType: string;
  unit: string | null;
  isRequired: boolean;
  isFilterable: boolean;
  inheritToChildren: boolean;
  position: number;
  validation: unknown;
  options: { id: string; value: string; position: number }[];
}

export async function loadCategoryBySlug(slug: string): Promise<LoadedCategory | null> {
  const category = await prisma.category.findFirst({
    where: { slug, deletedAt: null },
    select: {
      id: true,
      slug: true,
      path: true,
      isActive: true,
      transactionFlow: true,
      allowsOnlinePayment: true,
      requiresApproval: true,
      requiresVerifiedSeller: true,
      maxImages: true,
      listingDurationDays: true,
      maxOnlineAmountMinor: true,
      minPriceMinor: true,
    },
  });
  return category;
}

/**
 * Attribute definitions for a category, including inherited ones.
 *
 * Two queries regardless of tree depth: the category's own attributes, and
 * every ancestor's, resolved in memory by `resolveAttributes`.
 */
export async function loadAttributeDefinitions(
  category: Pick<LoadedCategory, 'id' | 'path'>,
): Promise<readonly AttributeDefinition[]> {
  const ancestors = ancestorPaths(category.path);

  const rows = (await prisma.attributeDefinition.findMany({
    where: {
      OR: [
        { categoryId: category.id },
        ...(ancestors.length > 0 ? [{ category: { path: { in: [...ancestors] } } }] : []),
      ],
    },
    select: {
      id: true,
      key: true,
      categoryId: true,
      dataType: true,
      unit: true,
      isRequired: true,
      isFilterable: true,
      inheritToChildren: true,
      position: true,
      validation: true,
      category: { select: { path: true } },
      options: {
        where: { isActive: true },
        select: { id: true, value: true, position: true },
        orderBy: { position: 'asc' },
      },
    },
    orderBy: { position: 'asc' },
  })) as unknown as (AttributeRow & { category: { path: string } })[];

  const own = rows.filter((row) => row.categoryId === category.id);
  // Nearest ancestor first, so the closest definition of a key wins.
  const inherited = ancestors.flatMap((path) => rows.filter((row) => row.category.path === path));

  const resolved = resolveAttributes(own, inherited);

  return resolved.map((row) => {
    const source = rows.find((candidate) => candidate.id === row.id)!;
    return {
      id: source.id,
      key: source.key,
      dataType: source.dataType as AttributeDefinition['dataType'],
      isRequired: source.isRequired,
      unit: source.unit,
      validation: (source.validation ?? {}) as AttributeDefinition['validation'],
      options: source.options.map((option) => ({ id: option.id, value: option.value })),
    };
  });
}

/** Filterable attribute keys, used to build facets for the filter panel. */
export async function loadFilterableKeys(
  category: Pick<LoadedCategory, 'id' | 'path'>,
): Promise<readonly string[]> {
  const definitions = await loadAttributeDefinitions(category);
  const filterable = await prisma.attributeDefinition.findMany({
    where: { id: { in: definitions.map((definition) => definition.id) }, isFilterable: true },
    select: { key: true },
  });
  return filterable.map((row) => row.key);
}
