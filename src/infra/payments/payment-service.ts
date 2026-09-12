import { prisma } from '@/infra/db/client';
import type { PaymentGateway } from '@/domain/payments/payment-gateway';
import { isFeeOnly } from '@/domain/payments/order-amounts';
import { paymentStatusFromProvider } from '@/domain/payments/payment-status';
import { chargeShapeForOrder, type OrderWithParties } from './order-service';
import { isUniqueViolation } from './order-service';

/**
 * Creating a payment, idempotently, with OUR database as the authority.
 *
 * Stripe's own idempotency keys are documented as removable "after they're at
 * least 24 hours old". A retry 25 hours later would therefore create a SECOND
 * PaymentIntent at Stripe, and nothing on their side would stop it. So the
 * durable guarantee has to be ours:
 *
 *   1. `payments.idempotency_key` is UNIQUE, and the key is deterministic
 *      (`order:<id>:pi:v1`). A second attempt is a key conflict.
 *   2. `payments_one_live_per_order` is a partial unique index, so even a
 *      differently-keyed attempt cannot open a second live payment.
 *   3. The row is inserted BEFORE the provider is called, so a crash between
 *      the two leaves a claim rather than a silent gap.
 *
 * Stripe's key is still sent, because it makes the window between (3) and the
 * provider call safe too. It is a second line, not the line.
 */

export type CreatePaymentIssue =
  'order_not_payable' | 'order_expired' | 'already_paid' | 'gateway_unavailable';

export type CreatePaymentResult =
  | {
      readonly ok: true;
      readonly paymentId: string;
      readonly providerPaymentIntentId: string;
      readonly clientSecret: string | null;
      readonly amountMinor: bigint;
      readonly currency: string;
      /** True when an existing payment was returned rather than a new one. */
      readonly reused: boolean;
    }
  | { readonly ok: false; readonly issue: CreatePaymentIssue };

/** Deterministic, and versioned so a deliberate reissue is possible later. */
export function paymentIdempotencyKey(orderId: string): string {
  return `order:${orderId}:pi:v1`;
}

/**
 * Statuses from which a buyer may still begin or resume payment.
 *
 * `PENDING_PAYMENT` is included so a buyer who closed the tab can come back to
 * the same PaymentIntent rather than opening a second one.
 */
const PAYABLE_ORDER_STATUSES = new Set(['DRAFT', 'PENDING_PAYMENT']);

export async function createPaymentForOrder(input: {
  order: OrderWithParties;
  gateway: PaymentGateway;
  now?: Date;
}): Promise<CreatePaymentResult> {
  const { order, gateway } = input;
  const now = input.now ?? new Date();

  if (!PAYABLE_ORDER_STATUSES.has(order.status)) {
    // Says "already paid" only when it actually is, so a caller does not tell
    // a buyer their cancelled order is paid.
    return {
      ok: false,
      issue: order.status === 'DRAFT' ? 'order_not_payable' : 'already_paid',
    };
  }
  if (order.expiresAt !== null && order.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, issue: 'order_expired' };
  }

  // ── An existing live payment is REUSED, never duplicated ──────────────────
  const existing = await prisma.payment.findFirst({
    where: { orderId: order.id, status: { notIn: ['FAILED', 'CANCELED'] } },
    select: {
      id: true,
      providerPaymentIntentId: true,
      amountMinor: true,
      currency: true,
      status: true,
    },
  });

  if (existing !== null) {
    if (existing.status === 'SUCCEEDED') return { ok: false, issue: 'already_paid' };

    /*
     * The client secret is NOT stored — it can complete a charge, so it lives
     * only in the response that needs it. Re-read it from the provider.
     */
    const intent = await gateway.retrievePaymentIntent(existing.providerPaymentIntentId);
    return {
      ok: true,
      paymentId: existing.id,
      providerPaymentIntentId: existing.providerPaymentIntentId,
      clientSecret: intent?.clientSecret ?? null,
      amountMinor: existing.amountMinor,
      currency: existing.currency,
      reused: true,
    };
  }

  /*
   * The charge shape is derived from the ORDER ROW, and `assertChargeIsSafe`
   * runs inside it. For FEE_ONLY that assertion refuses any amount that is not
   * exactly the commission, and refuses a destination or application fee
   * outright — the £50,000 mistake's last chance to be caught before a
   * network call.
   */
  const shape = chargeShapeForOrder(order);
  const idempotencyKey = paymentIdempotencyKey(order.id);

  const intent = await gateway.createPaymentIntent({
    amountMinor: shape.amountMinor,
    currency: order.currency,
    idempotencyKey,
    ...(shape.destinationAccountId === null
      ? {}
      : {
          destinationAccountId: shape.destinationAccountId,
          applicationFeeMinor: shape.applicationFeeMinor!,
        }),
    transferGroup: `order_${order.id}`,
    // Says what the money is FOR. A fee-only buyer sees a marketplace fee on
    // their statement, not something that looks like the price of a car.
    statementDescriptorSuffix: isFeeOnly(order.flowType) ? 'MARKETPLACE FEE' : undefined,
    metadata: {
      kurdora_order_id: order.id,
      kurdora_order_number: order.orderNumber,
      kurdora_flow: order.flowType,
    },
  });

  const status = paymentStatusFromProvider(intent.status) ?? 'REQUIRES_PAYMENT_METHOD';

  try {
    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          orderId: order.id,
          providerPaymentIntentId: intent.id,
          status,
          amountMinor: intent.amountMinor,
          currency: intent.currency,
          flowType: order.flowType,
          applicationFeeAmountMinor: shape.applicationFeeMinor,
          destinationAccountId: shape.destinationAccountId,
          transferGroup: `order_${order.id}`,
          idempotencyKey,
          livemode: intent.livemode,
        },
        select: { id: true },
      });

      // DRAFT → PENDING_PAYMENT. Guarded on the status we decided against, so
      // two concurrent requests cannot both move it.
      await tx.order.updateMany({
        where: { id: order.id, status: { in: ['DRAFT', 'PENDING_PAYMENT'] } },
        data: { status: 'PENDING_PAYMENT' },
      });

      if (order.status === 'DRAFT') {
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            fromStatus: 'DRAFT',
            toStatus: 'PENDING_PAYMENT',
            actorType: 'buyer',
            actorId: order.buyerId,
          },
        });
      }

      return created;
    });

    return {
      ok: true,
      paymentId: payment.id,
      providerPaymentIntentId: intent.id,
      clientSecret: intent.clientSecret,
      amountMinor: intent.amountMinor,
      currency: intent.currency,
      reused: false,
    };
  } catch (error) {
    /*
     * A concurrent request won the race between our `findFirst` and this
     * insert. Both `payments_one_live_per_order` and the unique idempotency
     * key can surface it. Return the row that won rather than erroring: the
     * caller asked to pay for an order, and there is exactly one payment for
     * it, which is the correct outcome.
     */
    if (
      isUniqueViolation(error, 'payments_one_live_per_order') ||
      isUniqueViolation(error, 'payments_idempotency_key_key') ||
      isUniqueViolation(error, 'payments_provider_payment_intent_id_key')
    ) {
      const winner = await prisma.payment.findFirst({
        where: { orderId: order.id, status: { notIn: ['FAILED', 'CANCELED'] } },
        select: { id: true, providerPaymentIntentId: true, amountMinor: true, currency: true },
      });
      if (winner !== null) {
        return {
          ok: true,
          paymentId: winner.id,
          providerPaymentIntentId: winner.providerPaymentIntentId,
          clientSecret: intent.clientSecret,
          amountMinor: winner.amountMinor,
          currency: winner.currency,
          reused: true,
        };
      }
    }
    throw error;
  }
}
