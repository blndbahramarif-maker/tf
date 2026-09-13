import { prisma } from '@/infra/db/client';
import type { ProhibitedRule, ProhibitedRuleType } from '@/domain/safety/prohibited-content';

/**
 * Loading the prohibited-item rules that apply to one listing.
 *
 * Scoping is the QUERY, not a filter applied afterwards. A rule is in scope
 * when it is active AND its country is null-or-this-country AND its category
 * is null-or-this-category — `null` meaning "applies everywhere". Fetching the
 * whole table and narrowing in TypeScript would work until the table grows,
 * and would put the scoping decision somewhere nobody thinks to look.
 */
export async function loadApplicableRules(input: {
  categoryId: string;
  countryId: string | null;
}): Promise<ProhibitedRule[]> {
  const rules = await prisma.prohibitedItemRule.findMany({
    where: {
      isActive: true,
      OR: [
        { countryId: null },
        ...(input.countryId === null ? [] : [{ countryId: input.countryId }]),
      ],
      AND: [{ OR: [{ categoryId: null }, { categoryId: input.categoryId }] }],
    },
    select: { id: true, ruleType: true, pattern: true, isRegex: true, note: true },
  });

  return rules.map((rule) => ({
    id: rule.id,
    ruleType: rule.ruleType as ProhibitedRuleType,
    pattern: rule.pattern,
    isRegex: rule.isRegex,
    note: rule.note,
  }));
}
