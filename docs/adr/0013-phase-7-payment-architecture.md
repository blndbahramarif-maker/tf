# ADR-0013 — Phase 7 payment architecture, re-verified

**Status:** Accepted · 2026-09-12 · **Implementation NOT started**
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
- Express Dashboard combined with Stripe-managed losses is in public preview.
  The dashboard type is **immutable per account**, so this must be decided
  before the first account is created.
- Legal review of the fee-only consumer proposition.
