import { prisma } from '@/infra/db/client';
import type { GatewayEvent } from '@/domain/payments/payment-gateway';
import type { ProviderSubscription } from '@/domain/billing/billing-gateway';
import { applyProviderSubscription } from './subscription-service';

/**
 * Recording and processing Stripe Billing events for Kurdora's own
 * subscriptions.
 *
 * Event types verified against Stripe's subscription-webhook documentation on
 * 2026-09-13.
 *
 * Duplicates are harmless three times over, and the layers are independent so
 * that any one failing still leaves the other two:
 *
 *   1. `payment_events.id` IS Stripe's event id, so a replayed delivery is a
 *      primary-key conflict before any logic runs.
 *   2. Semantic dedup for the ONCE-ONLY event types.
 *   3. Every effect is a guarded transition in `applyProviderSubscription`,
 *      which also refuses a stale (out-of-order) description.
 */

export type RecordResult = { readonly ok: true; readonly duplicate: boolean };

/**
 * Events acted on. Anything else is recorded and IGNORED.
 *
 * `customer.subscription.*` carries the Subscription object itself, which is
 * the authority on status. The `invoice.*` events are handled by RE-READING
 * the subscription rather than by inferring status from the invoice: Stripe is
 * explicit that you provision on `invoice.paid` *"and the subscription status
 * is active"*, so the invoice alone is not the answer.
 */
export const BILLING_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_failed',
]);

/**
 * Types where a SECOND event about the same object is genuinely a duplicate.
 *
 * `customer.subscription.updated` is deliberately absent: a subscription emits
 * one on every renewal and every change, each carrying real new state.
 * Deduping it would silently discard the event that says a seller stopped
 * paying — and the listing would stay up for free.
 */
const SEMANTICALLY_UNIQUE = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.deleted',
]);

export async function recordBillingEvent(event: GatewayEvent): Promise<RecordResult> {
  try {
    await prisma.paymentEvent.create({
      data: {
        id: event.id,
        type: event.type,
        // True because this is only reached AFTER `constructEvent` returned,
        // and that throws on a bad signature.
        signatureVerified: true,
        payload: event.payload as never,
        livemode: event.livemode,
        apiVersion: event.apiVersion,
        relatedObjectId: event.objectId,
        status: BILLING_EVENT_TYPES.has(event.type) ? 'PENDING' : 'IGNORED',
      },
    });
    return { ok: true, duplicate: false };
  } catch (error) {
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

export type ProcessOutcome = 'processed' | 'ignored' | 'duplicate' | 'deferred' | 'failed';

/**
 * Processes one recorded billing event.
 *
 * `gateway` is passed in rather than resolved here so a test drives the whole
 * path with no network, and so this module never decides which provider is
 * configured.
 */
export async function processBillingEvent(
  eventId: string,
  /**
   * Narrowed to the ONE method this needs. A processor that cannot create a
   * checkout or cancel a subscription cannot be made to do either by a bug.
   */
  gateway: { retrieveSubscription: (id: string) => Promise<ProviderSubscription | null> },
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
    },
  });
  if (event === null) return 'failed';

  // The schema's own rule: a row with false must never be acted on.
  if (!event.signatureVerified) return 'failed';
  if (event.status === 'PROCESSED') return 'duplicate';
  if (event.status === 'IGNORED' || !BILLING_EVENT_TYPES.has(event.type)) return 'ignored';

  if (SEMANTICALLY_UNIQUE.has(event.type) && event.relatedObjectId !== null) {
    const already = await prisma.paymentEvent.findFirst({
      where: {
        type: event.type,
        relatedObjectId: event.relatedObjectId,
        status: 'PROCESSED',
        id: { not: event.id },
      },
      select: { id: true },
    });
    if (already !== null) {
      await prisma.paymentEvent.update({
        where: { id: event.id },
        data: { status: 'IGNORED', processedAt: new Date(), lastError: 'semantic_duplicate' },
      });
      return 'duplicate';
    }
  }

  const subscriptionId = await resolveSubscriptionId(event.type, event.payload);
  if (subscriptionId === null) {
    await prisma.paymentEvent.update({
      where: { id: event.id },
      data: { status: 'FAILED', lastError: 'no_subscription_in_payload' },
    });
    return 'failed';
  }

  /*
   * The subscription is RE-READ from the provider rather than taken from the
   * event payload.
   *
   * For `invoice.*` the payload is an Invoice, which does not carry the
   * subscription's status at all — and Stripe's guidance is to provision on
   * `invoice.paid` only when the subscription is active. Re-reading also means
   * an out-of-order event converges on the truth instead of applying a stale
   * snapshot. It costs one API call per event, which is the right trade for
   * the thing that decides whether a seller keeps their listing.
   */
  const provider = await gateway.retrieveSubscription(subscriptionId);
  if (provider === null) {
    await prisma.paymentEvent.update({
      where: { id: event.id },
      data: { attempts: { increment: 1 }, lastError: 'subscription_not_readable' },
    });
    return 'deferred';
  }

  const outcome = await applyProviderSubscription({ provider, providerEventId: event.id });

  if (outcome === 'not_found') {
    // Out of order: the event beat our own write. Deferred, never dropped.
    await prisma.paymentEvent.update({
      where: { id: event.id },
      data: { attempts: { increment: 1 }, lastError: 'subscription_row_not_found_yet' },
    });
    return 'deferred';
  }

  await prisma.paymentEvent.update({
    where: { id: event.id },
    data: {
      status: 'PROCESSED',
      processedAt: new Date(),
      lastError: outcome === 'applied' ? null : outcome,
    },
  });

  return 'processed';
}

/**
 * Finds the subscription id an event is about.
 *
 * The invoice path uses `parent.subscription_details.subscription`. Verified
 * on 2026-09-13: for API versions from `2025-03-31.basil` onward — and this
 * integration is pinned to `2026-08-26.dahlia` — the old top-level
 * `invoice.subscription` is gone, and reading it would silently yield nothing.
 */
async function resolveSubscriptionId(type: string, payload: unknown): Promise<string | null> {
  const object = eventObject(payload);
  if (object === null) return null;

  if (type.startsWith('customer.subscription.')) {
    /*
     * The ID only, not the whole object.
     *
     * Parsing the full subscription here would couple id-resolution to status
     * MAPPING, so an event carrying a status Stripe added after this code was
     * written would resolve to nothing and be dropped — precisely the event
     * most worth re-reading. The id is all that is needed, and the provider is
     * the authority on everything else.
     */
    const id = object.id;
    return typeof id === 'string' && id.startsWith('sub_') ? id : null;
  }

  if (type === 'checkout.session.completed') {
    const subscription = object.subscription;
    if (typeof subscription === 'string') return subscription;
    if (typeof subscription === 'object' && subscription !== null) {
      const id = (subscription as { id?: unknown }).id;
      return typeof id === 'string' ? id : null;
    }
    return null;
  }

  if (type.startsWith('invoice.')) {
    const parent = object.parent as
      { subscription_details?: { subscription?: unknown } } | undefined;
    const subscription = parent?.subscription_details?.subscription;
    if (typeof subscription === 'string') return subscription;
    if (typeof subscription === 'object' && subscription !== null) {
      const id = (subscription as { id?: unknown }).id;
      return typeof id === 'string' ? id : null;
    }
    return null;
  }

  return null;
}

function eventObject(payload: unknown): Record<string, unknown> | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const data = (payload as { data?: { object?: unknown } }).data;
  const object = data?.object;
  if (typeof object !== 'object' || object === null) return null;
  return object as Record<string, unknown>;
}
