import { billingGateway, PaymentsUnavailableError } from '@/infra/payments/gateway-provider';
import {
  loadSubscriptionForOwner,
  startListingCheckout,
} from '@/infra/billing/subscription-service';
import { subscriptionUrls } from '@/lib/billing/subscription-urls';
import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp, isUuid, notFound, requireAccess } from '@/lib/api/guards';
import { enforceRateLimit, noStore } from '@/lib/api/route-helpers';
import { fail, ok, requestId } from '@/lib/api/respond';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Subscribing a listing to Kurdora's own service.
 *
 * Takes **no request body**, and that absence is the security property. The
 * plan, the price, the currency and the Stripe customer are all read from the
 * database. There is no `amount`, no `priceId`, no `status` and no
 * `stripeSubscriptionId` field in any schema here, so a forged one has nowhere
 * to arrive — `z.object` cannot strip a field that was never declared, because
 * there is no body to parse at all.
 *
 * This is **not** Stripe Connect. Kurdora is charging for its own service; the
 * sale of the listed item stays between buyer and seller (ADR-0014).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAccess(request, { all: ['listing:update_own'] });
  if (!access.ok) return access.response;

  const viewerId = access.value.principal.userId;
  // Keyed on the ACCOUNT: creating Checkout Sessions costs provider calls, and
  // an IP-keyed limit gives a script a fresh allowance per address.
  const limited = await enforceRateLimit(request, RATE_LIMITS.writeApi, viewerId, {
    keyBy: 'subject',
  });
  if (!limited.ok) return limited.response;

  const { id } = await context.params;
  if (!isUuid(id)) return notFound(request);

  let gateway;
  try {
    gateway = billingGateway();
  } catch (error) {
    if (error instanceof PaymentsUnavailableError) {
      // 503, not 500. Billing switched off — or a LIVE key refused — is an
      // operational state, not a crash.
      return fail('service_unavailable', 'Subscriptions are not available right now.', {
        request,
        status: 503,
      });
    }
    throw error;
  }

  const urls = subscriptionUrls(id);
  const result = await startListingCheckout({
    userId: viewerId,
    listingId: id,
    gateway,
    successUrl: urls.success,
    cancelUrl: urls.cancel,
  });

  if (!result.ok) {
    // A listing belonging to someone else is indistinguishable from one that
    // does not exist.
    if (result.issue === 'listing_not_found') return notFound(request);
    if (result.issue === 'already_subscribed') {
      return fail('conflict', 'This listing already has a subscription.', { request });
    }
    return fail('service_unavailable', 'No subscription plan is available right now.', {
      request,
      status: 503,
    });
  }

  await tryWriteAuditLog(prisma, {
    action: 'subscription.checkout_started',
    actorType: 'user',
    actorId: viewerId,
    entityType: 'listing_subscription',
    entityId: result.subscriptionId,
    // Never the URL: a Checkout URL is a credential for a billing session.
    after: { listingId: id, testMode: gateway.isTestMode },
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  return ok({ url: result.url, testMode: gateway.isTestMode }, { status: 201 });
}

/**
 * GET — the caller's own subscription for this listing.
 *
 * Scoped by the session's user id inside the query, so a listing id belonging
 * to somebody else resolves to nothing and answers 404 rather than 403. Never
 * calls Stripe: everything returned is mirrored from a verified event, so a
 * page poll cannot drive traffic at the provider.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAccess(request, { all: ['listing:update_own'] });
  if (!access.ok) return access.response;

  const { id } = await context.params;
  if (!isUuid(id)) return notFound(request);

  const subscription = await loadSubscriptionForOwner(id, access.value.principal.userId);
  if (subscription === null) return notFound(request);

  return noStore(
    ok({
      status: subscription.status,
      // Minor units as a STRING on the wire (ADR-0004/0006).
      amountMinor: subscription.amountMinor.toString(),
      currency: subscription.currency,
      interval: subscription.plan.interval,
      planName: subscription.plan.name,
      currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    }),
  );
}
