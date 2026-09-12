import { loadOnboardingSnapshot } from '@/infra/payments/onboarding-service';
import { requireAccess } from '@/lib/api/guards';
import { noStore } from '@/lib/api/route-helpers';
import { fail, ok } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/connect/status — the caller's own onboarding standing.
 *
 * Scoped by the session's user id, so there is no id to address and no IDOR
 * surface: a seller can ask about themselves and there is no way to phrase the
 * question differently.
 *
 * Everything returned is MIRRORED from a verified provider read or an
 * `account.updated` event. This route never calls Stripe — a page poll must
 * not be able to drive traffic at the provider, and a rate-limited or degraded
 * Stripe must not make a seller's own dashboard unreadable.
 *
 * The connected account id is deliberately not part of the response, and the
 * answer is never cached: payability changes without the seller doing anything,
 * so a cached answer is a seller being told they can trade when they no longer
 * can.
 */
export async function GET(request: Request) {
  const access = await requireAccess(request, { all: ['seller:manage_payouts'] });
  if (!access.ok) return access.response;

  const snapshot = await loadOnboardingSnapshot(access.value.principal.userId);
  if (snapshot === null) {
    return fail('conflict', 'This account has no seller profile.', { request });
  }

  return noStore(
    ok({
      status: snapshot.status,
      hasAccount: snapshot.hasAccount,
      chargesEnabled: snapshot.chargesEnabled,
      payoutsEnabled: snapshot.payoutsEnabled,
      detailsSubmitted: snapshot.detailsSubmitted,
      disabledReason: snapshot.disabledReason,
      /*
       * Requirement KEYS only, e.g. `individual.verification.document`. These
       * name what Stripe is waiting for; no value a seller submitted is stored
       * or returned, and no identity document ever reaches Kurdora.
       */
      currentlyDue: snapshot.currentlyDue,
      pastDue: snapshot.pastDue,
      payoutDelayDays: snapshot.payoutDelayDays,
      syncedAt: snapshot.syncedAt?.toISOString() ?? null,
    }),
  );
}
