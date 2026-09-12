import { connectGateway, PaymentsUnavailableError } from '@/infra/payments/gateway-provider';
import { startOnboarding } from '@/infra/payments/onboarding-service';
import { connectReturnUrl, connectRefreshUrl } from '@/lib/payments/onboarding-urls';
import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp, requireAccess } from '@/lib/api/guards';
import { enforceRateLimit } from '@/lib/api/route-helpers';
import { fail, ok, requestId } from '@/lib/api/respond';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/connect/onboarding — begin or resume connected-account onboarding.
 *
 * Takes **no request body**, and that is the security property rather than a
 * convenience. The country, the email and the business name come from the
 * caller's own seller profile row, looked up by the session's user id. There is
 * no `stripeAccountId` parameter, no `country` parameter and no `capabilities`
 * parameter — so a forged one has nowhere to arrive.
 *
 * The response carries a Stripe-hosted URL and nothing about the account's
 * standing. Learning whether onboarding SUCCEEDED is a separate read
 * (`GET /connect/status`), because Stripe's return URL "only means the flow was
 * entered and exited properly".
 *
 * A fresh link is minted on every call. Stripe's Account Links are single-use
 * and short-lived, so caching one would hand the next caller a dead URL and
 * storing one would be storing a credential.
 */
export async function POST(request: Request) {
  const access = await requireAccess(request, { all: ['seller:manage_payouts'] });
  if (!access.ok) return access.response;

  const viewerId = access.value.principal.userId;

  /*
   * Keyed on the ACCOUNT, not the IP. Creating connected accounts and minting
   * hosted links costs Stripe API calls and, for the first call, creates a
   * durable object at the provider; a limit that followed the IP would give a
   * script a fresh allowance from every mobile address.
   */
  const limited = await enforceRateLimit(request, RATE_LIMITS.writeApi, viewerId, {
    keyBy: 'subject',
  });
  if (!limited.ok) return limited.response;

  let gateway;
  try {
    gateway = connectGateway();
  } catch (error) {
    if (error instanceof PaymentsUnavailableError) {
      // 503, not 500. Payments switched off — or a LIVE key refused because
      // Stripe has not approved the business model — is an operational state.
      return fail('service_unavailable', 'Payouts are not available right now.', {
        request,
        status: 503,
      });
    }
    throw error;
  }

  const result = await startOnboarding({
    userId: viewerId,
    gateway,
    returnUrl: connectReturnUrl(),
    refreshUrl: connectRefreshUrl(),
  });

  if (!result.ok) {
    if (result.issue === 'no_seller_profile') {
      return fail('conflict', 'Create a seller profile before setting up payouts.', { request });
    }
    if (result.issue === 'already_rejected') {
      /*
       * Stripe rejected this account. Handing the seller another onboarding
       * link would produce a form that cannot help them; the honest answer is
       * that the decision is not ours to retry around.
       */
      return fail('conflict', 'This account cannot be onboarded for payouts.', { request });
    }
    return fail('conflict', 'Payout onboarding cannot be started right now.', { request });
  }

  if (result.created) {
    await tryWriteAuditLog(prisma, {
      action: 'connect.account_created',
      actorType: 'user',
      actorId: viewerId,
      entityType: 'connected_account',
      entityId: result.accountId,
      // The account id belongs in the audit trail, where staff look. It is
      // deliberately absent from the response body below.
      after: { testMode: gateway.isTestMode },
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      correlationId: requestId(request),
    });
  }

  await tryWriteAuditLog(prisma, {
    action: 'connect.onboarding_link_issued',
    actorType: 'user',
    actorId: viewerId,
    entityType: 'connected_account',
    entityId: result.accountId,
    // The URL itself is NOT recorded: it grants access to the account holder's
    // personal information, which is exactly what an audit table must not hold.
    after: { expiresAt: result.expiresAt.toISOString(), testMode: gateway.isTestMode },
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  return ok(
    {
      /*
       * The hosted URL, and no account id. A seller has no use for `acct_…`,
       * and keeping it out of the response keeps it out of page source,
       * browser history and support screenshots.
       */
      url: result.url,
      expiresAt: result.expiresAt.toISOString(),
      /** Makes it impossible to mistake sandbox onboarding for the real thing. */
      testMode: gateway.isTestMode,
    },
    { status: result.created ? 201 : 200 },
  );
}
