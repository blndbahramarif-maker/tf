import { randomUUID } from 'node:crypto';
import {
  assertTransferShape,
  type CreateIntentInput,
  type GatewayChargeSettlement,
  type GatewayEvent,
  type GatewayIntent,
  type PaymentGateway,
} from '@/domain/payments/payment-gateway';

/**
 * ### MOCK — a fake payment provider, for tests only.
 *
 * **This is not Stripe and does not talk to Stripe.** It exists so the whole
 * payment path — routes, guards, ownership checks, idempotency, the state
 * machines, the ledger — can be driven without network access or credentials.
 *
 * It is deliberately FAITHFUL where faithfulness is what the tests are
 * proving:
 *
 * - It runs `assertTransferShape`, the same domain guard the real adapter
 *   runs, so a malformed charge is rejected here exactly as it would be there.
 * - It honours the idempotency key: a second create with the same key returns
 *   the FIRST intent, which is what Stripe does within its retention window.
 * - It records every create, so a test can assert precisely what would have
 *   been sent — the amount, the destination account, the application fee.
 *   That last property is how "FEE_ONLY never sends the principal" is proven
 *   rather than asserted.
 *
 * It is deliberately NOT faithful about signatures: `constructEvent` here
 * checks a trivial marker. Real HMAC verification is Stripe's code, exercised
 * by the live-mode suite in `tests/api/stripe-live.test.ts`, which is skipped
 * without credentials.
 */
export class FakePaymentGateway implements PaymentGateway {
  readonly isTestMode = true;

  /** Every create, in order. The test's window onto what would be sent. */
  readonly creates: CreateIntentInput[] = [];

  private readonly byKey = new Map<string, GatewayIntent>();
  private readonly byId = new Map<string, GatewayIntent>();

  /** Set to throw on the next create, to exercise provider-failure paths. */
  failNextCreate: Error | null = null;

  async createPaymentIntent(input: CreateIntentInput): Promise<GatewayIntent> {
    if (this.failNextCreate !== null) {
      const error = this.failNextCreate;
      this.failNextCreate = null;
      throw error;
    }

    // The same guard the real adapter runs, in the same place.
    assertTransferShape(input);

    const existing = this.byKey.get(input.idempotencyKey);
    if (existing !== undefined) {
      // Recorded anyway: a test asserting "called once" wants to see the
      // second call happened and was absorbed, not that it vanished.
      this.creates.push(input);
      return existing;
    }

    const intent: GatewayIntent = {
      id: `pi_fake_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      status: 'requires_payment_method',
      amountMinor: input.amountMinor,
      currency: input.currency.toUpperCase(),
      clientSecret: `pi_fake_secret_${randomUUID()}`,
      latestChargeId: null,
      applicationFeeMinor: input.applicationFeeMinor ?? null,
      destinationAccountId: input.destinationAccountId ?? null,
      livemode: false,
    };

    this.creates.push(input);
    this.byKey.set(input.idempotencyKey, intent);
    this.byId.set(intent.id, intent);
    return intent;
  }

  async retrievePaymentIntent(id: string): Promise<GatewayIntent | null> {
    return this.byId.get(id) ?? null;
  }

  /**
   * Charges the fake knows about, keyed by charge id.
   *
   * A test PUTS one here with `settleCharge` to say what the provider would
   * report. Nothing is invented: an unknown charge id returns null, exactly as
   * a 404 from Stripe does, so a code path that assumes a charge always
   * settles fails here rather than in production.
   */
  private readonly charges = new Map<string, GatewayChargeSettlement>();

  async retrieveCharge(chargeId: string): Promise<GatewayChargeSettlement | null> {
    this.chargeReads.push(chargeId);
    return this.charges.get(chargeId) ?? null;
  }

  /** Every `retrieveCharge`, in order. Proves the balance transaction was read. */
  readonly chargeReads: string[] = [];

  /** Declares what the provider would report for a charge. */
  settleCharge(settlement: GatewayChargeSettlement): void {
    this.charges.set(settlement.chargeId, settlement);
  }

  /**
   * MOCK verification. A body prefixed `INVALID` is rejected; anything else
   * is accepted. Real signature verification is Stripe's own code.
   */
  constructEvent(rawBody: string, signatureHeader: string): GatewayEvent {
    if (signatureHeader === '' || signatureHeader.startsWith('INVALID')) {
      throw new Error('MOCK: signature verification failed');
    }

    const parsed = JSON.parse(rawBody) as {
      id?: string;
      type?: string;
      data?: { object?: { id?: string } };
    };

    return {
      id: parsed.id ?? `evt_fake_${randomUUID()}`,
      type: parsed.type ?? 'unknown',
      apiVersion: '2026-08-26.dahlia',
      livemode: false,
      objectId: parsed.data?.object?.id ?? null,
      payload: parsed,
    };
  }

  /** The last create, for tests that only care about the most recent charge. */
  lastCreate(): CreateIntentInput | undefined {
    return this.creates.at(-1);
  }

  /** Moves a fake intent's status, as a provider event would. */
  advance(intentId: string, status: GatewayIntent['status'], chargeId?: string): void {
    const intent = this.byId.get(intentId);
    if (intent === undefined) throw new Error(`MOCK: no such intent ${intentId}`);
    const next = { ...intent, status, latestChargeId: chargeId ?? intent.latestChargeId };
    this.byId.set(intentId, next);
    for (const [key, value] of this.byKey) {
      if (value.id === intentId) this.byKey.set(key, next);
    }
  }
}

/** Builds a provider-shaped event body for the fake `constructEvent`. */
export function fakeEventBody(input: {
  id?: string;
  type: string;
  intentId: string;
  status: string;
  latestChargeId?: string | null;
  amountMinor?: bigint;
  currency?: string;
  lastPaymentError?: { code: string; message: string };
}): string {
  return JSON.stringify({
    id: input.id ?? `evt_fake_${randomUUID()}`,
    type: input.type,
    api_version: '2026-08-26.dahlia',
    livemode: false,
    data: {
      object: {
        id: input.intentId,
        object: 'payment_intent',
        status: input.status,
        latest_charge: input.latestChargeId ?? null,
        amount: input.amountMinor === undefined ? 1000 : Number(input.amountMinor),
        currency: (input.currency ?? 'GBP').toLowerCase(),
        ...(input.lastPaymentError === undefined
          ? {}
          : { last_payment_error: input.lastPaymentError }),
      },
    },
  });
}
