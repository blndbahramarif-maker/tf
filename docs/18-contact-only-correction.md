# 18 — Contact-only correction: audit and changes

**Date:** 2026-09-13 · **Decision:** [ADR-0014](./adr/0014-contact-only-marketplace.md)

Kurdora provides the website where sellers advertise and buyers find them and
make contact. **The transaction happens directly between buyer and seller,
outside Kurdora.** This document records what the payment architecture was,
what was removed, what was kept and why.

---

## 1. Audit of the Phase 7 payment architecture

### 1.1 Tables that existed only for the payment-marketplace model

| Table | Purpose | Disposition |
|---|---|---|
| `orders`, `order_items`, `order_events` | A buyer's purchase through the platform | **Retained, dormant** |
| `payments`, `payment_attempts`, `payment_events` | Stripe charge lifecycle | **Retained, dormant** |
| `ledger_entries` | Double-entry record of platform money | **Retained, dormant** |
| `payouts`, `refunds`, `disputes` | Seller settlement and reversal | **Retained, dormant** |
| `commission_rules` | Percentage of a seller's sale | **Retained, inert** |
| `seller_profiles.stripe_*` (9 columns) | Connected-account mirror | **Retained, no longer written or exposed** |

**Nothing was dropped.** These tables are empty, nothing writes to them, and
dropping them would be a large irreversible migration with no functional
benefit. Retaining them also keeps the commission-rate history.

### 1.2 APIs that existed only for seller payments

| Endpoint | Disposition |
|---|---|
| `POST /orders`, `GET /orders/{id}` | **Removed** |
| `POST /orders/{id}/payment` | **Removed** |
| `POST /connect/onboarding`, `GET /connect/status` | **Removed** |
| `POST /webhooks/stripe` | **Removed** |
| `GET /seller-profiles/{id}` | **Kept**, with its Stripe fields removed |

### 1.3 UI that depended on Stripe

| Surface | Disposition |
|---|---|
| `/dashboard/payouts` page + forms | **Removed** |
| Payouts nav entry | **Removed** |
| Per-flow notices on listing, category and contact pages | **Replaced** with one truthful notice |

### 1.4 Tests that depended on Stripe

Removed: `tests/api/payments.test.ts`, `tests/api/connect.test.ts`,
`tests/domain/payments.test.ts`, `tests/domain/onboarding.test.ts`,
`e2e/payouts.spec.ts`.

Narrowed: `tests/api/stripe-live.test.ts` (Connect and destination-charge
suites gone), `tests/api/stripe-safety.test.ts` (webhook-route block gone),
`tests/api/authorization-matrix.test.ts` (Connect cases gone).

Updated for the new model: `tests/db/seed.test.ts`,
`tests/api/listings.test.ts`, `tests/db/constraints.test.ts`.

### 1.5 Domain rules that depended on BUY_NOW / FEE_ONLY

Removed: `order-amounts.ts` (commission maths, `assertChargeIsSafe`),
`order-status.ts` (11-state order machine), `payment-status.ts`,
`onboarding-status.ts`, `connect-gateway.ts`.

Also removed: `order-service.ts`, `payment-service.ts`, `webhook-service.ts`,
`onboarding-service.ts`, `stripe/connect.ts`, `lib/payments/onboarding-urls.ts`.

### 1.6 Migration risks, and how each was handled

| Risk | Handling |
|---|---|
| Dropping tables is irreversible | Not dropped. Retained, dormant. |
| A `down.sql` that guesses previous category flows would silently re-enable payment on the wrong ones | `down.sql` drops the constraints only and says so |
| Column DEFAULTS (`BUY_NOW`, `true`) would contradict the new constraints — a category created without naming them would be REFUSED | Defaults changed in the same migration. Caught by an existing fixture, not by inspection. |
| Removing permission rows could orphan grants | Grants deleted first, in the same statement block |

---

## 2. Changes made

### 2.1 Data and constraints — `20260913120000_contact_only_marketplace`

- Every category → `CONTACT_ONLY`, `allows_online_payment = false`,
  `max_online_amount_minor = NULL`
- `categories_no_online_payment_for_seller_goods` — no category may take money
  for a seller's goods
- `categories_contact_only_flow` — the flow is pinned
- Column defaults aligned with the constraints
- 13 payment permissions and their grants deleted (50 → 37 permissions)

**Why two constraints.** A category is a row an admin can edit. The payment flag
stops the charge; the flow pin stops the *claim* — the other flows made the
public UI say "bought and paid for through the platform". A false statement
about payment protection is a worse outcome than a charge that cannot happen.

### 2.2 Wording

The per-flow notices were replaced by one notice per surface, in all four
locales. Indexing copy by flow was itself the risk: it was a route by which a
false payment claim could reach a live page.

An E2E test asserts the public pages contain none of: *guarantee*, *guaranteed*,
*buyer protection*, *we protect your payment*, *secure payment*, *escrow*.

---

## 3. Prohibited-listing controls

`prohibited_item_rules` was **seeded since Phase 2 and never enforced by any
code**. It is now wired.

- `src/domain/safety/prohibited-content.ts` — pure matching. Word-boundary
  matching (so "stolen" does not fire inside "unstolen"), whitespace
  normalisation (so a phrase cannot be split across lines), invalid and
  over-long regexes ignored rather than thrown.
- `src/infra/safety/prohibited-rules.ts` — scoping is the QUERY: active rules
  whose country and category are null-or-matching.
- `src/infra/safety/listing-screening.ts` — `decidePublication`, the single
  implementation both write paths use.

| Rule type | Effect |
|---|---|
| `BLOCK` | Refuses creation and refuses publication |
| `REQUIRE_APPROVAL` | Forces `PENDING_REVIEW` |
| `FLAG` | Publishes to `PENDING_REVIEW`, not to the public |

Screened at creation AND at publication, from the **stored** text — a seller
can write a clean draft and edit it before publishing.

**Screening is a safety net, not a guarantee.** It matches text against a list
a human wrote. It cannot read images, cannot infer intent, and does not know
every word for a prohibited thing in four languages. An `ALLOW` outcome means
"nothing matched", never "this listing is lawful".

---

## 4. Moderation and reporting

| Requirement | Status |
|---|---|
| Prohibited-listing policy in code/config | `prohibited_item_rules`, admin-editable |
| Block prohibited categories before publication | `BLOCK` refuses; `FLAG`/`REQUIRE_APPROVAL` divert to review |
| Listing reporting | `POST /listings/{id}/report` + a form on every listing page |
| Moderation status/workflow | The 8-state listing machine, unchanged |
| Moderators remove or reject | Transition table; rejection requires a reason |
| Audit trail of moderation actions | `moderation_actions` row in the SAME transaction as the status change, plus `audit_log` |
| Users report suspicious listings | Any signed-in member, any visible listing |
| Suspended sellers cannot publish | Account status re-read from the database on every request |
| Server-side validation | Every control above is server-side |
| No overclaiming | Stated in code comments, UI copy and this document |

**Distinct states:** `ACTIVE` (published) · `REJECTED` (refused, with a reason)
· `REMOVED` (taken down) · reported (a `reports` row; the listing is unchanged)
· seller suspended (`users.status`, enforced at the guard).

**Reporting does not hide a listing.** A report is one person's claim; letting a
claim take a competitor's listing down would be a censorship button with no cost
to pull. One open report per person per listing, so one reporter cannot
manufacture a pile-on.

---

## 5. Remaining risks

1. **No moderation dashboard.** Reports land in `reports` and moderation runs
   through the API. A queue UI does not exist.
2. **Screening is English-shaped.** The seeded patterns are English. A
   prohibited listing written in Sorani, Kurmanji or Arabic will not match.
3. **No image moderation.** Screening reads text only.
4. **No native-speaker review** of the safety copy in `ckb`, `kmr` or `ar`.
5. **Monetisation is unbuilt and unproven.**
6. **Buyers have no payment protection**, by design. Stated in the UI.

## 6. Not a legal opinion

This document records engineering work. It is **not** advice that the model is
lawful, exempt from regulation, or free of obligations. A marketplace hosting
listings still has duties — consumer law, content liability, data protection and
platform-specific regimes among them. No lawyer has reviewed this.
