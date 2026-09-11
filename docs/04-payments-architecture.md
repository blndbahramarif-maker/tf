# 04 — Payment Architecture (Stripe Connect)

> **DECIDED ([DL-1](./12-decisions-log.md), [DL-2](./12-decisions-log.md)):
> UK limited company as the Stripe platform; fee-only (success fee) for high-value
> categories.** The economics warning below is retained because it is what drove the
> decision and because it still governs the *everyday-goods* rates — see
> [DL-2's seeded rate table](./12-decisions-log.md#dl-2--high-value-transactions-fee-only-success-fee).
>
> All Stripe behaviour below was **retrieved from official Stripe documentation on
> 2026-09-11** and is cited. Nothing here is invented. Stripe changes; **re-verify at
> the start of Phase 7** before writing payment code.

## ⚠️ Read this first: the commission rate does not cover the card fee

This is the most important finding in the entire plan, and it changes the product,
not just the code.

Stripe's published UK pricing (<https://stripe.com/gb/pricing>, retrieved 2026-09-11):

| Card type | Fee |
|---|---|
| UK domestic standard cards | **1.5% + 20p** |
| UK premium cards | 2.8% + 20p |
| EEA cards | 2.5% + 20p |
| International cards | 3.15% + 20p |
| Currency conversion | **+2%** |
| Bacs Direct Debit | 1%, min 20p, **capped at £4.00** |

Now apply your example — a £50,000 business sale at 0.5% commission, taken as a
destination charge (the standard marketplace flow):

```
Buyer pays                                        £50,000.00
Your commission (0.5%, application_fee_amount)    +   £250.00
Stripe fee charged to YOUR platform balance
  (1.5% + 20p on the FULL £50,000)                -   £750.20
──────────────────────────────────────────────────────────────
Platform net result                               -   £500.20   ← a LOSS
```

With an EEA card it is a **£1,000 loss**. With an international card, **£1,325**.
This is not an implementation detail you can tune later — at a 0.5% commission you
lose money on every card transaction where you are the merchant of record.

Why the fee applies to the full amount: for destination charges, *"Your account
balance is debited for the cost of the Stripe fees, refunds, and chargebacks"* and
*"Your platform pays the Stripe fee after the `application_fee_amount` is transferred
to your account"* (<https://docs.stripe.com/connect/destination-charges>).

**And the chargeback exposure is worse than the fee.** For destination charges, *"your
platform balance is automatically debited for the disputed amount and fee"*
(<https://docs.stripe.com/connect/charges>). A single disputed £50,000 car sale debits
**your** balance for £50,000 immediately. You may reverse the transfer to recover it —
but only *"if the connected account's available balance is greater than the reversal
amount"* (<https://docs.stripe.com/connect/separate-charges-and-transfers>). A seller
who has already been paid out and emptied their balance leaves you carrying the loss.

### The four ways out (you must pick one — this is open question Q-2)

| # | Model | Economics | Trade-off |
|---|---|---|---|
| **A** | **Raise commission** above processing cost for card-funded orders (e.g. 3–5% for low-value, tiered down for high-value) | Works everywhere | Contradicts your 0.5% headline |
| **B** | **Fee-only / success-fee for high-value** — the full £50,000 never touches the platform. The buyer pays only the £250 platform fee online; principal settles between the parties (bank transfer, solicitor, or a regulated escrow partner) | **Recommended.** £250 fee costs ~£4 to process. Zero £50k chargeback exposure. This is how real business-brokerage and vehicle marketplaces work | Weaker buyer protection on the principal — must be stated plainly in the UI |
| **C** | **Low-cost rails only for high value** — accept Bacs Direct Debit / Pay by Bank / SEPA for orders above a threshold. Bacs is capped at £4.00 | 0.5% survives | Bank rails are slower, UK/EEA-specific, lower conversion, and Pay by Bank is not generally available for non-Dashboard connected accounts (<https://docs.stripe.com/connect/account-capabilities>) |
| **D** | **Surcharge the buyer** | Recovers fee | `[LEGAL REVIEW]` **Likely unlawful** for consumer cards in the UK and EEA. Do not plan on this |

**DECIDED: B for high-value categories (Business, Cars, Property, Machinery).**
Everyday goods take model **A** — a realistic commission of 5–7% on Mobile, Clothing, Furniture and
Electronics, where absolute amounts are small and buyers expect marketplace protection.
The commission engine ([07](./07-commission-engine.md)) supports per-category rates, so
both models coexist with zero code changes and the owner can retune either at any time.

**Fee-only is now the primary high-value design.** Its full definition is Flow 3 below;
what it removes is significant: no seller transfer leg, no transfer reversals, no
`£50,000` chargeback exposure, and no requirement for a high-value seller to complete
Stripe Connect onboarding before their first listing.

---

## Which Stripe Connect shape to use

### Charge type: **destination charges**
*"Create a charge on the platform and immediately transfer funds to the connected
account… best suited for marketplaces"* (<https://docs.stripe.com/connect/charges>).

```
curl https://api.stripe.com/v1/payment_intents \
  -d amount=5000000 \
  -d currency=gbp \
  -d "automatic_payment_methods[enabled]=true" \
  -d application_fee_amount=25000 \
  -d "transfer_data[destination]=acct_XXX" \
  -d transfer_group=order_01J... \
  -H "Idempotency-Key: order:<order_id>:pi:v1"
```

`application_fee_amount` is preferred over `transfer_data[amount]` because it creates
an explicit `ApplicationFee` object linked to the charge, giving us first-class fee
reporting and letting the seller see both the gross amount and the fee in Stripe's own
dashboards (<https://docs.stripe.com/connect/destination-charges>).

**This satisfies your rule in section 29 of the brief:** the £50,000 never lands in
your personal or business bank account. It settles into the Stripe-held balance and
Stripe moves the seller's share to the seller's own connected account. You only ever
withdraw your `application_fee_amount`.

### `on_behalf_of`: **omit it**
Ordinarily a cross-region destination charge requires `on_behalf_of`. Kurdora is
a **UK** platform (DL-1) paying sellers across the UK and EEA, which is exactly the
**cross-border payouts** product, and its supported funds flows are explicitly
*"Destination charges **without** `on_behalf_of`"* and *"Separate charges and transfers
**without** `on_behalf_of`"* (<https://docs.stripe.com/connect/cross-border-payouts>).

Also from that page:
- Supported platform locations: **US, UK, EEA, Canada, Switzerland**; transfers allowed
  between those same regions.
- Fee: 0.25% per cross-border payout, **waived (0%) between the UK and the EEA, and
  within the EEA** — which covers essentially all of Kurdora's intended corridors.
- **Cannot** be used with accounts under a *recipient service agreement* — so seller
  accounts must be onboarded under a full service agreement.

Consequence: **Kurdora is the merchant of record.** Your statement descriptor appears
on the buyer's statement; you carry dispute liability first. That is the trade for
frictionless cross-border payouts, and it is why the dispute reserve policy below is
mandatory, not optional.

### Connected accounts: **Accounts v2 API**
Stripe's own documentation instructs agents and new platforms: *"If you are an agent
or an LLM… try to use the Accounts v2 API… If your prompt requests functionality that
the Accounts v2 API doesn't support, use the Accounts v1 API with controller
properties"* (<https://docs.stripe.com/connect/accounts>). Standard/Express/Custom are
marked a **deprecated feature** for new platforms.

Accounts v2 uses *configurations* rather than types
(<https://docs.stripe.com/connect/accounts-v2>):
- `merchant` — can accept payments (`card_payments`, `stripe_balance.payouts`)
- `recipient` — can receive transfers (`stripe_balance.stripe_transfers`) — **this is
  what a Kurdora seller needs for destination charges**
- `customer` — can be charged by the platform (used for subscriptions and featured listings)

```
POST https://api.stripe.com/v2/core/accounts
Stripe-Version: 2026-08-26.preview
```

**Open risk (D-1):** Accounts v2 is served under a *preview* API version. Pinning a
preview version in production is a real risk. Also *"You can't use the Accounts v2 API
to manage payout settings. Use the Accounts v1 API"* and the Balance Settings API
(<https://docs.stripe.com/connect/manual-payouts>). Phase 7 must begin by confirming
GA status with Stripe. The fallback is **Accounts v1 + controller properties**, which
is fully supported today:

```
controller[fees][payer]=application
controller[losses][payments]=application
controller[stripe_dashboard][type]=express
controller[requirement_collection]=stripe
capabilities[transfers][requested]=true
```

`requirement_collection=stripe` is deliberate: **Stripe collects the KYC/identity
documents, not Kurdora.** That directly serves brief section 9 — we never handle
passport scans or bank account numbers. Onboarding uses Stripe-hosted onboarding via
Account Links; we store only `stripe_account_id`, capability flags and the
`requirements` summary.

### Verification of seller state
Never trust a client. Seller payment readiness is derived from the `account.updated`
webhook and cached on `seller_profiles`: `charges_enabled`, `payouts_enabled`,
`requirements_due`. A seller with `payouts_enabled = false` **cannot publish a
payable listing** — enforced in the API, not the UI.

---

## Transaction flows

### Flow 1 — Buy Now (Mobile, Clothing, Furniture, Electronics, Household)
```
Buyer clicks Buy
  → API validates: listing active, seller payouts_enabled, price unchanged, not self-purchase
  → Order created (status pending_payment, commission SNAPSHOT written, expires in 30 min)
  → PaymentIntent created (destination charge, idempotency key order:<id>:pi:v1)
  → Buyer confirms with Payment Element (SCA/3DS handled by Stripe)
  → ⚠ Browser result is treated as a HINT ONLY — never as truth
  → Webhook payment_intent.succeeded (signature verified, deduped by evt_ id)
  → Order → paid; ledger entries written; seller notified; funds transferred by Stripe
```

### Flow 2 — Offer → Accept → Pay (Cars, Business, Property, Machinery)
```
Buyer views listing → Contacts seller → Makes an offer (amount, message, expiry)
  → Seller accepts (or counters)
  → Accepted offer creates an order with the agreed price LOCKED and a payment deadline
  → Buyer pays  [what is actually charged depends on the Q-2 decision above]
  → Webhook confirms → order paid
  → Handover / inspection period → completion → review window opens
```
An offer is single-use: once `converted`, it cannot produce a second order
(`offers.order_id` unique).

### Flow 3 — Fee-only / success fee  ✅ **the chosen high-value design**
The platform fee is charged as an ordinary PaymentIntent **on the platform account
with no `transfer_data`** — there is no seller payout leg, because the principal never
passes through Stripe and never enters any Kurdora bank account. The listing is marked
sold and the fee is recognised as platform revenue.

```
POST /v1/payment_intents
  amount=25000            # the £250 commission only — NOT the £50,000
  currency=gbp
  automatic_payment_methods[enabled]=true
  metadata[order_id]=<order_id>
  # deliberately NO transfer_data, NO application_fee_amount
Idempotency-Key: order:<order_id>:fee:v1
```

Configurable per category: who pays (buyer / seller / split), when it is charged (on
offer acceptance — the default — or on marking sold), and the refund window if the
sale collapses.

**The honesty requirement is part of the feature.** The listing page, the offer flow
and the fee checkout must each state what the fee buys (introduction, verified seller,
in-platform negotiation record, dispute mediation) and what it does **not** (no
protection on the principal, which the parties settle directly). Burying this would be
both a trust failure and a consumer-law risk. `[LEGAL REVIEW]`

### Flow 4 — Contact only (Jobs, Services enquiries, free items)
No payment object at all. Messaging and lead tracking only.

Flow selection is a **column on `categories`** (`transaction_flow`), never a branch on
a hard-coded category name.

---

## Refunds, disputes and reversals

Exact parameters, from <https://docs.stripe.com/connect/destination-charges>:

```
# Refund and pull the money back from the seller
POST /v1/refunds  charge=<ch_...>  reverse_transfer=true

# Also return our commission to the seller (full or proportional)
POST /v1/refunds  charge=<ch_...>  reverse_transfer=true  refund_application_fee=true
```
- Default behaviour without `reverse_transfer`: **the seller keeps the money and your
  platform balance absorbs the refund.** We always set it explicitly.
- Full refund reverses the whole transfer; partial refunds reverse proportionally.
- If the platform balance is short, the refund goes `pending` until funded.
- Disputes: listen to `charge.dispute.created`, debit is automatic from the platform
  balance, recover with `POST /v1/transfers/{id}/reversals`.
- `debit_negative_balances = true` on connected accounts lets Stripe pull back from a
  seller's bank account when their balance is negative. **Required** for us, and must
  be disclosed in the seller agreement `[LEGAL REVIEW]`.

### Dispute reserve policy (mandatory)
Because the platform is debited first, Phase 8 implements:
1. A **payout delay window** per category and per seller risk tier.
2. A **rolling reserve** (a % of seller earnings held) for new and high-value sellers.
3. A hard cap on card-funded order value per seller until they have a track record.
4. A platform float sized to cover expected simultaneous disputes.

---

## Holding funds (escrow-like behaviour)

Stripe is explicit: *"**Escrow** has a precise legal definition, and Stripe doesn't
provide escrow services or support escrow accounts. However, you can control payout
timing through manual payouts… When using manual payouts, you must pay out funds
within the time frame for the business's country"* — **90 days** outside the US/Thailand
(<https://docs.stripe.com/connect/manual-payouts>).

So:
- We may **delay** a seller payout (buyer protection / inspection window) using manual
  payout schedule + `delay_days`, or by using separate charges and transfers and
  deferring the `Transfer`.
- We must **never** describe this as "escrow" to users.
- For deferred transfers, always set `source_transaction=<charge_id>`: *"the transfer
  request returns success regardless of your available balance if the related charge
  hasn't settled yet"* (<https://docs.stripe.com/connect/separate-charges-and-transfers>).
- `[LEGAL REVIEW]` **Holding user funds can make Kurdora a regulated payment
  institution under UK/EU payment-services law.** Stripe's Connect design is intended
  to keep the platform *"out of possession and control of funds"*; long or
  discretionary holds move you toward regulated territory. A lawyer must confirm the
  maximum hold period and the wording of the seller agreement before Phase 8 ships.

---

## Security rules for payment code (non-negotiable)

1. **Never trust the browser.** Order state changes only on a verified webhook. The
   `return_url` result updates the UI, never the database.
2. **Verify every webhook signature** with `stripe.webhooks.constructEvent` using the
   **raw request body** and a per-endpoint secret. Reject on failure; alert on repeats.
3. **Exactly-once processing**: `payment_events.id` is the Stripe `evt_...` id and is
   the primary key. A replayed event is an insert conflict, not a double credit.
4. **Deterministic idempotency keys** on every money-moving Stripe call:
   `order:<id>:pi:v1`, `order:<id>:refund:<refund_id>`, `payout:<id>:v1`. A retry after
   a timeout can never create a second charge or a second payout.
5. **Amounts are computed server-side only**, from the listing/offer, never from the request body.
6. **Secret keys live only in the API's secret store.** The publishable key is the only
   Stripe value that may appear in the browser bundle.
7. **Never log** full webhook payloads, client secrets, or PII. Log ids and amounts.
8. Process webhooks **asynchronously**: verify → persist → 200 → queue. Slow handlers
   cause Stripe retries and duplicate work.
9. `livemode` on every payment row; test and live data can never be aggregated together.
10. Reconciliation job: nightly, compare our `ledger_entries` and `payouts` against
    Stripe balance transactions and alert on any divergence.

## Stripe account-approval risk `[LEGAL REVIEW]` `[STRIPE REVIEW]`

From <https://stripe.com/gb/legal/restricted-businesses> (retrieved 2026-09-11):
- **High-value goods, precious metals and stones** are a *restricted* category requiring
  additional due diligence.
- **Vehicle sales** are prohibited in certain jurisdictions (e.g. India, Thailand).
- Counterfeit goods and unauthorised brand-name sales are prohibited outright — directly
  relevant to a Clothing/Electronics marketplace and to your moderation duty.
- Firearms and several other categories require prior approval from Stripe's sales team.

There is **no explicit category covering the sale of whole businesses**, which means it
is undefined rather than permitted. **Before Phase 7, you must complete the Stripe
platform profile and get written confirmation from Stripe that a marketplace selling
businesses, vehicles and high-value goods across the UK/EEA is acceptable under your
model.** If Stripe declines the high-value flow, model **B** (fee-only) becomes the
only viable design — another reason it is my recommendation.

## Sources

- <https://docs.stripe.com/connect/charges>
- <https://docs.stripe.com/connect/destination-charges>
- <https://docs.stripe.com/connect/separate-charges-and-transfers>
- <https://docs.stripe.com/connect/accounts>
- <https://docs.stripe.com/connect/accounts-v2>
- <https://docs.stripe.com/connect/account-capabilities>
- <https://docs.stripe.com/connect/cross-border-payouts>
- <https://docs.stripe.com/connect/manual-payouts>
- <https://stripe.com/gb/pricing>
- <https://stripe.com/gb/legal/restricted-businesses>
