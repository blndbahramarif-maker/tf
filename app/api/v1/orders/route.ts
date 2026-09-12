import { createOrder } from '@/infra/payments/order-service';
import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp, requireAccess } from '@/lib/api/guards';
import { enforceRateLimit, parseBody } from '@/lib/api/route-helpers';
import { fail, ok, requestId } from '@/lib/api/respond';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';
import { createOrderSchema } from '@/shared/payments-contract';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/orders — create an order to buy a listing.
 *
 * The request names a listing and, optionally, an accepted offer. It does NOT
 * name an amount, a currency, a seller, a connected account or a commission —
 * those fields are not in the schema, so `z.object`'s stripping means they
 * cannot arrive even if sent.
 *
 * **No money moves here.** Creating an order records what is about to be paid.
 * The charge is a separate, explicit step at
 * `POST /api/v1/orders/{id}/payment`.
 */
export async function POST(request: Request) {
  const access = await requireAccess(request, { all: ['order:create'] });
  if (!access.ok) return access.response;

  const buyerId = access.value.principal.userId;

  const limited = await enforceRateLimit(request, RATE_LIMITS.writeApi, buyerId, {
    keyBy: 'subject',
  });
  if (!limited.ok) return limited.response;

  const body = await parseBody(request, createOrderSchema);
  if (!body.ok) return body.response;

  const created = await createOrder({
    listingId: body.value.listingId,
    buyerId,
    offerId: body.value.offerId ?? null,
  });

  if (!created.ok) {
    if (created.issue === 'listing_not_found') {
      return fail('not_found', 'Not found.', { request, status: 404 });
    }
    if (created.issue === 'own_listing') {
      return fail('conflict', 'You cannot buy your own listing.', { request });
    }
    if (created.issue === 'order_already_open') {
      return fail('conflict', 'You already have an open order for this listing.', { request });
    }
    if (created.issue === 'seller_not_payable') {
      // The seller has not finished onboarding. Said plainly rather than as a
      // 404, because the listing genuinely exists and the buyer may return.
      return fail('conflict', 'This seller cannot accept payments yet.', { request });
    }
    return fail('validation_failed', 'That order could not be created.', {
      request,
      fields: [{ path: 'listingId', message: created.issue }],
    });
  }

  await tryWriteAuditLog(prisma, {
    action: 'order.created',
    actorType: 'user',
    actorId: buyerId,
    entityType: 'order',
    entityId: created.orderId,
    after: {
      listingId: body.value.listingId,
      // Money as strings in the audit trail, like everywhere else (ADR-0004).
      totalMinor: created.amounts.totalMinor.toString(),
      commissionAmountMinor: created.amounts.commissionAmountMinor.toString(),
      principalMinor: created.amounts.principalMinor?.toString() ?? null,
      currency: created.amounts.currency,
    },
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  return ok(
    {
      id: created.orderId,
      status: 'DRAFT',
      totalMinor: created.amounts.totalMinor.toString(),
      commissionAmountMinor: created.amounts.commissionAmountMinor.toString(),
      principalMinor: created.amounts.principalMinor?.toString() ?? null,
      currency: created.amounts.currency,
    },
    { status: 201 },
  );
}
