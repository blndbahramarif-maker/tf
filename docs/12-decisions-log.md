# 12 — Decisions Log

Answers given 2026-09-11. These are now the operating assumptions; everything else in
this documentation set has been updated to match.

---

## DL-1 · Platform entity: **UK limited company**

**Consequences**
- Stripe platform account country = **GB**. Platform currency GBP; EUR supported as a
  presentment/settlement currency per corridor.
- **Cross-border payouts apply and are fee-free.** UK platforms may transfer to
  connected accounts in the US, UK, EEA, Canada and Switzerland, and the 0.25%
  cross-border fee is *waived between the UK and the EEA*
  (<https://docs.stripe.com/connect/cross-border-payouts>). Every intended Kurdora
  corridor is therefore zero-fee on the payout leg.
- Supported funds flows for that product are **destination charges without
  `on_behalf_of`** and separate charges and transfers without `on_behalf_of`. This
  confirms the design in [04](./04-payments-architecture.md): omit `on_behalf_of`,
  Kurdora is merchant of record.
- Seller accounts must be under a **full service agreement**, not a recipient service
  agreement — recipient-agreement accounts are excluded from cross-border payouts.
- UK consumer law and UK VAT apply to the platform. Selling *into* EU countries still
  engages EU consumer law and the DSA for those users. `[LEGAL REVIEW]`
- UK card pricing applies: 1.5% + 20p domestic, 2.5% + 20p EEA, 3.15% + 20p
  international, +2% on currency conversion (<https://stripe.com/gb/pricing>).

## DL-2 · High-value transactions: **fee-only (success fee)**

For Business, Cars and any category above the configured high-value threshold, only
the platform commission is charged through Stripe. The principal never enters the
Stripe balance or any Kurdora bank account.

**Consequences**
- `categories.transaction_flow = 'fee_only'` for those categories, with
  `offer_then_pay` as the preceding negotiation step.
- Implemented as a PaymentIntent on the platform account with **no `transfer_data`** —
  there is no seller payout leg, so no connected-account transfer, no transfer
  reversal, and no £50,000 chargeback exposure.
- £50,000 sale at 0.5%: £250 fee, ~£3.95 Stripe cost, **~£246 net**. Profitable.
- Sellers in fee-only categories still complete Stripe onboarding **only if** they also
  sell in payable categories. A pure fee-only seller does not need a connected account
  at all — which materially shortens their path to a first listing.
- **Product obligation:** the listing page and checkout must state plainly what the fee
  buys and what protection the buyer does *and does not* have on the principal. This is
  a trust-critical copy requirement, not a footnote. `[LEGAL REVIEW]`
- Open sub-decision (configurable, not blocking): who pays the fee (buyer / seller /
  split), and when it is charged (on offer acceptance, or on marking sold). Default:
  **buyer pays on offer acceptance**, refundable if the sale collapses within the
  configured window.

### Still to set: the everyday-goods rate
Fee-only solves high value. It does **not** solve low value: a £200 phone at 0.5% earns
£1.00 against a £3.20 card fee — a loss on every sale. The commission engine is fully
admin-configurable, so this is not a code blocker, but the seeded defaults must be
realistic. Proposed seeds (change freely in the admin panel):

| Category | Flow | Seeded rate | Rationale |
|---|---|---|---|
| Business, Cars | `fee_only` | 0.5% | As specified; profitable in this flow |
| Mobile, Electronics | `buy_now` | 6% | Covers 1.5–3.15% card fee + refunds + support |
| Clothing, Kurdish Clothing | `buy_now` | 7% | Low ticket; fixed 20p is proportionally large |
| Furniture, Household | `buy_now` | 5% | Larger tickets, often collected in person |
| Food, Cultural Products | `buy_now` | 6% | |
| Services | `contact_only` | — | Enquiry only at launch |
| Jobs | `contact_only` | — | Pending answer to Q-10 |

A minimum commission (e.g. 50p) prevents the fixed 20p from eating small orders.

## DL-3 · Team: **solo founder, built with Claude Code → LEAN STACK**

**Consequences**
- **One Next.js 15 application**, not a separate Next.js + NestJS pair. API lives in
  `/app/api/v1/*` route handlers written to an OpenAPI contract, so native mobile apps
  remain possible later without a rewrite.
- Admin is a **protected route group** (`/admin`) with mandatory TOTP, step-up auth and
  a stricter CSP — accepting weaker isolation than a separate subdomain, which is the
  one security trade this decision makes. Documented in [11](./11-risks-and-decisions.md) as D-6.
- **Unchanged from the full design** — every expensive-to-reverse decision survives:
  PostgreSQL schema, integer money, hybrid category attributes, double-entry ledger,
  commission engine, Stripe architecture, RBAC model, i18n/RTL architecture, security controls.
- Background jobs still run as a **separate worker process** (same codebase). Webhook
  processing and reconciliation must not share a request lifecycle.
- Buy over build where it does not touch money or authorisation: managed Postgres,
  managed Redis, hosted email, hosted error tracking, Stripe-hosted onboarding.
- **Every phase must be reviewable and testable by one person.** Phase sizes in
  [10](./10-roadmap.md) are re-cut accordingly, and each ends at a working, demonstrable
  state rather than a half-finished layer.
- Realistic timeline for a payable MVP (phases 1–8, reduced launch scope): **4–7 months**
  of consistent work. The full brief is a multi-year programme; see DL-4.

## DL-4 · Launch scope: **one country, 3–4 categories**

**Consequences**
- `countries` and `categories` are seeded active for the launch set only; everything
  else is seeded but inactive. Expansion is an admin toggle, not a deploy.
- One country = one legal/tax review, one prohibited-goods rule set, one set of address
  and phone formats, one payout corridor. This is the single largest risk reduction
  available.
- All four locales still ship — the community is the point, and the i18n architecture
  costs the same whether or not you launch Europe-wide.

**Still needed before Phase 2 seeding** (not blocking Phase 1):
- **Which country?** If most of your early sellers are in the UK, launch UK-only: the
  platform is a UK entity, card fees are lowest domestically, and consumer law and VAT
  are a single regime. Germany or Sweden are reasonable alternatives if that is where
  the community and the sellers actually are — but each adds an EU legal review.
- **Which 3–4 categories?** My suggestion, chosen to exercise both flows and to be
  genuinely differentiated: **Cars** (`offer_then_pay` → `fee_only`), **Mobile &
  Electronics** (`buy_now`), **Kurdish Clothing** (`buy_now`, and the category nobody
  else serves well), plus optionally **Business** (`fee_only`) if that is commercially
  the point of the platform.

---

## DL-5 · Connect controller configuration: **keep the GA combination**

Decided 2026-09-12, after Phase 7 Part 2 surfaced the conflict.

**Decision.** Connected accounts are created with `stripe_dashboard.type =
express`, `fees.payer = application`, **`losses.payments = application`** and
`requirement_collection = stripe`, on GA API version `2026-08-26.dahlia`.

Explicitly **not** adopted: `losses.payments = stripe`, the Express Dashboard
public preview it requires, or API version `2026-08-26.preview`.

This **supersedes ADR-0013 Decision 4 in implementation**. That decision — let
Stripe carry negative balances — remains the preferred end state and Stripe's
own advice; it is simply not available on a GA API version today, and adopting
a preview API version for the code path that takes money is the wrong trade.

**Consequences**

- **Kurdora absorbs a negative balance on a connected account**, not Stripe.
  Accepted knowingly. Bounded by DL-2: FEE_ONLY never routes the sale principal
  through Stripe, so the exposure is on BUY_NOW orders — the low-value
  categories — and destination charges cap the disputable amount at the fee.
- `stripe_dashboard.type` is **immutable per account**. Reversing this means
  recreating every connected account, which is why it is a logged decision and
  not a configuration detail.
- **No production account migration or recreation is to be performed.** There
  are no production connected accounts and none may be created while
  `LIVE_MODE_PERMITTED = false`.
- Pinned in code by `CONNECT_CONTROLLER` and by a test, so it cannot drift
  without a reviewer seeing it.

**Revisit only when** the combination is GA on a GA API version, **and** the
commercial case has been reviewed against real dispute volume, **and** legal
review has covered it. Full working: [ADR-0013 Amendment 1](./adr/0013-phase-7-payment-architecture.md#amendment-1--the-controller-configuration-2026-09-12).

---

## Consolidated effect on the plan

| Document | Change |
|---|---|
| [01](./01-tech-stack.md) | Lean variant promoted to the recommended stack |
| [04](./04-payments-architecture.md) | UK platform confirmed; fee-only is the primary high-value flow; destination charges retained for everyday goods |
| [07](./07-commission-engine.md) | Seeded default rates added (DL-2) |
| [10](./10-roadmap.md) | Phases re-cut for a single developer |
| [11](./11-risks-and-decisions.md) | D-6 and D-7 resolved; R-1 and R-2 substantially mitigated by DL-2 |
| [ADR-0013](./adr/0013-phase-7-payment-architecture.md) | Amendment 1 records DL-5 and supersedes Decision 4 in implementation |
