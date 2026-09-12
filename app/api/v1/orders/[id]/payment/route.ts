import { loadOrderForParty } from '@/infra/payments/order-service';
import { createPaymentForOrder } from '@/infra/payments/payment-service';
import { PaymentsUnavailableError, paymentGateway } from '@/infra/payments/gateway-provider';
import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp, isUuid, notFound, requireAccess } from '@/lib/api/guards';
import { enforceRateLimit } from '@/lib/api/route-helpers';
import { fail, ok, requestId } from '@/lib/api/respond';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/orders/{id}/payment — begin paying for an order.
 *
 * Takes **no request body**. Everything the charge needs is on the order row,
 * written server-side at creation and made immutable from that point by a
 * database trigger. There is nothing for a browser to influence.
 *
 * Only the BUYER may begin payment. The seller is a party to the order and can
 * read it, but starting a charge against somebody else's card is not a thing
 * they may do — so the ownership check here is narrower than the read check,
 * deliberately.
 *
 * Idempotent by construction: a second call returns the SAME PaymentIntent.
 * See `payment-service.ts` for why our database, not Stripe's 24-hour key
 * retention, is the authority on that.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAccess(request, { all: ['payment:create'] });
  if (!access.ok) return access.response;

  const viewerId = access.value.principal.userId;
  const limited = await enforceRateLimit(request, RATE_LIMITS.writeApi, viewerId, {
    keyBy: 'subject',
  });
  if (!limited.ok) return limited.response;

  const { id } = await context.params;
  if (!isUuid(id)) return notFound(request);

  const order = await loadOrderForParty(id, viewerId);
  if (order === null) return notFound(request);

  // A seller reaching for their buyer's payment gets the same answer as a
  // stranger: 404, never 403, so the order's existence is not confirmed.
  if (order.buyerId !== viewerId) return notFound(request);

  let gateway;
  try {
    gateway = paymentGateway();
  } catch (error) {
    if (error instanceof PaymentsUnavailableError) {
      /*
       * 503, not 500. Payments being switched off — or a live key being
       * refused because Stripe has not approved the business model — is a
       * known operational state, not a crash. The reason names the missing
       * variable and never any part of a key.
       */
      return fail('service_unavailable', 'Payments are not available right now.', {
        request,
        status: 503,
      });
    }
    throw error;
  }

  const result = await createPaymentForOrder({ order, gateway });

  if (!result.ok) {
    if (result.issue === 'already_paid') {
      return fail('conflict', 'This order has already been paid.', { request });
    }
    if (result.issue === 'order_expired') {
      return fail('conflict', 'This order has expired. Start a new one.', { request });
    }
    return fail('conflict', 'This order cannot be paid in its current state.', { request });
  }

  if (!result.reused) {
    await tryWriteAuditLog(prisma, {
      action: 'payment.created',
      actorType: 'user',
      actorId: viewerId,
      entityType: 'payment',
      entityId: result.paymentId,
      after: {
        orderId: order.id,
        flow: order.flowType,
        amountMinor: result.amountMinor.toString(),
        currency: result.currency,
        // Recorded so a reviewer can see at a glance that a fee-only charge
        // carried no transfer leg.
        destinationAccountId: order.destinationAccountId,
        testMode: gateway.isTestMode,
      },
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      correlationId: requestId(request),
    });
  }

  return ok(
    {
      paymentId: result.paymentId,
      /*
       * The client secret is returned and NEVER stored or logged: it can
       * complete a charge. It lives in this response and in the browser's
       * memory, nowhere else.
       */
      clientSecret: result.clientSecret,
      amountMinor: result.amountMinor.toString(),
      currency: result.currency,
      /** Makes it impossible to mistake a sandbox charge for a real one. */
      testMode: gateway.isTestMode,
    },
    { status: result.reused ? 200 : 201 },
  );
}
