# ADR-0007 — Stripe Connect: destination charges, plus fee-only for high value

**Status:** Superseded in part by [ADR-0013](./0013-phase-7-payment-architecture.md)
· 2026-09-11 · **Implementation deferred to Phase 7**

> **Re-verified 2026-09-12 at the Phase 7 gate, as this ADR required.** The
> charge-type and fee-only decisions below survived re-verification unchanged.
> The account-type guidance and the restricted-business assessment did NOT:
> legacy account types are now deprecated, Stripe advises platforms not to take
> loss liability, and cars and business sales are not on the UK restricted list.
> Read [ADR-0013](./0013-phase-7-payment-architecture.md) and
> [docs/15-phase-7-gate.md](../15-phase-7-gate.md) for the current position.
**Context docs:** `docs/04-payments-architecture.md`, `docs/12-decisions-log.md` (DL-1, DL-2)

> **No payment code exists yet.** This ADR records the design so Phase 7 starts
> from a decision rather than a blank page. Every Stripe behaviour cited was
> verified against official documentation on 2026-09-11 and **must be
> re-verified at the start of Phase 7.**

## Context

Kurdora Ltd is a UK private limited company (DL-1), so the Stripe platform
account is GB. Sellers will be in the UK and across the EEA.

Two findings forced the design:

1. **A 0.5% commission does not cover card processing.** Stripe UK charges
   1.5% + 20p domestic, 2.5% + 20p EEA, 3.15% + 20p international. On a £50,000
   destination charge the platform is debited the fee on the *full* amount:
   £250 commission against £750.20 in fees — a £500 loss per transaction.
2. **Dispute liability lands on the platform.** For destination charges, Stripe
   debits the platform balance for the full disputed amount. A single disputed
   £50,000 sale where the seller has already withdrawn leaves Kurdora carrying it.

## Decisions

**Everyday goods (Mobile, Electronics, Clothing, Furniture, Household):
destination charges.**

```
POST /v1/payment_intents
  amount, currency
  application_fee_amount = <commission>
  transfer_data[destination] = acct_...
  transfer_group = order_<id>
Idempotency-Key: order:<id>:pi:v1
```

`application_fee_amount` rather than `transfer_data[amount]`, because it creates
an explicit `ApplicationFee` object linked to the charge, giving first-class fee
reporting. Commission for these categories is seeded at 5–7%, not 0.5%.

**High value (Cars, Business, Property, Machinery): fee-only.** Only the
commission passes through Stripe — a PaymentIntent on the platform account with
**no `transfer_data`**. The purchase principal never enters Stripe or any
Kurdora bank account. A £50,000 sale yields £250 for ~£4 of fees, and the
maximum disputable amount is the fee rather than the principal.

**Omit `on_behalf_of`.** Cross-border payouts — the product that covers a UK
platform paying EEA sellers, fee-free for UK↔EEA — supports *"destination
charges without `on_behalf_of`"*. Kurdora is therefore the merchant of record.

**Seller accounts:** Stripe-hosted onboarding with requirement collection by
Stripe, under a **full** service agreement (recipient service agreements are
excluded from cross-border payouts). Kurdora stores only the account id,
capability flags and the requirements summary — never identity documents or
bank details.

**Refunds:** always explicit — `reverse_transfer=true`, and
`refund_application_fee` per policy. The default (seller keeps the money,
platform absorbs the refund) is never acceptable silently.

## Consequences

**Good.** Profitable at every order size. The £50,000 chargeback scenario is
eliminated for high-value categories. Fee-only is also a materially easier model
for Stripe to approve. A pure high-value seller needs no connected account at all.

**Bad, and it must be said in the UI.** Buyers get no payment protection on the
principal in fee-only categories, because Kurdora never holds it. Burying that
would be both a trust failure and a consumer-law risk. `[LEGAL REVIEW]`

## Open, blocking Phase 7

- **Stripe written approval of the business model has NOT been obtained.**
  High-value goods are a restricted category requiring additional due diligence;
  the sale of whole businesses is not an enumerated category at all. Tracked as
  R-3. **No claim of approval may be made until written confirmation exists.**
- **Accounts v2 vs v1 + controller properties.** Stripe directs new platforms to
  Accounts v2, but it is served under a *preview* API version and cannot manage
  payout settings. Decide at Phase 7 start against the docs of the day; default
  to v1 + controller properties unless v2 is GA.
