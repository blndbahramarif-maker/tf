import { loadOrderForParty } from '@/infra/payments/order-service';
import { prisma } from '@/infra/db/client';
import { isUuid, notFound, requireAccess } from '@/lib/api/guards';
import { enforceRateLimit } from '@/lib/api/route-helpers';
import { ok } from '@/lib/api/respond';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/orders/{id} — one order, to its buyer or its seller.
 *
 * This is the endpoint a return-from-Stripe page reads, and it is why that
 * page cannot lie: the status here comes from the ORDER ROW, which only a
 * verified webhook can move to PAID. A buyer who replays the `return_url`, or
 * edits its query string, sees whatever the database says — which is
 * `PENDING_PAYMENT` until Stripe tells us otherwise.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAccess(request, { all: ['order:read_own'] });
  if (!access.ok) return access.response;

  const viewerId = access.value.principal.userId;
  const limited = await enforceRateLimit(request, RATE_LIMITS.readApi, viewerId);
  if (!limited.ok) return limited.response;

  const { id } = await context.params;
  if (!isUuid(id)) return notFound(request);

  const order = await loadOrderForParty(id, viewerId);
  if (order === null) return notFound(request);

  const payment = await prisma.payment.findFirst({
    where: { orderId: order.id },
    orderBy: { createdAt: 'desc' },
    select: { status: true, providerPaymentIntentId: true, succeededAt: true },
  });

  return ok({
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      listingId: order.listingId,
      listingTitle: order.listingTitle,
      flowType: order.flowType,
      status: order.status,
      // Money crosses the wire as integer minor-unit strings (ADR-0004).
      totalMinor: order.totalMinor.toString(),
      commissionAmountMinor: order.commissionAmountMinor.toString(),
      sellerAmountMinor: order.sellerAmountMinor.toString(),
      /** The agreed sale price for FEE_ONLY. Recorded, never charged. */
      principalMinor: order.principalMinor?.toString() ?? null,
      currency: order.currency,
      viewerRole: order.buyerId === viewerId ? 'buyer' : 'seller',
      expiresAt: order.expiresAt?.toISOString() ?? null,
    },
    payment:
      payment === null
        ? null
        : {
            status: payment.status,
            providerPaymentIntentId: payment.providerPaymentIntentId,
            succeededAt: payment.succeededAt?.toISOString() ?? null,
          },
  });
}
