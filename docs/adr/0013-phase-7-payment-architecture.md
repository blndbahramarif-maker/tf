# ADR-0013 — Phase 7 payment architecture, re-verified

**Status:** Accepted · 2026-09-12 · **Parts 1 and 2 implemented, TEST MODE only**
**Amended 2026-09-12** by the owner's decision on the controller configuration —
see [Amendment 1](#amendment-1--the-controller-configuration-2026-09-12), which
**supersedes Decision 4 for as long as the alternative remains preview-only**.
**Supersedes:** the open questions and the account-type guidance in
[ADR-0007](./0007-stripe-connect-shape.md). ADR-0007's charge-type and
fee-only decisions are **confirmed**; its account-type framing is **replaced**.
**Full working:** [docs/15-phase-7-gate.md](../15-phase-7-gate.md)

> Every Stripe behaviour cited was verified against official documentation on
> **2026-09-12**. ADR-0007 asked for exactly this re-verification at the start
> of Phase 7; four of its statements were out of date.

## Context

Phase 6 closed with an offer lifecycle that records agreement and moves no
money. Phase 7 attaches money to it. Before writing any payment code, the
architecture had to be decided against the documentation of the day rather
than against what this repository already believed.

## Decisions

**1. BUY_NOW uses destination charges on the platform account**, with
`application_fee_amount` (not `transfer_data[amount]`, which hides the gross
from the seller) and **`on_behalf_of` deliberately omitted** — cross-border
payouts supports only *"destination charges without `on_behalf_of`"*, and UK↔EEA
payouts are fee-free. Confirmed, not assumed.

**2. FEE_ONLY uses no Connect object at all.** A plain PaymentIntent on the
Kurdora account for Kurdora's own service fee. No connected account, no
transfer, no application fee, no payout. Kurdora is the merchant of record for
its own service and for nothing else. A pure high-value seller never needs a
connected account.

**3. Accounts v1 with controller properties, not Accounts v2.** Reversing
ADR-0007's lean toward v2. v2 is still served under `2026-08-26.preview` and
*"can't manage payout settings"*, which we need for risk-tiered payout delays.
Stripe's own fallback instruction is to use v1 with controller properties when
v2 does not support the functionality. Revisit when v2 is GA **and**
cross-border payouts is confirmed on it.

**4. Stripe takes responsibility for negative balances.** New, and it reverses
the implicit assumption in ADR-0007. Stripe now advises it directly: *"We
advise that new platforms have Stripe take responsibility… Only consider taking
responsibility as the platform if you're confident in your ability to manage
merchant risk."* A solo founder is not that platform.

> **SUPERSEDED in implementation by [Amendment 1](#amendment-1--the-controller-configuration-2026-09-12).**
> This decision stands as the preferred end state; it is **not** what Part 2
> built, because the combination it requires is preview-only. Read the
> amendment before acting on this paragraph.

Note precisely what this does **not** change: destination-charge disputes
still debit the **platform** balance first. Stripe-managed losses govern
recovery from the connected account, not who is debited at the outset.

**5. Stripe-hosted onboarding.** Embedded onboarding is better UX and is
deferred on effort, not merit. API onboarding is rejected outright: it would
put government IDs and bank details inside Kurdora.

**6. Only a signature-verified webhook may move money state forward.**
The `return_url` is a navigation, never a fact. `PaymentEvent`'s primary key
is Stripe's own `evt_` id, so a replay is a primary-key conflict; every effect
is additionally a guarded state transition, because Stripe can emit two Event
objects for one change.

**7. "FEE_ONLY never charges the sale price" becomes a database CHECK**, not a
code convention (ADR-0010): for `flow_type = 'FEE_ONLY'`,
`total_minor = commission_amount_minor AND seller_amount_minor = 0`, and no
payment on such an order may carry a destination account or application fee.

## Consequences

**Good.** Profitable at every order size at today's verified UK rates
(£50,000 car: −£500.20 as a destination charge, +£246.05 fee-only). Maximum
disputable amount on that sale falls from £50,020 to £270. Most of the schema
already exists from Phase 2, so Phase 7's migration work is eight small
additive changes. FEE_ONLY sits outside Stripe's "payment facilitation and
aggregation" restriction because Kurdora receives proceeds only for a service
it does provide — a materially easier case to put to Stripe.

**Bad, and it must be said plainly.**

- Buyers get no payment protection on the principal in fee-only categories,
  because Kurdora never holds it. `[LEGAL REVIEW]`
- **Nothing structurally compels the fee-only payment to happen.** After an
  accepted offer the parties are already in contact and, for a car, must meet
  anyway. The entire Cars and Business revenue model rests on a payment the
  parties can decline to make. This needs a commercial decision before code.
- Application fees from EEA sellers settle in EUR, not GBP.
- For cross-border destination charges we may be unable to repay a connected
  account after winning a dispute, so transfers must not be reversed until a
  dispute is actually lost.

## Open, still blocking go-live

- **Stripe written approval does NOT exist (R-3, B-1).** Cars and business
  sales are **not** on the UK prohibited or restricted lists — which ADR-0007
  assumed they were — so this is a review rather than an appeal. It is still a
  **hard go-live blocker** and no claim of approval may be made without written
  confirmation.
- ~~Express Dashboard combined with Stripe-managed losses is in public
  preview.~~ **Decided — see [Amendment 1](#amendment-1--the-controller-configuration-2026-09-12).**
- Legal review of the fee-only consumer proposition.

---

## Amendment 1 — the controller configuration (2026-09-12)

**Status:** Accepted by the owner. **Supersedes Decision 4 in implementation.**

### What was decided

Kurdora keeps the **GA-supported controller configuration** that Phase 7 Part 2
implemented:

```
controller[stripe_dashboard][type]  = express
controller[fees][payer]             = application
controller[losses][payments]        = application   ← the deviation
controller[requirement_collection]  = stripe
```

Explicitly **not** adopted:

- `controller[losses][payments] = stripe` (Stripe-managed losses)
- the Express Dashboard **public preview** that combination requires
- Stripe API version `2026-08-26.preview`

The integration stays pinned to GA `2026-08-26.dahlia`.

### Why

Decision 4 above chose Stripe-managed losses on Stripe's own advice, and that
advice has not changed — it remains the preferred end state. But combining it
with the Express Dashboard is documented as **public preview** and requires the
preview API version. Adopting a preview API version for the code path that
takes money trades a known, bounded commercial exposure for an unknown
stability risk on the most consequential surface in the product. That is the
wrong trade for a platform with no live sellers.

`stripe_dashboard.type` is **immutable per account**. This is therefore not a
detail that can be revisited casually: changing course means creating every
connected account again.

### What it means commercially

**Kurdora absorbs a negative balance on a connected account**, rather than
Stripe absorbing it. This is a real, accepted exposure, not a technicality.

It is bounded by two things already in the architecture: FEE_ONLY never routes
the sale principal through Stripe at all (Decision 2 and 7), and destination
charges keep the maximum disputable amount at the fee rather than the sale
price. The exposure is on BUY_NOW orders, which are the low-value categories.

### Operational consequences

- **No production account migration or recreation is to be performed.** There
  are no production connected accounts, and none are to be created while
  `LIVE_MODE_PERMITTED = false`.
- The configuration lives in `CONNECT_CONTROLLER`
  (`src/domain/payments/connect-gateway.ts`) and is **pinned by a test** in
  `tests/domain/onboarding.test.ts`, so it cannot drift without a reviewer
  seeing it.

### When to revisit

Only when **all** of the following hold:

1. Express Dashboard with `losses.payments = stripe` is **GA**, not preview,
   on a GA API version.
2. The commercial case for moving the loss exposure to Stripe has been
   reviewed against actual dispute volume.
3. Legal review has covered it.

Until then this amendment is the approved architecture. Do not switch on the
strength of Decision 4's wording alone.
