# ADR-0014 — Kurdora is a contact-only marketplace

**Status:** Accepted · 2026-09-13 · **Implemented**
**Supersedes:** ADR-0007 and ADR-0013 in their entirety for seller sales.
Both described how Kurdora would process a seller's transaction. It does not.

## Context

Phases 1–7 were built on the assumption that Kurdora processes payments for the
goods its sellers advertise: destination charges for everyday items, a fee-only
charge for Cars and Business. Phase 7 delivered that in Stripe test mode.

The owner has decided the business model is different, and narrower.

**Kurdora's job is to provide the website where sellers advertise and buyers
find them and make contact.** The transaction happens directly between buyer and
seller, outside Kurdora.

## Decision

Kurdora does **not**, for a seller's sale:

- collect the sale price
- hold buyer money
- provide escrow
- transfer money to sellers
- act as the payment intermediary
- create a payment contract between buyer and seller
- guarantee the transaction, the goods, or either party

Every category is `CONTACT_ONLY`. Stripe is not required for a buyer to
purchase from a seller — and is not involved at all.

**This is not a deferral.** Phase 7's payment surface was removed, not
disabled-pending-approval.

### What that means in code

| Decision | Where it is enforced |
|---|---|
| No category may take money for a seller's goods | `categories_no_online_payment_for_seller_goods` CHECK |
| No category may advertise a paying flow | `categories_contact_only_flow` CHECK |
| Defaults match the constraints | column defaults, so a category created without naming them is valid |
| No route can begin a sale payment | the routes are deleted, not gated |

Two database constraints rather than application checks alone, because a
category is a row an admin can edit (ADR-0010). The flow is pinned as well as
the payment flag: the flow is what the public UI reads to decide what to tell a
buyer, and the other flows said things like *"bought and paid for through the
platform"*. **A false claim about payment protection is a worse outcome than a
charge that cannot happen anyway.**

## Monetisation

Kurdora earns from **its own services**, which is a different thing from
processing someone else's sale: paid listings, featured or promoted listings,
business advertising, and seller subscriptions later.

If one of those is ever charged for, it is an ordinary charge on Kurdora's own
account — no connected account, no destination charge, no application fee, no
payout. **None of it is implemented.** Nothing charges anything today.

## What was retained, and why

`src/infra/stripe/` (config and the payment gateway) and
`src/domain/payments/payment-gateway.ts` are kept and **unused by any route**.
They are the provider boundary — the thing that stops the SDK leaking into
handlers — and they are the shape a Kurdora-service charge would use. Keeping a
tested boundary costs a file; rebuilding one costs a phase.

`LIVE_MODE_PERMITTED = false` remains enforced, and the safety contract in
`tests/api/stripe-safety.test.ts` still holds.

The order, payment, ledger, payout, refund and dispute TABLES are also retained,
empty and unwritten. Dropping them would be a large irreversible migration with
no functional benefit.

## Consequences

**Good.** The entire class of risk that came with holding other people's money
is gone: no escrow question, no payment-institution question, no chargeback
liability, no Stripe business-model approval on the critical path, no
connected-account negative balances. The product works with no payment provider
configured at all.

**Bad, and it must be said plainly.**

- **Buyers have no payment protection whatsoever**, because Kurdora never holds
  the money. A buyer who is defrauded has no recourse through the platform. The
  UI says so rather than implying otherwise.
- **Kurdora has no transaction data**, so it cannot see what sold, at what
  price, or whether a deal completed. Fraud signals that come from payment
  history do not exist here.
- **Revenue is unproven.** Paid and promoted listings must be sold to sellers
  who can advertise free elsewhere. That is a harder commercial problem than
  taking a percentage of a sale that happens anyway.
- **Safety carries more weight.** With no payment step to interrupt, screening,
  reporting and moderation are the only controls the platform has.

## Not a legal opinion

This ADR records an engineering and product decision. It is **not** advice that
the model is lawful, exempt from regulation, or free of obligations. A
marketplace that hosts listings still has duties — consumer law, content
liability, data protection, and platform-specific regimes among them. No
lawyer has reviewed this.
