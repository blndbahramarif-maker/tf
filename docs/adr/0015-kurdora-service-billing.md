# ADR-0015 — Kurdora service billing

**Status:** Accepted · 2026-09-13 · **Implemented, Stripe TEST MODE only**
**Builds on:** [ADR-0014](./0014-contact-only-marketplace.md)

## Context

ADR-0014 established what Kurdora is:

> Kurdora is a contact-only marketplace. The actual transaction for a listed
> item occurs directly between buyer and seller outside Kurdora. Kurdora does
> not collect, hold, escrow, transfer, or settle the item sale price.

That removed the revenue model with the payment model. This ADR adds one back,
of a different kind:

> Kurdora may charge sellers for Kurdora's own services, such as listing
> subscriptions or promotion.

The distinction is the whole point. A commission on somebody else's sale
requires Kurdora to be in the middle of that sale. A subscription for keeping a
listing visible does not: Kurdora provides the service, Kurdora is paid for it,
and the buyer is not involved.

## Decision

**Stripe Billing through Stripe-hosted Checkout**, on Kurdora's own account.

Not Stripe Connect. `src/domain/billing/billing-gateway.ts` has no connected
account, no destination, no application fee, no transfer and no payout — the
vocabulary of a marketplace payment is absent from the type, so a marketplace
payment cannot be expressed. The same is now true of the older
`payment-gateway.ts`: those fields were removed, not merely left unused.

### Price is data

`service_plans` holds the amount, currency, interval and Stripe Price id.
"£5/month" appears in a seeded row and nowhere in the code. An admin re-prices
without a deploy, and a subscription SNAPSHOTS what its seller agreed to, so a
re-price does not silently change an existing seller's bill.

### Only a verified webhook grants access

The platform may write exactly one status — `INCOMPLETE`, which grants nothing.
Everything else comes from `applyProviderSubscription`, which takes a
`ProviderSubscription` that only the Stripe adapter can produce from a real
object or a signature-verified event.

A database CHECK backs this up: a subscription cannot hold an access-granting
status without a provider subscription id. Even direct SQL cannot forge a paid
row.

### The access rule

| Status | Listing visible | Why |
|---|---|---|
| `TRIALING` | **Yes** | Stripe: "you can safely provision your product" |
| `ACTIVE` | **Yes** | In good standing |
| `PAST_DUE` | **Yes** | See below |
| `INCOMPLETE` | No | Checkout started, nothing paid |
| `INCOMPLETE_EXPIRED` | No | First payment never arrived; terminal |
| `PAUSED` | No | No invoices are being generated |
| `UNPAID` | No | Stripe: "Revoke access… payments were already attempted and retried" |
| `CANCELED` | No | Terminal |

**`PAST_DUE` keeps the listing up, and that is a judgement call.** Stripe
retries a failed payment for days and most past-due subscriptions recover.
Taking a listing down the moment a card expires — then restoring it three days
later with its position and its enquiries lost — punishes an administrative
slip far harder than the £5 at stake. Access continues while Stripe is still
trying, and stops when Stripe gives up.

**A lapse PAUSES the listing; it never removes it.** The seller's work, images
and history survive, and paying republishes. Removal is a moderation outcome,
and a seller whose card expired has not done anything wrong.

### Out-of-order events

Stripe does not guarantee ordering. Two protections, guarding different things:

- **Terminal** — a `CANCELED` subscription is never reopened, whatever arrives
  later. Stripe says canceled "can't be updated", and re-granting a paid
  service after a cancellation is the expensive direction.
- **Stale** — an event describing an older state than the one already applied
  is refused by timestamp.

Events also RE-READ the subscription from Stripe rather than trusting the
payload. For `invoice.*` the payload is an Invoice, which does not carry the
subscription's status at all, and Stripe's guidance is to provision on
`invoice.paid` *"and the subscription status is active"*.

## Two things verified against current documentation (2026-09-13)

Both would have been wrong from memory, and both fail silently:

1. **`current_period_end` is on the subscription ITEM, not the root.** Reading
   `subscription.current_period_end` yields `undefined` and records a paid
   subscription with no expiry.
2. **An invoice names its subscription at
   `parent.subscription_details.subscription`** for API versions from
   `2025-03-31.basil`. This integration is pinned to `2026-08-26.dahlia`, so
   the old top-level `invoice.subscription` is gone.

## Consequences

**Good.** Revenue without being in anyone's transaction. No connected accounts,
no payouts, no negative balances, no chargeback exposure on a seller's sale, and
no Stripe business-model approval on the critical path — Kurdora billing its own
customers for its own service is an ordinary SaaS subscription.

**Bad, and it must be said plainly.**

- **It is unproven.** Sellers can advertise free elsewhere. Charging for
  listings is a harder commercial problem than taking a cut of a sale that
  happens anyway.
- **It is OFF by default.** `listing.subscription_required` defaults to false,
  so nothing is charged and nothing goes dark until an admin decides. Turning
  it on takes every unpaid listing down; that is a decision with a date.
- **`PAST_DUE` grace means some listings run unpaid for days.** Deliberate, and
  it costs real money at scale.
- **The real Stripe API has never been called.** No credentials in this
  environment; no subscription has ever been created, and no webhook has ever
  been received from Stripe. `LIVE_MODE_PERMITTED` remains false.

## Not a legal opinion

This records an engineering decision. Charging for a service creates
obligations — consumer contract terms, cancellation and refund rights, VAT
treatment, and invoicing duties among them. None of that has been reviewed by a
lawyer, and nothing here should be read as saying the arrangement is free of
risk.
