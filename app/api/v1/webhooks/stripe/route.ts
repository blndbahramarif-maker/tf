import { PaymentsUnavailableError, paymentGateway } from '@/infra/payments/gateway-provider';
import { processEvent, recordEvent } from '@/infra/payments/webhook-service';
import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp } from '@/lib/api/guards';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/webhooks/stripe — the only way payment state moves forward.
 *
 * This route is deliberately unlike every other route in the codebase, and
 * each difference is load-bearing:
 *
 * **It reads the RAW body.** `await request.text()`, never `.json()`. Stripe:
 * "Stripe requires the raw body of the request to perform signature
 * verification… Any manipulation to the raw body of the request causes the
 * verification to fail." Parsing first and re-serialising would produce a body
 * that no longer matches the signature.
 *
 * **It has no session and no CSRF check.** It is authenticated by the HMAC
 * signature over that raw body, not by a cookie. This is the one deliberate
 * exception to CLAUDE.md non-negotiable 18, recorded in ADR-0013: a CSRF token
 * would be meaningless here because Stripe is not a browser and holds no
 * session. Nothing in this handler reads a cookie, so a request that arrives
 * carrying one gains nothing from it.
 *
 * **It always answers 200 once the signature verifies.** A processing failure
 * is recorded and retried by us, not pushed back to Stripe as a non-2xx —
 * otherwise a bug in our ledger code would make Stripe retry for three days
 * and we would still have the bug.
 *
 * The only non-200 is 400 for a signature that does not verify, which is the
 * answer an attacker gets.
 */
export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (signature === null) {
    return new Response(JSON.stringify({ error: 'missing_signature' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  let gateway;
  try {
    gateway = paymentGateway();
  } catch (error) {
    if (error instanceof PaymentsUnavailableError) {
      // Nothing is configured to verify against, so nothing can be trusted.
      return new Response(JSON.stringify({ error: 'not_configured' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw error;
  }

  // RAW. This line is the reason the route exists in this shape.
  const rawBody = await request.text();

  let event;
  try {
    event = gateway.constructEvent(rawBody, signature);
  } catch {
    /*
     * A bad signature, a stale timestamp outside the 5-minute tolerance, or a
     * tampered body. All three land here and all three get the same answer.
     *
     * Audited, because a forged webhook is an attempt to mark an order paid
     * from the outside — the single most valuable thing an attacker could do
     * to this system. The failure reason is NOT echoed to the caller.
     */
    await tryWriteAuditLog(prisma, {
      action: 'webhook.rejected',
      actorType: 'system',
      actorId: null,
      entityType: 'stripe_webhook',
      entityId: null,
      after: { reason: 'signature_verification_failed' },
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      correlationId: null,
    });

    return new Response(JSON.stringify({ error: 'invalid_signature' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const recorded = await recordEvent(event);
  if (recorded.duplicate) {
    // Already seen. The primary key is the provider's event id, so this cost
    // one failed insert and nothing else.
    return Response.json({ received: true, duplicate: true });
  }

  /*
   * Processed inline in Part 1, and the trade-off is stated rather than
   * hidden: the gate report's design defers processing to the worker so the
   * 2xx is instant. Part 1 has no worker consumer for payment events yet, and
   * an event recorded but never processed would be worse than a slightly
   * slower acknowledgement. The event is RECORDED first either way, so moving
   * to the worker later changes only where `processEvent` is called from.
   */
  const outcome = await processEvent(event.id, gateway);

  await tryWriteAuditLog(prisma, {
    action: 'webhook.processed',
    actorType: 'system',
    actorId: null,
    entityType: 'stripe_webhook',
    entityId: event.id,
    after: { type: event.type, outcome, livemode: event.livemode },
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: null,
  });

  // 200 whatever the outcome. `deferred` and `failed` are ours to retry.
  return Response.json({ received: true, outcome });
}
