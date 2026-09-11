import { buildTree } from '@/domain/catalogue/category-tree';
import { prisma } from '@/infra/db/client';
import { enforceRateLimit } from '@/lib/api/route-helpers';
import { ok } from '@/lib/api/respond';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';
import { resolveLocale } from '@/lib/api/locale';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/categories
 *
 * The active category tree, localised. Public: browsing needs no account.
 *
 * Names come from `category_translations`, falling back to English — the API
 * never returns an English-only structure, so Sorani clients are first-class
 * from the start.
 */
export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, RATE_LIMITS.readApi);
  if (!limited.ok) return limited.response;

  const locale = resolveLocale(request);

  const categories = await prisma.category.findMany({
    where: { isActive: true, deletedAt: null },
    select: {
      id: true,
      parentId: true,
      slug: true,
      path: true,
      depth: true,
      position: true,
      isActive: true,
      icon: true,
      transactionFlow: true,
      allowsOnlinePayment: true,
      requiresApproval: true,
      maxImages: true,
      translations: {
        where: { locale: { in: [locale, 'en'] } },
        select: { locale: true, name: true, description: true },
      },
      _count: { select: { listings: { where: { status: 'ACTIVE', deletedAt: null } } } },
    },
    orderBy: { position: 'asc' },
  });

  const tree = buildTree(categories);

  const present = (node: (typeof tree)[number]): unknown => ({
    id: node.node.id,
    slug: node.node.slug,
    path: node.node.path,
    depth: node.node.depth,
    icon: node.node.icon,
    name: pickTranslation(node.node.translations, locale)?.name ?? node.node.slug,
    description: pickTranslation(node.node.translations, locale)?.description ?? null,
    /**
     * Transaction behaviour is exposed as DATA so the client can adapt without
     * knowing any category name. Payment itself is Phase 7; this is the
     * configuration surface it will read.
     */
    transactionFlow: node.node.transactionFlow,
    allowsOnlinePayment: node.node.allowsOnlinePayment,
    requiresApproval: node.node.requiresApproval,
    maxImages: node.node.maxImages,
    activeListingCount: node.node._count.listings,
    children: node.children.map(present),
  });

  return ok({ locale, data: tree.map(present) });
}

function pickTranslation<T extends { locale: string }>(
  translations: readonly T[],
  locale: string,
): T | undefined {
  return (
    translations.find((t) => t.locale === locale) ?? translations.find((t) => t.locale === 'en')
  );
}
