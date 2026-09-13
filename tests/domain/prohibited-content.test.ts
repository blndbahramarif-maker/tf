import { describe, expect, it } from 'vitest';
import {
  requiresHumanReview,
  screenListingContent,
  type ProhibitedRule,
} from '@/domain/safety/prohibited-content';

/**
 * Prohibited-content screening, as pure rules.
 *
 * These tests are as much about what screening does NOT claim as what it
 * catches. An ALLOW outcome means "no rule matched" — never "this listing is
 * lawful" — and the false-positive cases below matter as much as the true
 * positives, because a BLOCK that fires wrongly refuses an honest seller.
 */

function rule(over: Partial<ProhibitedRule> = {}): ProhibitedRule {
  return {
    id: 'rule-1',
    ruleType: 'BLOCK',
    pattern: 'stolen',
    isRegex: false,
    note: null,
    ...over,
  };
}

const screen = (title: string, description: string, rules: ProhibitedRule[]) =>
  screenListingContent({ title, description, rules });

describe('matching', () => {
  it('blocks a prohibited phrase in the title', () => {
    const result = screen('Stolen iPhone 14', 'Good condition.', [rule()]);
    expect(result.outcome).toBe('BLOCK');
    expect(result.matches[0]).toMatchObject({ field: 'title', ruleType: 'BLOCK' });
  });

  it('blocks it in the description too', () => {
    const result = screen('iPhone 14', 'This is stolen, no questions.', [rule()]);
    expect(result.outcome).toBe('BLOCK');
    expect(result.matches[0]?.field).toBe('description');
  });

  it('is case-insensitive', () => {
    expect(screen('STOLEN goods', 'x', [rule()]).outcome).toBe('BLOCK');
  });

  it('is not defeated by a line break inside a phrase', () => {
    // Whitespace is normalised first, so a seller cannot split the phrase
    // across lines to get past the rule.
    const result = screen('x', 'a replica\nwatch for sale', [rule({ pattern: 'replica watch' })]);
    expect(result.outcome).toBe('BLOCK');
  });

  it('does NOT match inside a longer word', () => {
    /*
     * The false-positive case, and the reason matching uses word boundaries.
     * "Unstolen" is not "stolen", and a BLOCK that fired here would refuse an
     * honest listing with no way for the seller to understand why.
     */
    expect(screen('Unstolen goods', 'x', [rule()]).outcome).toBe('ALLOW');
    expect(screen('Catnap bed', 'x', [rule({ pattern: 'cat n' })]).outcome).toBe('ALLOW');
  });

  it('records one match per rule, not one per occurrence', () => {
    const result = screen('stolen stolen', 'stolen stolen', [rule()]);
    expect(result.matches).toHaveLength(1);
  });
});

describe('severity', () => {
  it('takes the WORST outcome when several rules match', () => {
    const result = screen('stolen knife', 'x', [
      rule({ id: 'a', ruleType: 'REQUIRE_APPROVAL', pattern: 'knife' }),
      rule({ id: 'b', ruleType: 'BLOCK', pattern: 'stolen' }),
    ]);
    expect(result.outcome).toBe('BLOCK');
    expect(result.matches).toHaveLength(2);
  });

  it('sends a REQUIRE_APPROVAL match to a human rather than blocking', () => {
    const result = screen('Kitchen knife set', 'x', [
      rule({ ruleType: 'REQUIRE_APPROVAL', pattern: 'knife' }),
    ]);
    expect(result.outcome).toBe('REQUIRE_APPROVAL');
  });

  it('lets a FLAG match through, but still records it', () => {
    // FLAG does not change the outcome. It must still be visible, or the rule
    // may as well not exist.
    const result = screen('Car, cat n', 'x', [rule({ ruleType: 'FLAG', pattern: 'cat n' })]);
    expect(result.outcome).toBe('ALLOW');
    expect(result.matches).toHaveLength(1);
  });
});

describe('bad rule data cannot break a submission', () => {
  it('ignores an invalid regex instead of throwing', () => {
    // An admin-authored pattern is not reviewed code. A broken one must not
    // 500 the seller's submission.
    const result = screen('anything', 'x', [rule({ isRegex: true, pattern: '([unclosed' })]);
    expect(result.outcome).toBe('ALLOW');
  });

  it('ignores an over-long regex', () => {
    // A crude guard against a catastrophically backtracking pattern hanging
    // the request a seller is waiting on.
    const result = screen('aaaaaaaaaaaaaaaaaaaa', 'x', [
      rule({ isRegex: true, pattern: '(a+)+'.repeat(60) }),
    ]);
    expect(result.outcome).toBe('ALLOW');
  });

  it('honours a valid regex rule', () => {
    const result = screen('IMEI 123456789012345', 'x', [
      rule({ isRegex: true, pattern: 'imei\\s+\\d{15}' }),
    ]);
    expect(result.outcome).toBe('BLOCK');
  });
});

describe('requiresHumanReview', () => {
  const clean = screenListingContent({
    title: 'Nice coat',
    description: 'Barely worn.',
    rules: [],
  });

  it('always reviews a category that demands it', () => {
    expect(requiresHumanReview({ categoryRequiresApproval: true, screening: clean })).toBe(true);
  });

  it('publishes a clean listing in an open category directly', () => {
    expect(requiresHumanReview({ categoryRequiresApproval: false, screening: clean })).toBe(false);
  });

  it('reviews a FLAG match even though it did not block', () => {
    // Otherwise FLAG is indistinguishable from no rule at all.
    const flagged = screen('cat n car', 'x', [rule({ ruleType: 'FLAG', pattern: 'cat n' })]);
    expect(flagged.outcome).toBe('ALLOW');
    expect(requiresHumanReview({ categoryRequiresApproval: false, screening: flagged })).toBe(true);
  });
});
