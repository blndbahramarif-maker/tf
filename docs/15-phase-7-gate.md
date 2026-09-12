# 15 — Phase 7 gate: Stripe Connect payment architecture

**Status:** GATE REPORT · verified **2026-09-12** · **NO implementation has started**
**Supersedes the open questions in** [ADR-0007](./adr/0007-stripe-connect-shape.md)

> Every Stripe behaviour in this document was re-verified against official
> documentation on **2026-09-12**, as CLAUDE.md requires. Nothing here is from
> memory and nothing is carried forward from ADR-0007 without re-checking.
> Four of ADR-0007's statements turned out to be out of date; they are marked
> **CHANGED** below.

---

## 1. Documentation consulted (all fetched 2026-09-12)

| Page | What it settled |
|---|---|
| `docs.stripe.com/connect/charges` | Charge-type comparison; dispute and fee liability per type |
| `docs.stripe.com/connect/destination-charges` (Elements variant) | `application_fee_amount` vs `transfer_data[amount]`; refund and dispute defaults |
| `docs.stripe.com/connect/accounts-v2` | Accounts v2 status, configurations, limitations |
| `docs.stripe.com/connect/accounts` | Legacy account types — now marked **Deprecated** |
| `docs.stripe.com/connect/design-an-integration` | Onboarding options; negative-balance liability choice |
| `docs.stripe.com/connect/interactive-platform-guide` | What Stripe tells a *new* platform to do |
| `docs.stripe.com/connect/cross-border-payouts` | UK→EEA payout eligibility, supported funds flows, pricing |
| `docs.stripe.com/connect/risk-management/best-practices` | Stripe's advice on loss liability; rejection reasons |
| `docs.stripe.com/webhooks` | Signature scheme, ordering, duplicates, retries |
| `docs.stripe.com/api/idempotent_requests` | Idempotency-key semantics and **retention** |
| `stripe.com/gb/legal/restricted-businesses` | UK-applicable prohibited/restricted categories |
| `stripe.com/gb/pricing` | Current UK card rates and dispute fee |

## 2. What changed since ADR-0007 (2026-09-11 → 2026-09-12)

**CHANGED 1 — Legacy account types are deprecated.** `connect/accounts` now
carries a "Deprecated feature" banner: *"The information on this page applies
only to platforms that already use legacy connected account types (Standard,
Express, or Custom accounts)."* Choosing "Express accounts" is no longer the
right frame for a new platform.

**CHANGED 2 — Accounts v2 is still NOT generally available.** Its examples
require `Stripe-Version: 2026-08-26.preview`. Stripe nonetheless directs new
platforms to it. It also states plainly: *"You can't use the Accounts v2 API to
manage payout settings. Use the Accounts v1 API."* ADR-0007 guessed this
correctly; it is confirmed, not resolved.

**CHANGED 3 — Stripe now advises platforms NOT to take loss liability.**
*"We advise that new platforms have Stripe take responsibility for negative
balances on connected accounts. Only consider taking responsibility as the
platform if you're confident in your ability to manage merchant risk."* A solo
founder with no risk-operations team is not that platform.

**CHANGED 4 — Cars and business sales are NOT on the UK restricted list.**
ADR-0007 and R-3 assumed high-value goods and vehicles were restricted
categories. On the UK page, vehicle restrictions are **India and Thailand
only**, and high-value goods are **India, Thailand and UAE only**. Neither
appears in the UK-applicable lists, and there is no category for classifieds
or marketplaces at all. This materially reduces R-3 — **but it is not
approval**, see §4.

## 3. Stripe business-model status

**NOT APPROVED. No written confirmation exists. This is a HARD GO-LIVE BLOCKER.**

Nothing found on 2026-09-12 changes that. What changed is only the *expected
difficulty*: the categories Kurdora sells in are not prohibited in the UK, so
the platform-profile review is a review rather than an appeal against a listed
restriction.

The one rule that genuinely bites is under **Restricted Businesses →
Third-party Agents**:

> "Payment facilitation and aggregation (including receiving settlement
> proceeds for goods or services that **you did not provide**, on behalf of one
> or multiple third-party sellers)"

and under **Prohibited Uses of Stripe Products**:

> "Use of Stripe products to facilitate transactions on behalf of another
> **undisclosed** merchant"

Read against the two Kurdora flows:

- **BUY_NOW** *is* aggregation on its face — Kurdora receives proceeds for
  goods it did not provide. Connect is Stripe's sanctioned mechanism for
  exactly this, and the sellers are **disclosed** (each has a KYC'd connected
  account). Permitted *via Connect*, subject to platform-profile review. This
  is what the platform profile exists to assess.
- **FEE_ONLY** falls **outside** that definition: Kurdora receives settlement
  proceeds only for a service it *does* provide — the introduction and the
  marketplace facility. It never receives proceeds for the car or the business.
  On Stripe's own wording this is the cleaner of the two models, and it is the
  argument to put in the platform profile in writing.

**Nothing in this report may be read as Stripe having approved anything.**

## 4. Charge-type decision

### Recommended: **destination charges** for BUY_NOW, **no Connect object at all** for FEE_ONLY.

### Rejected — direct charges

Stripe's own framing: direct charges are for platforms whose *"connected
accounts transact directly with their customers, who are often unaware of your
platform's existence"* — a SaaS shape, not a marketplace. Rejected because:

1. **The wrong merchant of record.** Buyers transact with Kurdora, see Kurdora,
   and would hold Kurdora responsible. Direct charges put the seller's
   statement descriptor on the buyer's card statement.
2. **Pricing control is lost.** *"Using direct charges on legacy Express or
   Custom accounts charges connected accounts directly at standard sticker
   rates rather than billing the platform. For pricing control, use destination
   charges instead."*
3. **The onboarding bar is far too high for the seller we have.** Direct charges
   require the `card_payments` capability — full merchant onboarding for
   somebody selling one used phone.
4. **Not a listed cross-border funds flow.** Cross-border payouts lists
   destination charges, separate charges and transfers, and top-ups —
   not direct charges.

**What we give up by rejecting it:** with direct charges, *"Stripe debits the
disputed amount from the connected account's balance, not your platform's
balance."* That is real money we are choosing to carry instead. It is the
deliberate price of being the marketplace of record, and §7 mitigates it.

### Rejected — separate charges and transfers

Stripe: *"Separate charges and transfers require a more complex Connect
integration. Use them only if your business use case requires them."* The
listed reasons are one-to-many, many-to-one, charge-before-seller-known, and
transfer-before-payment. **Kurdora is strictly one buyer ↔ one seller.** None
apply.

The tempting reason to pick it anyway is holding funds until delivery
(escrow-shaped buyer protection). **Rejected deliberately:** Stripe does not
provide escrow, and holding buyer funds is precisely what risks making Kurdora
a regulated payment institution (R-4 `[LEGAL]`).

**Migration path, if it is ever needed:** a multi-seller basket, or split
payments to a seller plus a delivery partner. It is additive — the same
PaymentIntent on the platform account, with the transfer decoupled — so
choosing destination charges now does not close the door.

### Chosen — destination charges (BUY_NOW)

Matches Stripe's stated use case: *"Customers transact with your platform for
products or services provided by your connected accounts. Each transaction
involves a single connected account and a single customer."*

```
POST /v1/payment_intents
  amount                      = order.totalMinor
  currency                    = order.currency
  application_fee_amount      = order.commissionAmountMinor
  transfer_data[destination]  = acct_...
  transfer_group              = "order_<order.id>"
  automatic_payment_methods[enabled] = true
  # on_behalf_of DELIBERATELY OMITTED — see below
Idempotency-Key: order:<order.id>:pi:v1
```

**`application_fee_amount`, not `transfer_data[amount]`.** It creates an
explicit `ApplicationFee` object linked to the charge, giving first-class fee
reporting and letting the seller see both the gross and the fee in their
dashboard. With `transfer_data[amount]` the connected account *"can't view the
total amount of the charge."* Hiding the gross from the seller is not a
relationship we want.

**One cost of that choice, and it is a real one:** for cross-border destination
charges without `on_behalf_of`, *"The application fee settles in the same
currency as the connected account's settlement currency… this might differ from
your platform's settlement currency."* A UK platform taking a fee from an EEA
seller can therefore hold EUR. **Open question OQ-3.**

**`on_behalf_of` must be omitted**, and this is now confirmed rather than
assumed. Cross-border payouts supports only: *separate charges and transfers
without `on_behalf_of`*, *top-ups and transfers*, and *destination charges
without `on_behalf_of`*. Omitting it makes Kurdora the business of record —
which is what we want anyway.

### Chosen — FEE_ONLY: a plain platform charge, no Connect

This is the central architectural answer of this gate, so it is stated flatly:

**The FEE_ONLY flow uses no Connect object whatsoever.** No connected account,
no `transfer_data`, no `application_fee_amount`, no transfer, no payout. It is
an ordinary PaymentIntent on the Kurdora platform account for Kurdora's own
service.

```
POST /v1/payment_intents
  amount   = order.commissionAmountMinor      # the FEE. Never the car.
  currency = order.currency
  automatic_payment_methods[enabled] = true
  statement_descriptor_suffix        = "MARKETPLACE FEE"
  metadata[kurdora_order_id]         = <order.id>
  metadata[kurdora_flow]             = "FEE_ONLY"
Idempotency-Key: order:<order.id>:pi:v1
```

Answering the gate's specific questions:

| Question | Answer |
|---|---|
| Who pays Stripe? | Kurdora, out of its own revenue. Kurdora is the merchant. |
| Who receives the fee? | Kurdora's own Stripe balance. |
| Is a connected account required? | **No.** A pure high-value seller never needs one. |
| What does Stripe consider Kurdora's responsibility? | All of it. It is Kurdora's own sale of its own service — refunds, disputes and customer support are Kurdora's. |
| Refunds | From Kurdora's own balance. No `reverse_transfer` (there is no transfer). |
| Disputes | Against Kurdora. Maximum exposure = the fee + the £20 dispute fee. |
| Acceptable for Cars and Business? | Not prohibited or restricted in the UK, and it sits outside the "aggregation" definition. **Still requires platform-profile approval.** |

### The economics, recomputed against today's UK rates

UK rates verified 2026-09-12: **1.5% + 20p** standard UK cards, **2.8% + 20p**
premium UK cards, **2.5% + 20p** EEA, **3.15% + 20p** international, **+2%** on
currency conversion, **£20** per dispute.

| Scenario | Commission | Stripe cost | Net |
|---|---|---|---|
| £50,000 car as a **destination charge** at 0.5% | £250.00 | £750.20 (1.5%+20p on the full £50k) | **−£500.20** |
| £50,000 car as **FEE_ONLY** at 0.5% | £250.00 | £3.95 (1.5%+20p on £250) | **+£246.05** |
| £200 phone, destination charge at 6% | £12.00 | £3.20 | **+£8.80** |
| £20 accessory, destination charge at 6% | £1.20 | £0.50 | **+£0.70** |

ADR-0007's core economic finding survives re-verification exactly. It also
shows the £20 order is barely worth processing — **OQ-4**.

Maximum disputable amount, £50,000 car: **£50,020 under destination charges,
£270 under FEE_ONLY.** That, not the margin, is the real reason for the split.

## 5. Connected accounts and onboarding

### Recommendation for the UK launch

| Decision | Choice | Why |
|---|---|---|
| API | **Accounts v1 with controller properties** | Accounts v2 still needs `2026-08-26.preview` and *"can't manage payout settings"*, which Kurdora needs for risk-tiered payout delays. Stripe's own fallback instruction: *"If your prompt requests functionality that the Accounts v2 API doesn't support, use the Accounts v1 API with controller properties."* Revisit when v2 is GA **and** cross-border payouts is confirmed on it. |
| Losses | **Stripe responsible for negative balances** | *"We advise that new platforms have Stripe take responsibility."* A solo founder cannot staff risk monitoring, screening and remediation. |
| Fees | **Platform pays Stripe fees** | Required by destination charges anyway, and it is what keeps commission pricing ours. |
| Onboarding | **Stripe-hosted onboarding** | Lowest effort, 46+ countries and 14 languages maintained by Stripe, and requirements change without us shipping. |
| Dashboard | **Express Dashboard**, if the preview constraint is acceptable; otherwise full Stripe Dashboard | ⚠️ *"Combining Express Dashboard access with Stripe responsibility for negative balances is in public preview."* **OQ-1.** |
| Service agreement | **Full** | Recipient agreements are excluded from cross-border payouts and cannot hold `card_payments`. |

**Embedded onboarding is rejected for launch, not on merit.** It is genuinely
better UX and Stripe recommends it over API onboarding. It is deferred because
hosted onboarding is a redirect and a return URL, while embedded is a component
to theme, host and keep working. Revisit in a later phase. **API onboarding is
rejected outright** — it would make Kurdora handle government IDs and bank
details, which ADR-0007 and the security architecture both forbid.

### What Kurdora stores locally — and what it must never store

**Stores:** `stripeAccountId`, `chargesEnabled`, `payoutsEnabled`,
`requirementsDue` (the summary only), `payoutDelayDays`. All already on
`SellerProfile`.

**Never stores:** identity documents, document images, dates of birth,
government ID numbers, bank account numbers, or anything in a
`requirements.*.document` field. Those live at Stripe. A `[LEGAL]`/security
line that does not move.

### What must never be trusted from the browser

- `stripeAccountId` — **always** read from the seller profile row that the
  session's user owns, never from a request field.
- `chargesEnabled` / `payoutsEnabled` — mirrored from `account.updated` only.
  A seller who edits a form field claiming to be verified changes nothing.
- Onboarding completion — the return URL from Stripe-hosted onboarding is a
  navigation, **not** a fact. Re-fetch the account.
- The amount, the currency, the commission, the seller — all server-derived.

### Seller eligibility before accepting a BUY_NOW order

All of the following, re-read from the database at order creation:

1. `sellerProfile.stripeAccountId` is set;
2. `chargesEnabled === true` **and** `payoutsEnabled === true`;
3. `requirementsDue.currently_due` is empty;
4. the account is not rejected (`requirements.disabled_reason` is null);
5. `verificationStatus` satisfies the category's `requiresVerifiedSeller`.

A seller failing any of these may still list; the listing simply cannot be
bought until they finish. **FEE_ONLY listings require none of this** — there
is no connected account in that flow, which is exactly why a high-value seller
can transact on day one.

## 6. Database design — **design only, no migration**

### The important finding: most of it already exists

Phase 2's initial migration already shipped `Order`, `OrderItem`, `OrderEvent`,
`Payment`, `PaymentEvent`, `Refund`, `Dispute`, `Payout`, `LedgerEntry`,
`CommissionRule`, `IdempotencyKey`, `OutboxEvent`, and the Stripe fields on
`SellerProfile`. They already satisfy the gate's requirements:

- **BIGINT minor units** everywhere, explicit `CHAR(3)` currency;
- **immutable monetary snapshots** — `Order` carries `commissionRuleId`,
  `commissionPercentBps`, `commissionFixedMinor`, `commissionAmountMinor`,
  `sellerAmountMinor`, plus `fxRateToBase`/`baseCurrency` and buyer/listing
  snapshots;
- **Stripe IDs unique** — `Payment.providerPaymentIntentId`,
  `providerChargeId`, `Payout.providerPayoutId`, `providerTransferId`,
  `Dispute.providerDisputeId`, `SellerProfile.stripeAccountId`;
- **idempotency** — `Payment.idempotencyKey` unique, plus the inbound
  `IdempotencyKey` table with a request-body hash and an in-flight lock;
- **append-only financial events** — `LedgerEntry` with a deferrable zero-sum
  constraint trigger and no-update/no-delete triggers;
- **`PaymentEvent`'s primary key is Stripe's own `evt_...` id**, which makes a
  replayed webhook a primary-key conflict rather than a double credit.

Phase 7's database work is therefore **small and additive**. Proposed:

| # | Change | Why |
|---|---|---|
| D1 | `SellerProfile`: add `onboardingStatus` enum, `detailsSubmitted`, `disabledReason`, `capabilitiesSnapshot Json`, `stripeAccountCountry`, `serviceAgreementType`, `accountsApiVersion`, `onboardingStartedAt`, `onboardingCompletedAt` | There is currently no onboarding state machine, only three mirrored booleans. `disabledReason` is what distinguishes "not finished" from `rejected.terms_of_service`. |
| D2 | New `PaymentAttempt` table, keyed on the Stripe **charge** id, child of `Payment` | A PaymentIntent can produce several charges. Stripe: *"refunds should be issued against the most recent charge that is created."* Today `Payment.providerChargeId` can hold only one, so a retried payment loses its history. |
| D3 | `Order`: add `principalMinor BigInt?` — the agreed off-platform price for FEE_ONLY | The commission basis must be recorded, but the principal is **never charged**. Recording it in `totalMinor` would be a lie that a reconciliation job would later believe. |
| D4 | CHECK: for `flow_type = 'FEE_ONLY'`, `total_minor = commission_amount_minor AND seller_amount_minor = 0` | **The single most important new constraint in Phase 7.** It makes "FEE_ONLY never charges the sale price" a database invariant, not a code convention (ADR-0010). A bug that tried to charge £50,000 through the fee-only flow would be refused by Postgres. |
| D5 | CHECK: `application_fee_amount_minor IS NULL` when the payment belongs to a FEE_ONLY order, and `destination_account_id IS NULL` likewise | Same reasoning: no transfer leg can exist on a fee-only payment, ever. |
| D6 | Partial unique index on `payments (order_id) WHERE status <> 'FAILED' AND status <> 'CANCELED'` | One live payment attempt per order. Duplicate-payment protection in the database, not only in the route. |
| D7 | `PaymentEvent`: add `(type, related_object_id)` index and a documented **semantic** dedup rule | Stripe: *"In some cases, two separate Event objects are generated and sent. To identify these duplicates, use the ID of the object in `data.object` along with the `event.type`."* Event-id dedup alone is **not** sufficient. |
| D8 | New `StripeReconciliation` table: date, expected vs actual balance per currency, status | Nightly reconciliation needs somewhere to record a disagreement, before anyone notices it in a bank statement. |

Every one ships with a `down.sql` and a `tests/db/constraints.test.ts` case
that writes something impossible and asserts Postgres refuses it.

### Ledger compatibility

`src/domain/ledger/postings.ts` already carries `orderPaid`, **`feeOnlyPaid`**,
`recordPaymentFee`, `payoutSettled` and `refundIssued`, each with a test
proving it balances. Phase 7 adds `disputeOpened`, `disputeWon`, `disputeLost`
and `transferReversed`. No ad-hoc entries, ever.

**No money movement without an auditable record** is enforced by three
independent mechanisms, which is the point: the append-only `LedgerEntry`
triggers, the `PaymentEvent` row that must exist before anything is acted on,
and `OrderEvent` for the state machine.

## 7. State machines — design only

All five follow the Phase 6 pattern: a **transition table as data**, with the
actor named on the row, never an `if`. The overriding rule:

> **Only a signature-verified webhook may move money state forward.** Not the
> browser, not the `return_url`, not a Server Action. Stripe's own words:
> *"Listen for these events rather than waiting on a callback from the client.
> On the client, the customer could close the browser window… and malicious
> clients could manipulate the response."*

### Order

| From | To | Actor | Authorization | Audit | Stripe dependency |
|---|---|---|---|---|---|
| — | DRAFT | buyer | `order:create`, owns the accepted offer | OrderEvent | none |
| DRAFT | PENDING_PAYMENT | buyer | owns the order | OrderEvent | PaymentIntent created |
| PENDING_PAYMENT | PAID | **system (webhook)** | signature verified | OrderEvent + ledger `orderPaid`/`feeOnlyPaid` | `payment_intent.succeeded` |
| PENDING_PAYMENT | EXPIRED | system | timer | OrderEvent | `payment_intent.canceled` |
| PENDING_PAYMENT | CANCELLED | buyer or seller | party to the order | OrderEvent | PaymentIntent cancelled |
| PAID | FULFILLING | seller | owns the listing | OrderEvent | none |
| FULFILLING | COMPLETED | buyer, or system after the window | party to the order | OrderEvent | none |
| PAID / FULFILLING / COMPLETED | REFUNDING | seller or admin | `order:refund`, **step-up** | OrderEvent | Refund created |
| REFUNDING | REFUNDED | **system (webhook)** | signature verified | OrderEvent + ledger `refundIssued` | `charge.refunded` |
| PAID / FULFILLING / COMPLETED | DISPUTED | **system (webhook)** | signature verified | OrderEvent | `charge.dispute.created` |
| DISPUTED | CHARGEBACK | **system (webhook)** | signature verified | OrderEvent + ledger `disputeLost` | `charge.dispute.closed` lost |
| DISPUTED | PAID | **system (webhook)** | signature verified | OrderEvent + ledger `disputeWon` | `charge.dispute.closed` won |

`COMPLETED`, `CANCELLED`, `EXPIRED`, `REFUNDED` and `CHARGEBACK` are terminal.
No actor may move an order to `PAID` directly.

### Payment

Created by Kurdora in `REQUIRES_PAYMENT_METHOD`. **Every subsequent transition
comes from a webhook**: `REQUIRES_ACTION` (`payment_intent.requires_action`),
`PROCESSING` (`payment_intent.processing`), `SUCCEEDED`
(`payment_intent.succeeded`), `FAILED` (`payment_intent.payment_failed`),
`CANCELED` (`payment_intent.canceled`). `SUCCEEDED` is terminal and a
`SUCCEEDED → anything` transition is not in the table.

### Refund

`PENDING` → `SUCCEEDED` (`charge.refunded` / `refund.updated`), `FAILED`
(`refund.failed` — the amount *"returns to your platform account's Stripe
balance"*, so a compensating `Transfer` is needed), `CANCELED`. Creation
requires `order:refund` **and step-up**, and is guarded by a deterministic
idempotency key.

### Payout

`PENDING` → `IN_TRANSIT` (`payout.created`) → `PAID` (`payout.paid`) /
`FAILED` (`payout.failed`) / `REVERSED` (`payout.reversed`). At launch payouts
are **automatic on Stripe's schedule**; Kurdora only records them. No route
creates a payout. That removes an entire class of unauthorized-payout attack
by not building the surface.

### Connected-account onboarding

`NOT_STARTED` → `ONBOARDING_STARTED` (Kurdora creates an AccountLink) →
`PENDING_VERIFICATION` (`account.updated`, `details_submitted=true`) →
`ACTIVE` (`charges_enabled && payouts_enabled`) / `RESTRICTED`
(`currently_due` non-empty) / `REJECTED` (`disabled_reason` starts `rejected.`)
/ `DISABLED`. **Every transition after the first comes from `account.updated`.**
`ACTIVE ⇄ RESTRICTED` is bidirectional — Stripe adds requirements over time,
and an account can lose eligibility mid-life.

## 8. Webhook architecture — design only

### Verification

1. **Raw body.** *"Stripe requires the raw body of the request to perform
   signature verification… Any manipulation to the raw body of the request
   causes the verification to fail."* In Next.js this means reading
   `await request.text()` and **never** `request.json()` before verifying.
   A repo-level test must assert the route does not parse first.
2. **`Stripe-Signature`**, HMAC-SHA256 over `<timestamp>.<raw body>`, scheme
   `v1` only — *"To prevent downgrade attacks, ignore all schemes that aren't
   `v1`."*
3. **Tolerance 5 minutes** (the library default). *"Don't use a tolerance value
   of `0`. Using a tolerance value of `0` disables the recency check entirely."*
4. **IP allowlist in addition to the signature**, from `docs.stripe.com/ips`.
   Stripe says to use *both*.
5. **Constant-time comparison.**
6. The route is **exempt from CSRF** and from `requireAccess` — it is
   authenticated by the signature, not by a session. It carries no cookie and
   must reject anything that arrives with one being treated as authority.
   This is the one deliberate exception to non-negotiable 18, and it needs an
   ADR line saying so.

### Idempotency and ordering

- **Transport dedup:** insert `PaymentEvent` with `id = evt_...` **before**
  processing. A duplicate is a primary-key conflict → return `200`, do nothing.
- **Semantic dedup:** Stripe warns that *"two separate Event objects are
  generated and sent"* in some cases. So dedup also on
  `(type, data.object.id)`, and — most importantly — make every effect a
  **guarded state transition** (`UPDATE … WHERE status = <expected>`), the same
  pattern Phase 6's offer machine already uses. A second delivery matches zero
  rows and is a no-op.
- **Out-of-order is expected, not exceptional.** *"Stripe doesn't guarantee the
  delivery of events in the order that they're generated… Don't use `created`
  to determine event order or whether you've already processed an event."*
  Therefore: a `charge.refunded` arriving before `payment_intent.succeeded`
  must park, not fail. Events whose precondition is unmet are left `PENDING`
  with an incremented `attempts` and retried by the worker — **never** dropped
  and never forced through.
- **Stripe's idempotency keys are pruned after 24 hours** — *"You can remove
  keys from the system automatically after they're at least 24 hours old."*
  So `Payment.idempotencyKey` and the unique index on it, not Stripe, are the
  authority on "have we already created this PaymentIntent". A retry 25 hours
  later must be stopped by **our** database.

### Transaction boundaries

```
verify signature
  → INSERT PaymentEvent (PK = evt_id)          ← its own transaction, commits first
  → return 200 immediately                      ← before any business logic
  → worker picks it up:
        BEGIN
          guarded UPDATE of the aggregate
          OrderEvent
          balanced LedgerEntry group
          OutboxEvent
          PaymentEvent → PROCESSED
        COMMIT
```

Recording and acting are separated deliberately. Stripe requires a fast `2xx`:
*"You must quickly return a successful status code (2xx) before any complex
logic that could cause a timeout."* And the `OutboxEvent` is written in the
**same transaction** as the state change, so an order can never be marked paid
with no notification sent, or a notification sent for a rollback.

### Retries, failures and reconciliation

- Stripe retries *"for up to three days with an exponential back off in live
  mode."* Our own worker retries a `PENDING` event with its own backoff and a
  cap, then marks it `FAILED` and alerts. A `FAILED` event is a human's
  problem, not a silent loss.
- **Never return a non-2xx to make Stripe retry business-logic failures.**
  Record it and retry internally.
- **Nightly reconciliation** (D8): list Stripe balance transactions for the
  day, compare against the ledger, and record any disagreement. Webhooks can
  be missed; a payment that exists at Stripe and not in our database must be
  found by a sweep, not by a customer complaining.
- **Scopes:** one destination for `@self` (platform charges, destination
  charges, transfers, payouts, disputes) and one for `@accounts`
  (`account.updated`, capability changes). Both signed with different secrets.

### The rule this whole section exists to enforce

**The `return_url` is never the source of truth.** The success page reads the
*local order*, and if no webhook has arrived it says "payment processing",
not "paid". An E2E test must assert that hitting the return URL with a
`payment_intent` query parameter for an unpaid order shows pending — never
paid.

## 9. Commission

**Reuse the existing engine unchanged.** `CommissionRule` already provides
everything the gate asks for:

| Requirement | Status |
|---|---|
| Basis points | ✅ `percentBps Int` — *"0.5% = 50. Never a decimal percentage."* |
| Category configuration | ✅ `scopeType` resolves PROMO → SELLER → CATEGORY (walking the tree) → COUNTRY → PLATFORM |
| Min/max | ✅ `minMinor` / `maxMinor` already exist |
| Fixed + hybrid | ✅ `CommissionModel` PERCENTAGE / FIXED / HYBRID, with `fixedMinor` and a CHECK requiring a currency when fixed > 0 |
| Snapshot at creation | ✅ `Order.commissionRuleId`, `commissionPercentBps`, `commissionFixedMinor`, `commissionAmountMinor`, `sellerAmountMinor` |
| No recalculation after payment | ✅ Schema comment: *"Changing a commission rule tomorrow must NEVER rewrite yesterday's orders… This is the single most important immutability rule in the schema."* Phase 7 enforces it with an immutability trigger on the snapshot columns once `status <> 'DRAFT'`. |
| FEE_ONLY separate from item payment | ✅ by construction — the fee **is** the charge amount, guarded by D4 |

`sellerAmountMinor` is *"Always totalMinor − commissionAmountMinor. Derived by
subtraction so the two can never disagree by a penny."* For FEE_ONLY it is
zero, and D4 makes that a database invariant.

Two things Phase 7 must add, both small:
- `maxOnlineAmountMinor` on the category (already seeded: £5,000 for Cars,
  £10,000 for Business) must be **enforced as a ceiling on the charge amount**,
  so a misconfiguration cannot put a £50,000 charge through a fee-only flow.
- A minimum commission, because a £20 order nets £0.70 — **OQ-4**.

## 10. Security model

Built on the Phase 3–6 controls, which do not change. New surface, new attacks:

| Threat | Control |
|---|---|
| **Seller account ownership** | `stripeAccountId` is only ever read from the seller profile joined to the session's user id. No route, action or form accepts it. |
| **Connected-account IDOR** | Every connected-account route loads through a viewer-scoped query (the Phase 6 `loadOfferForParty` pattern) and answers **404, never 403**. `isUuid()` before querying. |
| **Payment/order IDOR** | An order is visible to its buyer and its listing's seller, by query scoping. A stranger gets the same 404 as a made-up id, byte-for-byte except `requestId`. |
| **Webhook spoofing** | Signature + IP allowlist. An unverified event is recorded with `signatureVerified = false` and **never acted on** — the schema already says *"A row with false must never be acted on."* |
| **Replay** | 5-minute signature tolerance, plus `PaymentEvent` PK on the Stripe event id, plus guarded state transitions. Three independent layers. |
| **Duplicate payment** | `Payment.idempotencyKey` unique + D6's partial unique index + the deterministic key `order:<id>:pi:v1`. Our database, not Stripe's 24-hour key retention, is the authority. |
| **Duplicate refund** | Deterministic `refund:<order>:<seq>:v1`, a guarded transition out of `REFUNDING`, and a CHECK that total refunded ≤ order total. |
| **Forged amount** | The amount is computed server-side from the listing and the accepted offer, both re-read. The browser sends an order id and nothing else. A PaymentIntent is created from the order row. |
| **Forged currency** | Taken from the listing; `validateOfferAmount` already refuses a cross-currency offer, and the order inherits it. |
| **Forged seller** | Resolved from `listing.sellerProfile`, never from a request field — the Phase 6 `resolveActor` rule extended to money. |
| **Forged commission** | Snapshotted server-side at order creation from the rule engine; immutability trigger after DRAFT; never accepted as input. |
| **Race conditions** | Guarded `UPDATE … WHERE status = <expected>` on every transition (`OfferConflictError` pattern), a deferrable zero-sum ledger trigger at COMMIT, and D6. |
| **Unauthorized payout** | **No payout-creating route exists.** Payouts are automatic on Stripe's schedule; Kurdora only records them. Attack surface removed rather than defended. |
| **Step-up for finance/admin** | Refunds, payout-schedule changes, commission-rule edits and connected-account actions all require `stepUpAt` inside `STEP_UP_WINDOW_MS`, via the existing `checkAccess`. |
| **Cross-border dispute trap** | ⚠️ *"Retransferring a previous reversal is subject to cross-border transfer restrictions, meaning you might have no means to repay your connected account."* Operational rule: for cross-border destination charges (no `on_behalf_of`), **do not reverse the transfer on dispute creation** — wait until the dispute is lost. Encode it in the dispute state machine, not in a runbook. |

Every protected route gets a row in `tests/api/authorization-matrix.test.ts`
for **every** role, and every id-addressed one gets an entry in
`tests/api/idor.test.ts`. That is the existing rule and it is not relaxed for
money.

## 11. Test plan — what Phase 7 must pass before it can be called done

Each is a named, failing-first test. Grouped by the gate's list.

**Idempotency**
1. `creates one PaymentIntent when the create call is retried` — same order, two concurrent requests, exactly one `Payment` row and one Stripe call.
2. `refuses a replay after Stripe's 24-hour key retention has lapsed` — our unique index stops it even when Stripe would not.
3. `rejects the same Idempotency-Key with a different body` — inbound `IdempotencyKey.requestHash` mismatch → 422, no side effect.

**Webhooks**
4. `refuses an event whose signature does not verify` — 400, nothing written, nothing acted on.
5. `refuses an event with a valid signature but a stale timestamp` — replay outside tolerance.
6. `refuses a v0-scheme signature` — downgrade attack.
7. `processes a duplicate event exactly once` — same `evt_` twice → one ledger group.
8. `processes a semantically duplicated event exactly once` — two different `evt_` ids, same `(type, object id)` → one effect.
9. `parks an out-of-order event instead of failing` — `charge.refunded` before `payment_intent.succeeded` stays PENDING, then succeeds on retry.
10. `never acts on an event recorded with signatureVerified = false`.
11. `returns 2xx before doing business logic` — asserts the handler does not await the worker.
12. `does not read the request body before verifying the signature`.

**Tampering**
13. `ignores a client-supplied amount` — a forged amount in the request produces a PaymentIntent for the server-computed amount.
14. `ignores a client-supplied currency`.
15. `ignores a client-supplied seller` — substituting `stripeAccountId` changes nothing; the transfer still goes to the listing's owner.
16. `ignores a client-supplied commission` — and the snapshot is unchanged.
17. `refuses to rewrite a commission snapshot after DRAFT` — the immutability trigger fires.

**Authorization**
18. `refuses an unauthorized refund` — non-owner → 404; owner without step-up → step-up required.
19. `refuses an unauthorized payout operation` — and asserts no payout-creating route exists at all.
20. `connected-account IDOR` — a stranger gets 404 identical to a fake id, and the victim's account is untouched.
21. `payment/order IDOR` — same, for orders and payments.

**Flow correctness — the two that matter most**
22. `an accepted offer creates no money movement` — the Phase 6 test, extended: after acceptance there is still no Order, Payment, LedgerEntry or Payout until the buyer explicitly starts the payment step.
23. `FEE_ONLY never charges the underlying sale amount` — asserted at **three** levels: the PaymentIntent amount equals the commission; the database CHECK (D4) refuses a hand-written row where it does not; and no `transfer_data`, `application_fee_amount` or connected account appears anywhere on the payment.
24. `FEE_ONLY is refused above the category's maxOnlineAmountMinor`.
25. `BUY_NOW creates exactly the intended records` — one PaymentIntent with `application_fee_amount` = the snapshot and `transfer_data[destination]` = the listing owner's account; one `Payment`; one balanced ledger group; no extra transfer.
26. `a return_url visit never marks an order paid` — E2E: land on the success page before the webhook, see "processing".
27. `refunds reverse the transfer` — `reverse_transfer=true` is set; the default (seller keeps the money) never happens silently.
28. `a cross-border dispute does not reverse the transfer on creation` — only on loss.

**Ledger**
29. `every new posting recipe balances` — `disputeOpened`, `disputeWon`, `disputeLost`, `transferReversed`.
30. `the zero-sum trigger refuses an unbalanced group written by hand`.

All of it runs in **Stripe test mode with the Stripe CLI**, against the real
API. None of it is mocked, and anything that is will be labelled as mock in the
code and in the exit report.

## 12. Blockers, assumptions and open questions

### Blockers

| # | Blocker | Severity | Blocks |
|---|---|---|---|
| **B-1** | **Stripe has not approved Kurdora's business model in writing.** The platform profile has not been submitted. | **HARD GO-LIVE BLOCKER** | Live mode only. Test mode may proceed. |
| **B-2** | Docker has never been available in this environment; MinIO has never booted; CI has never been observed running. | HIGH | Carried from Phases 4–6, unchanged. Payment code must not be the first thing that runs in an unverified environment. |
| **B-3** | Express Dashboard + Stripe-managed losses is in **public preview** and needs `2026-08-26.preview`. | MEDIUM | The dashboard choice only. Full Stripe Dashboard is the GA fallback. |
| **B-4** | Accounts v2 is preview-only and *"can't manage payout settings"*; the cross-border page directs v2 users to Global payouts. | MEDIUM | The API-version choice. v1 + controller properties is the GA fallback and is what is recommended here. |
| **B-5** | No legal review of the fee-only consumer proposition. | HIGH `[LEGAL]` | Cars and Business go-live. |

### Assumptions — each one falsifiable, none load-bearing without a check

- **A-1** Kurdora Ltd is a UK private limited company and the Stripe platform account is GB (DL-1). If the entity changes, most of §4 changes with it.
- **A-2** Sellers are in the UK and the EEA. Outside those regions, cross-border payouts does not self-serve and §5 needs redoing.
- **A-3** Buyers pay in GBP at launch; multi-currency is reporting-only (`fxRateToBase`).
- **A-4** Payouts are automatic on Stripe's schedule. If manual payouts are ever needed, §7's "no payout route exists" protection disappears and needs replacing.
- **A-5** Cars and Business use FEE_ONLY; Mobile & Electronics and Kurdish Clothing use BUY_NOW. This is category **data**, not code, so it can change without a deploy — which also means the tests must cover both flows for any category.

### Open questions — needing a decision before implementation

- **OQ-1 — Which dashboard?** Express Dashboard is the better seller experience but pairing it with Stripe-managed losses is in public preview. Full Stripe Dashboard is GA but heavier. **The dashboard type is immutable per account** — *"To change a connected account's dashboard, you must create a new Account object."* Getting this wrong is not fixable later.
- **OQ-2 — Accounts v1 + controller properties, or wait for v2 GA?** Recommended: v1 now. But every account created is permanent, and Stripe *"discourages indefinitely maintaining both Accounts API versions simultaneously."*
- **OQ-3 — Application fees from EEA sellers settle in EUR**, not GBP, for cross-border destination charges without `on_behalf_of`. Accept the FX exposure, or use `transfer_data[amount]` (which settles in our currency but hides the gross from the seller)? A commercial decision, not a technical one.
- **OQ-4 — Minimum commission.** A £20 order nets £0.70. Set `minMinor` on the category rules, or a platform floor?
- **OQ-5 — Fee evasion in the FEE_ONLY flow, and this is the big one.** The designed sequence is Listing → Conversation → Offer → Acceptance → *buyer pays Kurdora's fee*. After acceptance the two parties are already in contact and, for a car, must meet in person anyway. **Nothing structurally compels the fee to be paid.** The whole revenue model for Cars and Business rests on a payment the parties can simply decline to make. Options worth weighing before building: charge the **seller** a listing or success fee instead (the category's `feePayer` is already data); take the fee at the point of **contact** rather than acceptance; hold a card authorization at offer time and capture on acceptance; or accept the leakage and price for it. **This deserves a decision before code, not after.**
- **OQ-6 — Buyer-paid fees with no buyer protection.** ADR-0007 already flags it: buyers get no protection on the principal in fee-only categories because Kurdora never holds it. If the **buyer** is the one paying the fee, the proposition is "pay us, and you are on your own", which is both a trust problem and a `[LEGAL]` one under UK consumer-protection rules. It also raises the dispute rate on exactly the charges Kurdora is the merchant for.

## 13. Approval gate classification

Classified **per scope**, because one bucket would hide the real state.

| Scope | Class | Reason |
|---|---|---|
| **Overall project** | **B — IMPLEMENTATION-READY BUT STRIPE BUSINESS APPROVAL STILL REQUIRED** | Architecture decided against current docs; schema largely already present; test plan defined. **Live mode is blocked by B-1.** |
| BUY_NOW via destination charges | **B** | Technically unblocked. Aggregation is permitted via Connect with disclosed accounts, pending platform-profile review. |
| FEE_ONLY for Cars and Business | **B** | Not prohibited or restricted in the UK; sits outside the "aggregation" definition. Still needs written approval, plus **B-5 legal review**. |
| Connected accounts for EEA sellers | **D — BLOCKED, TECHNICAL INFORMATION MISSING** | The interaction between Accounts v2 and Connect cross-border payouts is not documented clearly enough to build on. **Does not block the UK launch**, where both parties are GB. |
| Express Dashboard + Stripe-managed losses | **D** | Public preview. Resolvable by choosing the full Stripe Dashboard. |

**What B permits:** building the Phase 7 integration in **Stripe test mode**,
with the Stripe CLI, behind the existing feature gating.

**What B forbids, without exception:** enabling live mode, processing a real
payment, onboarding a real seller, or describing the project as ready to take
money. **No claim of Stripe approval may be made until written confirmation
exists.**

### The one action that unblocks the most

Submit the Stripe platform profile, stating both flows explicitly — including
that FEE_ONLY charges only Kurdora's own service fee and that the purchase
principal never touches Stripe — and get the answer **in writing**. Everything
else in this report is work that can proceed in test mode. B-1 cannot be
engineered around.

---

## Confirmation

**No Phase 7 implementation has started.** No Stripe package is installed, no
PaymentIntent or Checkout Session is created, no connected account is created,
no transfer or payout exists, no payment webhook route exists, no payment UI
exists, and no payment migration has been written or applied. The database is
unchanged. This document and the ADR beside it are the only artefacts.
