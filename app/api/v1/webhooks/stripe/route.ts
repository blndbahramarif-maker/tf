import {
  billingGateway,
  PaymentsUnavailableError,
  paymentGateway,
} from '@/infra/payments/gateway-provider';
import { processBillingEvent, recordBillingEvent } from '@/infra/billing/webhook-service';
import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp } from '@/lib/api/guards';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/webhooks/stripe — the only way a subscription becomes payable.
 *
 * Kurdora's OWN billing. Nothing here concerns a seller's sale: there is no
 * connected account, no transfer and no payout, because the sale of a listed
 * item never passes through Stripe (ADR-0014).
 *
 * The route is deliberately unlike every other, and each difference matters:
 *
 * **It reads the RAW body.** `await request.text()`, never `.json()`. Stripe
 * requires the raw body for signature verification; parsing and
 * re-serialising produces a body that no longer matches the signature.
 *
 * **It has no session and no CSRF check.** It is authenticated by the HMAC
 * signature over that raw body. This is the one deliberate exception to the
 * CSRF rule, and it is only safe because nothing in this handler reads a
 * cookie — a request arriving with one gains nothing from it.
 *
 * **It answers 200 once the signature verifies**, whatever the processing
 * outcome. A bug in our own code must not make Stripe retry for three days
 * while the bug remains. The only non-200 is 400 for a signature that does
 * not verify, which is the answer an attacker gets.
 */
export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (signature === null) {
    return new Response(JSON.stringify({ error: 'missing_signature' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  let verifier;
  let billing;
  try {
    // `constructEvent` lives on the payment gateway; both adapters verify with
    // the same webhook secret against Kurdora's own account.
    verifier = paymentGateway();
    billing = billingGateway();
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
    event = verifier.constructEvent(rawBody, signature);
  } catch {
    /*
     * A bad signature, a stale timestamp outside the 5-minute tolerance, or a
     * tampered body. All three land here and all three get the same answer.
     *
     * Audited, because a forged webhook is an attempt to mark a subscription
     * paid from the outside — the most valuable thing an attacker could do to
     * this system. The reason is NOT echoed to the caller.
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

  const recorded = await recordBillingEvent(event);
  if (recorded.duplicate) {
    // Already seen. The primary key is Stripe's event id, so this cost one
    // failed insert and nothing else.
    return Response.json({ received: true, duplicate: true });
  }

  const outcome = await processBillingEvent(event.id, billing);

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
