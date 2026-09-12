import { prisma } from '@/infra/db/client';
import type { GatewayEvent, PaymentGateway } from '@/domain/payments/payment-gateway';
import { accountStateFromEventObject } from '@/infra/stripe/connect';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { applyAccountState, findSellerByAccountId } from './onboarding-service';
import { canTransitionOrder, type OrderStatus } from '@/domain/payments/order-status';
import {
  canTransitionPayment,
  paymentStatusFromProvider,
  type PaymentStatus,
} from '@/domain/payments/payment-status';
import { isFeeOnly, type TransactionFlow } from '@/domain/payments/order-amounts';
import { isUniqueViolation } from './order-service';

/**
 * Recording and processing provider events.
 *
 * Two phases, deliberately separated:
 *
 *   **Record** writes the event and returns. It is fast, because Stripe
 *   requires a quick 2xx: "You must quickly return a successful status code
 *   (2xx) before any complex logic that could cause a timeout."
 *
 *   **Process** does the work, guarded, in one transaction.
 *
 * Three independent layers make a duplicate harmless, and they are independent
 * on purpose — any one of them failing still leaves the other two:
 *
 *   1. `payment_events.id` IS the provider's event id, so a replayed delivery
 *      is a primary-key conflict before any logic runs.
 *   2. Semantic dedup on `(type, objectId)`, because Stripe documents that
 *      "in some cases, two separate Event objects are generated and sent" —
 *      different event ids for one underlying change.
 *   3. Every effect is a GUARDED state transition (`WHERE status = <expected>`),
 *      so a second delivery matches zero rows and is a no-op.
 *
 * Ordering is NOT assumed anywhere. Stripe: "Stripe doesn't guarantee the
 * delivery of events in the order that they're generated… Don't use `created`
 * to determine event order." An event whose precondition is not met is left
 * PENDING and retried, never dropped and never forced through.
 */

export type RecordResult =
  | { readonly ok: true; readonly duplicate: false }
  /** Already seen. The caller returns 200 and does nothing. */
  | { readonly ok: true; readonly duplicate: true };

/** Event types acted on. Anything else is recorded and IGNORED. */
export const HANDLED_EVENT_TYPES = new Set([
  // Part 1: the payment lifecycle.
  'payment_intent.succeeded',
  'payment_intent.processing',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'payment_intent.requires_action',
  // Part 2: connected-account onboarding, and settlement figures.
  'account.updated',
  'charge.succeeded',
  'charge.updated',
  'charge.failed',
]);

/**
 * Event types for which a SECOND event about the same object is a duplicate.
 *
 * This distinction is load-bearing and easy to get wrong. Stripe documents
 * that "in some cases, two separate Event objects are generated and sent" for
 * one underlying change, which is why semantic dedup on `(type, objectId)`
 * exists at all. But that reasoning only holds for events describing a
 * ONCE-ONLY transition.
 *
 * `account.updated` and `charge.updated` are the opposite: an account emits
 * one every time a requirement changes, and every one of them carries real new
 * state. Treating the second as a duplicate would silently discard the event
 * that says a seller has been restricted — a seller who then keeps taking
 * money they can no longer be paid for. So these are excluded, and the guarded
 * transitions plus the primary key on the event id remain their protection
 * against genuine replays.
 */
const SEMANTICALLY_UNIQUE_EVENT_TYPES = new Set([
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'charge.succeeded',
  'charge.failed',
]);

/** Events about a connected account rather than a payment. */
function isAccountEvent(type: string): boolean {
  return type.startsWith('account.');
}

/** Events about a charge rather than an intent or an account. */
function isChargeEvent(type: string): boolean {
  return type.startsWith('charge.');
}

/**
 * Writes the event down before anything acts on it.
 *
 * `signatureVerified` is true because this is only ever reached AFTER
 * `constructEvent` returned — which throws on a bad signature. The column
 * exists so the schema's own rule ("a row with false must never be acted on")
 * stays enforceable if an unverified-recording path is ever added.
 */
export async function recordEvent(event: GatewayEvent): Promise<RecordResult> {
  try {
    await prisma.paymentEvent.create({
      data: {
        id: event.id,
        type: event.type,
        signatureVerified: true,
        payload: event.payload as never,
        livemode: event.livemode,
        apiVersion: event.apiVersion,
        relatedObjectId: event.objectId,
        status: HANDLED_EVENT_TYPES.has(event.type) ? 'PENDING' : 'IGNORED',
      },
    });
    return { ok: true, duplicate: false };
  } catch (error) {
    // The primary key IS the provider's event id, so a replay lands here.
    if (isUniqueViolation(error, 'payment_events_pkey')) return { ok: true, duplicate: true };
    // Prisma reports a PK conflict without always naming the constraint.
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return { ok: true, duplicate: true };
    }
    throw error;
  }
}

export type ProcessOutcome =
  | 'processed'
  | 'ignored'
  | 'duplicate'
  /** The precondition is not met yet — left PENDING for a later retry. */
  | 'deferred'
  | 'failed';

/**
 * Processes one recorded event.
 *
 * Returns rather than throws for every expected outcome, so a caller can tell
 * "nothing to do" from "come back later" from "this broke".
 */
export async function processEvent(
  eventId: string,
  /**
   * Needed to read a charge's balance transaction back. Passed in rather than
   * resolved here so a test drives the whole path with no network and no
   * credentials, and so this module never decides which provider is configured.
   */
  gateway: PaymentGateway,
): Promise<ProcessOutcome> {
  const event = await prisma.paymentEvent.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      type: true,
      status: true,
      signatureVerified: true,
      relatedObjectId: true,
      payload: true,
      attempts: true,
    },
  });
  if (event === null) return 'failed';

  // The schema's own words: "A row with false must never be acted on."
  if (!event.signatureVerified) return 'failed';
  if (event.status === 'PROCESSED') return 'duplicate';
  if (event.status === 'IGNORED' || !HANDLED_EVENT_TYPES.has(event.type)) return 'ignored';
  if (event.relatedObjectId === null) return 'failed';

  /*
   * SEMANTIC deduplication. A different event id carrying the same
   * (type, object) as one we already processed is the duplicate Stripe warns
   * about, and acting on it twice would double a ledger entry.
   */
  if (SEMANTICALLY_UNIQUE_EVENT_TYPES.has(event.type)) {
    const alreadyProcessed = await prisma.paymentEvent.findFirst({
      where: {
        type: event.type,
        relatedObjectId: event.relatedObjectId,
        status: 'PROCESSED',
        id: { not: event.id },
      },
      select: { id: true },
    });
    if (alreadyProcessed !== null) {
      await prisma.paymentEvent.update({
        where: { id: event.id },
        data: { status: 'IGNORED', processedAt: new Date(), lastError: 'semantic_duplicate' },
      });
      return 'duplicate';
    }
  }

  // Two different kinds of event, two different handlers. Neither touches the
  // other's tables.
  if (isAccountEvent(event.type)) return processAccountEvent(event.id, event.payload);
  if (isChargeEvent(event.type)) {
    return processChargeEvent(event.id, event.relatedObjectId, gateway);
  }

  const payment = await prisma.payment.findUnique({
    where: { providerPaymentIntentId: event.relatedObjectId },
    select: {
      id: true,
      orderId: true,
      status: true,
      amountMinor: true,
      currency: true,
      flowType: true,
      order: {
        select: {
          id: true,
          status: true,
          buyerId: true,
          totalMinor: true,
          commissionAmountMinor: true,
          sellerAmountMinor: true,
          currency: true,
          flowType: true,
        },
      },
    },
  });

  /*
   * No payment yet. This is the OUT-OF-ORDER case, and it is expected rather
   * than exceptional: the webhook can beat our own database write. Leave it
   * PENDING, count the attempt, and let the retry find it.
   */
  if (payment === null) {
    await prisma.paymentEvent.update({
      where: { id: event.id },
      data: { attempts: { increment: 1 }, lastError: 'payment_not_found_yet' },
    });
    return 'deferred';
  }

  const providerStatus = extractIntentStatus(event.payload);
  const nextStatus = providerStatus === null ? null : paymentStatusFromProvider(providerStatus);
  if (nextStatus === null) {
    // An unrecognised provider status is NOT mapped to something plausible.
    await prisma.paymentEvent.update({
      where: { id: event.id },
      data: { status: 'FAILED', lastError: `unmapped_status:${providerStatus ?? 'none'}` },
    });
    return 'failed';
  }

  const decision = canTransitionPayment(payment.status as PaymentStatus, nextStatus, 'provider');
  if (!decision.allowed) {
    /*
     * `no_op` means we already applied this — a duplicate by another name, and
     * the guarded-transition layer doing its job. Anything else is a move the
     * table does not contain, which is worth recording rather than forcing.
     */
    await prisma.paymentEvent.update({
      where: { id: event.id },
      data: {
        status: decision.reason === 'no_op' ? 'IGNORED' : 'FAILED',
        processedAt: new Date(),
        lastError: `transition_${decision.reason}`,
      },
    });
    return decision.reason === 'no_op' ? 'duplicate' : 'failed';
  }

  const succeeded = nextStatus === 'SUCCEEDED';
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // Guarded on the status the decision was made against. A concurrent
    // delivery matches zero rows and changes nothing.
    const moved = await tx.payment.updateMany({
      where: { id: payment.id, status: payment.status },
      data: {
        status: nextStatus,
        ...(succeeded ? { succeededAt: now } : {}),
        ...(extractChargeId(event.payload) === null
          ? {}
          : { providerChargeId: extractChargeId(event.payload)! }),
        ...(extractFailure(event.payload) ?? {}),
      },
    });
    if (moved.count === 0) throw new ConcurrentEventError();

    // One charge under the intent. `skipDuplicates` because a retry of the
    // same charge must not create a second attempt row.
    const chargeId = extractChargeId(event.payload);
    if (chargeId !== null) {
      await tx.paymentAttempt.createMany({
        data: [
          {
            paymentId: payment.id,
            providerChargeId: chargeId,
            status: succeeded ? 'SUCCEEDED' : nextStatus === 'FAILED' ? 'FAILED' : 'PENDING',
            amountMinor: payment.amountMinor,
            currency: payment.currency,
            ...(succeeded ? { succeededAt: now } : {}),
          },
        ],
        skipDuplicates: true,
      });
    }

    if (succeeded) {
      await advanceOrderToPaid(tx, payment.order, now);
    }

    await tx.paymentEvent.update({
      where: { id: event.id },
      data: { status: 'PROCESSED', processedAt: now, lastError: null },
    });
  });

  return 'processed';
}

/**
 * `account.updated` — the only way a seller becomes payable.
 *
 * The Account object arrives inside the verified payload, so no provider read
 * is needed: the event IS the read, and its signature is what makes it
 * trustworthy. It is narrowed by the same `accountStateFromEventObject` the
 * direct-read path uses, because two mappings of one object is how the two
 * quietly disagree.
 *
 * **Out-of-order delivery is expected, not exceptional.** Stripe does not
 * guarantee ordering, so a stale event describing a healthy account can arrive
 * after a rejection. `applyAccountState` is where that is handled: it refuses a
 * status transition the domain table disallows while still recording the facts.
 * Nothing in this function tries to reason about ordering itself.
 */
async function processAccountEvent(eventId: string, payload: unknown): Promise<ProcessOutcome> {
  const account = accountStateFromEventObject(
    (payload as { data?: { object?: unknown } } | null)?.data?.object,
  );
  if (account === null) {
    await prisma.paymentEvent.update({
      where: { id: eventId },
      data: { status: 'FAILED', lastError: 'account_payload_unreadable' },
    });
    return 'failed';
  }

  const sellerProfileId = await findSellerByAccountId(account.accountId);

  /*
   * No seller for this account. Deferred rather than ignored: an
   * `account.updated` can beat our own write of `stripe_account_id`, which is
   * the same out-of-order case the payment path has. Dropping it would lose a
   * capability change permanently.
   */
  if (sellerProfileId === null) {
    await prisma.paymentEvent.update({
      where: { id: eventId },
      data: { attempts: { increment: 1 }, lastError: 'seller_not_found_yet' },
    });
    return 'deferred';
  }

  const now = new Date();
  const settled = await applyAccountState(sellerProfileId, account, now);

  await prisma.paymentEvent.update({
    where: { id: eventId },
    data: { status: 'PROCESSED', processedAt: now, lastError: null },
  });

  // Recorded because "when did this seller stop being payable, and on whose
  // say-so" is the first question asked when a payout fails.
  await tryWriteAuditLog(prisma, {
    action: 'connect.account_updated',
    actorType: 'system',
    actorId: null,
    entityType: 'connected_account',
    entityId: account.accountId,
    after: {
      sellerProfileId,
      status: settled,
      chargesEnabled: account.chargesEnabled,
      payoutsEnabled: account.payoutsEnabled,
      disabledReason: account.disabledReason,
      // A COUNT, not the list. Requirement keys name what Stripe wants from a
      // specific person, and an audit table is not where that belongs.
      currentlyDue: account.currentlyDue.length,
    },
  });

  return 'processed';
}

/**
 * `charge.*` — completes the payment attempt with SETTLEMENT figures.
 *
 * This is the answer to "is `latest_charge` enough?", and it is no. The intent
 * payload names the charge; it does not carry what Stripe actually took in fees
 * or what actually landed in the balance. Those live on the charge's balance
 * transaction, so the charge is read back with it expanded and the real numbers
 * are written down. Kurdora never estimates a fee.
 *
 * **What this deliberately does NOT do.** It records `refunded`, `disputed` and
 * `amount_refunded_minor` as mirrored facts, and it stops there. No ledger
 * entry is reversed, no order status changes, no payout is held. Refund and
 * dispute HANDLING is not in this phase, and a column quietly acquiring a true
 * value is not the same as the platform having handled the thing it describes.
 */
async function processChargeEvent(
  eventId: string,
  chargeId: string,
  gateway: PaymentGateway,
): Promise<ProcessOutcome> {
  const attempt = await prisma.paymentAttempt.findUnique({
    where: { providerChargeId: chargeId },
    select: { id: true, paymentId: true, status: true },
  });

  /*
   * The attempt row is created by the intent handler. A charge event that
   * arrives first is the ordinary out-of-order case — deferred for retry, never
   * dropped, and never invented as a new attempt row (which would orphan it
   * from any payment).
   */
  if (attempt === null) {
    await prisma.paymentEvent.update({
      where: { id: eventId },
      data: { attempts: { increment: 1 }, lastError: 'attempt_not_found_yet' },
    });
    return 'deferred';
  }

  const settlement = await gateway.retrieveCharge(chargeId);
  if (settlement === null) {
    await prisma.paymentEvent.update({
      where: { id: eventId },
      data: { attempts: { increment: 1 }, lastError: 'charge_not_readable' },
    });
    return 'deferred';
  }

  const now = new Date();

  await prisma.paymentAttempt.update({
    where: { id: attempt.id },
    data: {
      status:
        settlement.status === 'succeeded'
          ? 'SUCCEEDED'
          : settlement.status === 'failed'
            ? 'FAILED'
            : 'PENDING',
      providerBalanceTransactionId: settlement.balanceTransactionId,
      providerPaymentIntentId: settlement.paymentIntentId,
      paymentMethodType: settlement.paymentMethodType,
      /*
       * Null for FEE_ONLY, and that is the invariant showing up in the data:
       * a fee-only charge has no transfer leg, so there is no transfer id and
       * no destination account to record.
       */
      providerTransferId: settlement.transferId,
      destinationAccountId: settlement.destinationAccountId,
      // The REAL figures. Null while the charge is unsettled — honest, where a
      // zero would be a number that reconciles against nothing.
      providerFeeMinor: settlement.providerFeeMinor,
      providerNetMinor: settlement.netMinor,
      amountRefundedMinor: settlement.amountRefundedMinor,
      refunded: settlement.refunded,
      disputed: settlement.disputed,
      failureCode: settlement.failureCode,
      failureMessage: settlement.failureMessage,
      livemode: settlement.livemode,
      ...(settlement.status === 'succeeded' ? { succeededAt: now } : {}),
      ...(settlement.status === 'failed' ? { failedAt: now } : {}),
    },
  });

  await prisma.paymentEvent.update({
    where: { id: eventId },
    data: { status: 'PROCESSED', processedAt: now, lastError: null },
  });

  return 'processed';
}

class ConcurrentEventError extends Error {
  constructor() {
    super('The payment changed while this event was being processed.');
    this.name = 'ConcurrentEventError';
  }
}

interface OrderForPosting {
  readonly id: string;
  readonly status: string;
  readonly buyerId: string;
  readonly totalMinor: bigint;
  readonly commissionAmountMinor: bigint;
  readonly sellerAmountMinor: bigint;
  readonly currency: string;
  readonly flowType: string;
}

/**
 * PENDING_PAYMENT → PAID, and the balanced ledger group that goes with it.
 *
 * **This is the only place an order becomes PAID**, and it is reached only
 * from a signature-verified event. The transition is checked against the
 * domain table as `system` first, so the rule is enforced by the same data
 * every other caller is refused by rather than by this function being careful.
 */
async function advanceOrderToPaid(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  order: OrderForPosting,
  now: Date,
): Promise<void> {
  const decision = canTransitionOrder(order.status as OrderStatus, 'PAID', 'system');
  // Already paid, or somewhere the table does not allow. Either way the
  // payment row is updated and the order is left alone.
  if (!decision.allowed) return;

  const moved = await tx.order.updateMany({
    where: { id: order.id, status: order.status as OrderStatus },
    data: { status: 'PAID', paidAt: now },
  });
  if (moved.count === 0) return;

  await tx.orderEvent.create({
    data: {
      orderId: order.id,
      fromStatus: order.status as OrderStatus,
      toStatus: 'PAID',
      // `stripe_webhook`, never a user. The audit trail says who really did it.
      actorType: 'stripe_webhook',
      actorId: null,
    },
  });

  /*
   * The ledger. Two different recipes, because the two flows are genuinely
   * different movements of money:
   *
   *   BUY_NOW  — Kurdora receives the whole amount, owes the seller their
   *              share, and keeps the commission as revenue.
   *   FEE_ONLY — Kurdora receives its own fee. There is NO seller payable,
   *              because Kurdora never holds the sale price.
   *
   * Both are balanced entry groups; the deferrable zero-sum trigger verifies
   * that at COMMIT rather than trusting this code.
   */
  const entryGroupId = crypto.randomUUID();
  const feeOnly = isFeeOnly(order.flowType as TransactionFlow);

  const entries = feeOnly
    ? [
        {
          account: 'STRIPE_BALANCE' as const,
          direction: 'DEBIT' as const,
          amountMinor: order.totalMinor,
        },
        {
          account: 'PLATFORM_REVENUE' as const,
          direction: 'CREDIT' as const,
          amountMinor: order.totalMinor,
        },
      ]
    : [
        {
          account: 'STRIPE_BALANCE' as const,
          direction: 'DEBIT' as const,
          amountMinor: order.totalMinor,
        },
        {
          account: 'SELLER_PAYABLE' as const,
          direction: 'CREDIT' as const,
          amountMinor: order.sellerAmountMinor,
        },
        {
          account: 'PLATFORM_REVENUE' as const,
          direction: 'CREDIT' as const,
          amountMinor: order.commissionAmountMinor,
        },
      ];

  await tx.ledgerEntry.createMany({
    data: entries
      // A zero-value entry is noise in a ledger, and for a 100%-commission
      // order the seller payable is legitimately zero.
      .filter((entry) => entry.amountMinor > 0n)
      .map((entry) => ({
        entryGroupId,
        orderId: order.id,
        // The moment the money moved, not the moment we wrote the row. A
        // replayed event must not re-date the ledger.
        occurredAt: now,
        account: entry.account,
        direction: entry.direction,
        amountMinor: entry.amountMinor,
        currency: order.currency,
        description: feeOnly ? 'Fee-only order paid' : 'Order paid',
      })),
  });
}

// ── Payload readers ─────────────────────────────────────────────────────────
//
// The event payload is provider-shaped JSON. It is read defensively and never
// cast: a missing field yields null and the caller decides, rather than an
// `undefined` propagating into a money column.

function intentObject(payload: unknown): Record<string, unknown> | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const data = (payload as { data?: { object?: unknown } }).data;
  const object = data?.object;
  if (typeof object !== 'object' || object === null) return null;
  return object as Record<string, unknown>;
}

function extractIntentStatus(payload: unknown): string | null {
  const status = intentObject(payload)?.status;
  return typeof status === 'string' ? status : null;
}

function extractChargeId(payload: unknown): string | null {
  const charge = intentObject(payload)?.latest_charge;
  if (typeof charge === 'string') return charge;
  if (typeof charge === 'object' && charge !== null) {
    const id = (charge as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

function extractFailure(payload: unknown): { failureCode: string; failureMessage: string } | null {
  const error = intentObject(payload)?.last_payment_error;
  if (typeof error !== 'object' || error === null) return null;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code !== 'string') return null;
  return { failureCode: code, failureMessage: typeof message === 'string' ? message : '' };
}
