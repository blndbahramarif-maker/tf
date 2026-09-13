import { prisma } from '@/infra/db/client';
import {
  requiresHumanReview,
  screenListingContent,
  type ScreeningResult,
} from '@/domain/safety/prohibited-content';
import { loadApplicableRules } from './prohibited-rules';

/**
 * The ONE place a listing is screened before it becomes public.
 *
 * Both the dashboard Server Action and the API route go through this. That is
 * the point: a second implementation is how one of them ends up missing a rule
 * type, and the one that misses it is the one an attacker uses.
 *
 * **Screening is a safety net, not a guarantee.** It reads text against a list
 * a human wrote. It cannot see images, cannot infer intent, and cannot know
 * every word for a prohibited thing in four languages. An `ALLOW` outcome
 * means "nothing matched", never "this listing is lawful".
 */

export type PublishDecision =
  /** Safe to publish, or to send for review — `status` says which. */
  | {
      readonly ok: true;
      readonly status: 'ACTIVE' | 'PENDING_REVIEW';
      readonly screening: ScreeningResult;
    }
  /** Refused. The content matched a BLOCK rule. */
  | { readonly ok: false; readonly screening: ScreeningResult };

/** Screens arbitrary content, before a listing row necessarily exists. */
export async function screenContent(input: {
  title: string;
  description: string;
  categoryId: string;
  countryId: string | null;
}): Promise<ScreeningResult> {
  const rules = await loadApplicableRules({
    categoryId: input.categoryId,
    countryId: input.countryId,
  });
  return screenListingContent({ title: input.title, description: input.description, rules });
}

/**
 * Decides whether a listing may go public, and in what state.
 *
 * Read from the DATABASE row, not from a form: a seller could create a clean
 * listing and edit it to something prohibited before publishing, so the text
 * that matters is the text that is stored right now.
 */
export async function decidePublication(listingId: string): Promise<PublishDecision | null> {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      title: true,
      description: true,
      categoryId: true,
      countryId: true,
      category: { select: { requiresApproval: true } },
    },
  });
  if (listing === null) return null;

  const screening = await screenContent({
    title: listing.title,
    description: listing.description,
    categoryId: listing.categoryId,
    countryId: listing.countryId,
  });

  if (screening.outcome === 'BLOCK') return { ok: false, screening };

  const status = requiresHumanReview({
    categoryRequiresApproval: listing.category.requiresApproval,
    screening,
  })
    ? 'PENDING_REVIEW'
    : 'ACTIVE';

  return { ok: true, status, screening };
}

/**
 * Records what screening found, so a moderator sees it rather than guessing.
 *
 * Written even when the outcome was ALLOW-with-flags: a FLAG that nobody can
 * see afterwards is the same as no rule at all. Failure to record is swallowed
 * — losing an audit row must not take down a seller's submission, and the
 * listing's own status already carries the decision.
 */
export async function recordScreening(input: {
  listingId: string;
  screening: ScreeningResult;
  outcome: 'blocked' | 'sent_for_review' | 'published';
}): Promise<void> {
  if (input.screening.matches.length === 0 && input.outcome === 'published') return;

  await prisma.moderationAction
    .create({
      data: {
        targetType: 'LISTING',
        targetId: input.listingId,
        action: input.outcome === 'blocked' ? 'auto_block' : 'auto_flag',
        // NULL moderator: no human made this call, and recording the seller
        // here would read as though they had moderated themselves.
        moderatorId: null,
        reason: input.screening.matches
          .map((match) => `${match.ruleType}:${match.pattern} (${match.field})`)
          .join('; ')
          .slice(0, 1000),
        notes: `automated screening — outcome ${input.outcome}`,
      },
    })
    .catch(() => undefined);
}
