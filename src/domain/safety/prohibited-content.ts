/**
 * Screening listing content against the prohibited-item rules.
 *
 * **This is a safety net, not a guarantee.** It matches text against a list a
 * human wrote. It cannot read images, it cannot understand intent, it does not
 * know what a word means in Sorani or Kurmanji slang, and anyone determined to
 * list something prohibited can describe it in words no list contains. Every
 * piece of copy about this feature says so, and no part of the product claims
 * that an ALLOW outcome means a listing is lawful or safe.
 *
 * What it IS good for: catching the obvious, the careless and the first
 * attempt, and routing the uncertain to a human. That is worth having. It is
 * not worth overstating.
 *
 * Rules are DATA (`prohibited_item_rules`), editable by an admin without a
 * deploy — the same principle as categories and commission rates.
 */

export type ProhibitedRuleType = 'BLOCK' | 'FLAG' | 'REQUIRE_APPROVAL';

export interface ProhibitedRule {
  readonly id: string;
  readonly ruleType: ProhibitedRuleType;
  /** Matched case-insensitively against title and description. */
  readonly pattern: string;
  readonly isRegex: boolean;
  readonly note: string | null;
}

export interface ScreeningMatch {
  readonly ruleId: string;
  readonly ruleType: ProhibitedRuleType;
  readonly pattern: string;
  readonly note: string | null;
  /** Which field tripped it, for a moderator reading the queue. */
  readonly field: 'title' | 'description';
}

/**
 * What the caller must do.
 *
 * `BLOCK` refuses the write. `REQUIRE_APPROVAL` accepts it but forces a human
 * to look before it is public. `ALLOW` means nothing matched at a level that
 * changes the outcome — it does NOT mean the listing has been approved of.
 */
export type ScreeningOutcome = 'ALLOW' | 'REQUIRE_APPROVAL' | 'BLOCK';

export interface ScreeningResult {
  readonly outcome: ScreeningOutcome;
  /** Every match, including FLAG matches that did not change the outcome. */
  readonly matches: readonly ScreeningMatch[];
}

/**
 * A regex from the database is still a regex.
 *
 * An admin-authored pattern is not hostile input, but it is not reviewed code
 * either, and a catastrophically backtracking pattern would hang the request
 * that a seller is waiting on. The length cap keeps the search space small;
 * the try/catch means an invalid pattern is ignored rather than 500-ing a
 * listing submission.
 */
const MAX_REGEX_LENGTH = 200;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matcherFor(rule: ProhibitedRule): RegExp | null {
  if (rule.isRegex) {
    if (rule.pattern.length > MAX_REGEX_LENGTH) return null;
    try {
      return new RegExp(rule.pattern, 'iu');
    } catch {
      // A broken pattern must not take a seller's submission down with it.
      return null;
    }
  }

  /*
   * Word boundaries, not bare substring.
   *
   * A BLOCK rule that fires on a substring refuses a legitimate seller: the
   * pattern "stolen" inside "unstolen", or "cat n" inside "cat nap". Boundaries
   * do not eliminate false positives — "knife" still matches "knife block" —
   * but they remove the class of them that comes from matching inside a word.
   */
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(rule.pattern)}(?![\\p{L}\\p{N}])`, 'iu');
}

/** Collapses whitespace so a pattern is not defeated by a line break. */
function normalise(value: string): string {
  return value.replace(/\s+/g, ' ');
}

const SEVERITY: Record<ProhibitedRuleType, number> = {
  FLAG: 0,
  REQUIRE_APPROVAL: 1,
  BLOCK: 2,
};

/**
 * Screens a listing's text.
 *
 * The caller supplies only the rules that APPLY — scoped to the listing's
 * category and country — because scoping is a query concern, not a matching
 * concern. Passing every rule in the table would still work; it would just be
 * wrong about which ones are relevant.
 */
export function screenListingContent(input: {
  readonly title: string;
  readonly description: string;
  readonly rules: readonly ProhibitedRule[];
}): ScreeningResult {
  const fields: ReadonlyArray<{ field: 'title' | 'description'; text: string }> = [
    { field: 'title', text: normalise(input.title) },
    { field: 'description', text: normalise(input.description) },
  ];

  const matches: ScreeningMatch[] = [];

  for (const rule of input.rules) {
    const matcher = matcherFor(rule);
    if (matcher === null) continue;

    for (const { field, text } of fields) {
      if (!matcher.test(text)) continue;
      matches.push({
        ruleId: rule.id,
        ruleType: rule.ruleType,
        pattern: rule.pattern,
        note: rule.note,
        field,
      });
      // One match per rule is enough to decide. Recording the same rule twice
      // tells a moderator nothing they did not already know.
      break;
    }
  }

  const worst = matches.reduce((highest, match) => Math.max(highest, SEVERITY[match.ruleType]), -1);

  const outcome: ScreeningOutcome =
    worst === SEVERITY.BLOCK
      ? 'BLOCK'
      : worst === SEVERITY.REQUIRE_APPROVAL
        ? 'REQUIRE_APPROVAL'
        : 'ALLOW';

  return { outcome, matches };
}

/**
 * Whether a listing must go to a human before it is public.
 *
 * Three independent reasons, and any one of them is enough:
 *   - the CATEGORY always requires approval (Cars, Business)
 *   - screening matched a REQUIRE_APPROVAL rule
 *   - screening matched anything at all worth a second look
 *
 * The third is deliberate: a FLAG match does not block, but publishing it
 * straight to the public site without anyone seeing it would make FLAG
 * meaningless.
 */
export function requiresHumanReview(input: {
  readonly categoryRequiresApproval: boolean;
  readonly screening: ScreeningResult;
}): boolean {
  if (input.categoryRequiresApproval) return true;
  if (input.screening.outcome === 'REQUIRE_APPROVAL') return true;
  return input.screening.matches.length > 0;
}
