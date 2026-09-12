/**
 * Order lifecycle.
 *
 * The transition table is DATA, exactly as the listing and offer lifecycles
 * are. What is new here is the actor `system`, and it carries a specific
 * meaning that the rest of the codebase depends on:
 *
 *   **`system` means "a Stripe webhook whose signature verified".**
 *
 * It is not "a background job", not "an admin acting on behalf of", and not
 * "our server decided". Every transition that moves an order toward money
 * having been received is reserved to `system`, so there is no route, no
 * Server Action and no browser redirect that can reach it. That is the single
 * rule this file exists to enforce, and `PAID` is the one it protects:
 *
 *   PENDING_PAYMENT → PAID   is system-only.
 *
 * A buyer who replays the `return_url`, a seller who forges a form field, and
 * an attacker who POSTs directly at a Server Action all land on the same
 * answer, because none of them is `system`.
 */

export const ORDER_STATUSES = [
  'DRAFT',
  'PENDING_PAYMENT',
  'PAID',
  'FULFILLING',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'REFUNDING',
  'REFUNDED',
  'DISPUTED',
  'CHARGEBACK',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Who is acting.
 *
 * `buyer` and `seller` are resolved from the database — the buyer is the
 * order's `buyerId`, the seller is the listing's owner. `admin` is a staff
 * member holding the permission AND inside the step-up window. `system` is a
 * verified webhook, and nothing else may ever claim it.
 */
export type OrderActor = 'buyer' | 'seller' | 'admin' | 'system';

export interface OrderTransition {
  readonly from: OrderStatus;
  readonly to: OrderStatus;
  readonly actors: readonly OrderActor[];
  readonly description: string;
  /**
   * True when only a verified provider event may make this move. Held on the
   * row rather than inferred from the actor list, so the intent is readable
   * and so a test can assert every money-forward transition carries it.
   */
  readonly webhookOnly: boolean;
}

export const ORDER_TRANSITIONS: readonly OrderTransition[] = [
  {
    from: 'DRAFT',
    to: 'PENDING_PAYMENT',
    actors: ['buyer'],
    description: 'Begin payment',
    webhookOnly: false,
  },
  {
    from: 'DRAFT',
    to: 'CANCELLED',
    actors: ['buyer', 'seller'],
    description: 'Abandon before paying',
    webhookOnly: false,
  },

  // ── The one that matters ──────────────────────────────────────────────────
  {
    from: 'PENDING_PAYMENT',
    to: 'PAID',
    actors: ['system'],
    description: 'Payment confirmed by the provider',
    webhookOnly: true,
  },
  {
    from: 'PENDING_PAYMENT',
    to: 'CANCELLED',
    actors: ['buyer', 'seller'],
    description: 'Call off before payment succeeds',
    webhookOnly: false,
  },
  {
    from: 'PENDING_PAYMENT',
    to: 'EXPIRED',
    actors: ['system'],
    description: 'Payment window elapsed',
    webhookOnly: false,
  },

  {
    from: 'PAID',
    to: 'FULFILLING',
    actors: ['seller'],
    description: 'Begin fulfilment',
    webhookOnly: false,
  },
  {
    from: 'FULFILLING',
    to: 'COMPLETED',
    actors: ['buyer', 'system'],
    description: 'Delivery confirmed',
    webhookOnly: false,
  },

  /*
   * Refunds start from any state in which money has actually been taken.
   * Requesting one is a platform action; COMPLETING one is the provider's,
   * which is why REFUNDING → REFUNDED is webhook-only.
   */
  {
    from: 'PAID',
    to: 'REFUNDING',
    actors: ['seller', 'admin'],
    description: 'Refund requested',
    webhookOnly: false,
  },
  {
    from: 'FULFILLING',
    to: 'REFUNDING',
    actors: ['seller', 'admin'],
    description: 'Refund requested',
    webhookOnly: false,
  },
  {
    from: 'COMPLETED',
    to: 'REFUNDING',
    actors: ['seller', 'admin'],
    description: 'Refund requested',
    webhookOnly: false,
  },
  {
    from: 'REFUNDING',
    to: 'REFUNDED',
    actors: ['system'],
    description: 'Refund settled by the provider',
    webhookOnly: true,
  },

  // ── Disputes are never ours to declare ────────────────────────────────────
  {
    from: 'PAID',
    to: 'DISPUTED',
    actors: ['system'],
    description: 'Buyer disputed the charge',
    webhookOnly: true,
  },
  {
    from: 'FULFILLING',
    to: 'DISPUTED',
    actors: ['system'],
    description: 'Buyer disputed the charge',
    webhookOnly: true,
  },
  {
    from: 'COMPLETED',
    to: 'DISPUTED',
    actors: ['system'],
    description: 'Buyer disputed the charge',
    webhookOnly: true,
  },
  {
    from: 'DISPUTED',
    to: 'CHARGEBACK',
    actors: ['system'],
    description: 'Dispute lost',
    webhookOnly: true,
  },
  {
    from: 'DISPUTED',
    to: 'PAID',
    actors: ['system'],
    description: 'Dispute won',
    webhookOnly: true,
  },
];

/**
 * Statuses nothing leaves.
 *
 * `COMPLETED` is deliberately NOT here, and the distinction is a real one: a
 * delivered order can still be refunded or disputed weeks later. Listing it as
 * terminal would have been tidy and wrong — a completed sale is finished as a
 * fulfilment, not as a financial event.
 */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  'CANCELLED',
  'EXPIRED',
  'REFUNDED',
  'CHARGEBACK',
];

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

/** Statuses in which money has demonstrably been taken. */
export const PAID_ORDER_STATUSES: readonly OrderStatus[] = [
  'PAID',
  'FULFILLING',
  'COMPLETED',
  'REFUNDING',
  'DISPUTED',
];

export type OrderDecision =
  | { readonly allowed: true; readonly transition: OrderTransition }
  | {
      readonly allowed: false;
      readonly reason: 'unknown_transition' | 'wrong_actor' | 'no_op' | 'webhook_only';
    };

export function canTransitionOrder(
  from: OrderStatus,
  to: OrderStatus,
  actor: OrderActor,
): OrderDecision {
  if (from === to) return { allowed: false, reason: 'no_op' };

  const candidates = ORDER_TRANSITIONS.filter(
    (transition) => transition.from === from && transition.to === to,
  );
  if (candidates.length === 0) return { allowed: false, reason: 'unknown_transition' };

  const permitted = candidates.find((transition) => transition.actors.includes(actor));
  if (!permitted) {
    /*
     * A webhook-only move attempted by a person is reported distinctly from
     * "you are the wrong party". It is the signature we most want to see in an
     * audit log: somebody tried to mark an order paid from the outside.
     */
    const webhookOnly = candidates.some((transition) => transition.webhookOnly);
    return { allowed: false, reason: webhookOnly ? 'webhook_only' : 'wrong_actor' };
  }

  return { allowed: true, transition: permitted };
}

/** Transitions available to one actor right now, for rendering controls. */
export function availableOrderTransitions(
  from: OrderStatus,
  actor: OrderActor,
): readonly OrderTransition[] {
  return ORDER_TRANSITIONS.filter(
    (transition) => transition.from === from && transition.actors.includes(actor),
  );
}

/**
 * How long a buyer has to complete payment before the order expires.
 *
 * Short on purpose: a `PENDING_PAYMENT` order holds nothing and reserves
 * nothing, but a stale one is a confusing thing for a seller to look at.
 */
export const ORDER_PAYMENT_WINDOW_MINUTES = 60;

export function orderExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + ORDER_PAYMENT_WINDOW_MINUTES * 60 * 1000);
}
