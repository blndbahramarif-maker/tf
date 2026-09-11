# 06 — Marketplace Transaction Flows

Flow behaviour is **data**, not code branching on category names.
`categories.transaction_flow ∈ { buy_now, offer_then_pay, fee_only, contact_only }`,
with `allows_online_payment`, `min_price_minor`, `max_online_amount_minor` and
`requires_approval` as further per-category switches.

## Order state machine

```
                   ┌────────────┐
                   │   draft    │
                   └─────┬──────┘
                         ▼
                 ┌───────────────┐   timeout / buyer cancels
                 │pending_payment│ ─────────────────────────► cancelled / expired
                 └───────┬───────┘
            webhook: payment_intent.succeeded
                         ▼
                   ┌──────────┐
                   │   paid   │
                   └────┬─────┘
            ┌───────────┼────────────┐
            ▼           ▼            ▼
     ┌───────────┐ ┌──────────┐ ┌──────────┐
     │ fulfilling│ │ disputed │ │refunding │
     └─────┬─────┘ └────┬─────┘ └────┬─────┘
           ▼            ▼            ▼
     ┌───────────┐ ┌───────────────────────┐
     │ completed │ │ refunded / chargeback │
     └─────┬─────┘ └───────────────────────┘
           ▼
   review window opens (both directions)
```

Rules:
- Transitions are **only** performed by the server, and the `paid` transition **only**
  by a verified webhook handler.
- Every transition appends to `order_events` with actor, reason and correlation id.
- Illegal transitions throw — the state machine is a typed table in
  `packages/shared`, unit-tested exhaustively.

## Flow 1 — Buy Now
*Mobile, Electronics, Clothing, Kurdish Clothing, Furniture, Household, Food, Cultural Products*

Pre-flight validation, all server-side, all mandatory:
listing `active` · seller `payouts_enabled` · buyer ≠ seller · quantity available ·
price matches the server's current price (guards against a stale tab) · category allows
online payment · amount within the category's online limit · buyer not blocked by seller.

Then: order created with commission snapshot → PaymentIntent (destination charge) →
Payment Element with SCA → **webhook confirms** → `paid`.

## Flow 2 — Offer → Accept → Pay
*Cars, Business, and any high-value category. Under [DL-2](./12-decisions-log.md) the
final "pay" step for these categories is the **fee-only** charge of Flow 3, not a
destination charge for the full amount.*

```
Buyer: view listing → contact seller → submit offer (amount, message, expiry)
Seller: accept | counter | decline    (counter creates a child offer)
Accept → order created, price LOCKED, payment deadline set (default 48h, configurable)
Buyer pays → webhook → paid → handover/inspection window → completed
```

Offer rules:
- Rate-limited per buyer per listing (anti-harassment, anti-spam).
- Offers expire automatically (scheduled job).
- Accepting one offer auto-declines competing offers on a single-quantity listing.
- An offer is single-use: `offers.order_id` is unique — an accepted offer can produce
  exactly one order.
- Accepting is an explicit, logged commitment. It is shown to the seller as such.

## Flow 3 — Fee-only / success fee  ✅ **CHOSEN for high-value categories**
*Business, Cars, Property, Machinery — decided in [DL-2](./12-decisions-log.md); mechanics in [04](./04-payments-architecture.md)*

Only the platform fee moves through Stripe. The principal settles directly between the
parties. The platform's role is discovery, verification, messaging and a fee — and the
UI must **say so plainly**, including what protection the buyer does and does not have.
Implemented as a PaymentIntent on the platform account with **no** `transfer_data`.

Configurable per category: who pays the fee (buyer, seller, split), when it is charged
(on offer acceptance, or on marking sold), and whether it is refundable.

## Flow 4 — Contact only
*Jobs, some Services, free/giveaway items*

No order, no payment object. Messaging plus optional lead tracking.
`[LEGAL REVIEW]` job advertising carries its own regulatory surface (recruitment,
discrimination, right-to-work claims) — confirm before launching the Jobs category.

## Cross-cutting

**Abandoned orders**: `pending_payment` orders expire on a scheduled job, releasing the
listing back to `active`. Stock is reserved only while the order is live.

**Double-payment protection**: one open `pending_payment` order per (buyer, listing);
deterministic Stripe idempotency keys; the `idempotency_keys` table for inbound POSTs.

**Buyer protection window**: configurable per category. During it, payout may be
delayed (never called "escrow" — see [04](./04-payments-architecture.md)) and the buyer
may open a dispute in-platform before going to their card issuer. Good in-platform
dispute resolution is the cheapest possible chargeback defence.

**Reviews unlock** only after `completed`, one per order per direction.
