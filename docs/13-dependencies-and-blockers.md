# 13 — External Dependencies & Blockers

Things that are **not engineering work**, that Kurdora does not control, and that
can block a phase. Each has an owner, a phase it blocks, and a status.

Review this at the start of every phase.

---

## 🔴 D-A · Stripe written approval of the business model — **BLOCKS PHASE 7**

**Status: NOT OBTAINED. No approval exists.**

Nothing in this repository may state or imply that Stripe has approved Kurdora's
model. If asked, the honest answer is that the platform profile has not been
confirmed.

**Why it is a real risk (not a formality):**
- *High-value goods, precious metals and stones* are a **restricted** category
  requiring additional due diligence
  (<https://stripe.com/gb/legal/restricted-businesses>).
- **Vehicle sales** are prohibited in some jurisdictions.
- The **sale of whole businesses** is not an enumerated category at all — it is
  undefined rather than permitted.

**What is needed:** complete the Stripe platform profile
(<https://dashboard.stripe.com/settings/connect/platform-setup>) describing:
a UK Ltd marketplace; destination charges with `application_fee_amount` for
everyday goods; **fee-only success fees** for Cars and Business, where the
purchase principal never passes through Stripe; sellers in the UK and EEA under
a full service agreement; Stripe-hosted onboarding and KYC.

**Do this now, in parallel with Phases 2–6.** It is the only dependency that can
block a phase entirely, and it has a lead time outside our control.

**If Stripe declines the high-value flow:** the fee-only model (DL-2) is already
the lower-risk design and is likelier to be accepted than processing £50,000
vehicle sales. If even that is declined, the Cars and Business categories cannot
take online payment and become `contact_only` — a product decision, not a code
change, since `categories.transaction_flow` is data.

---

## 🔴 D-B · UK legal review — blocks public launch

**Status: not started.** Owner: a qualified UK/EU solicitor.

Needed before real users transact:

| Item | Why |
|---|---|
| Terms of Service, marketplace rules | Baseline |
| Seller agreement | Must cover transfer reversal and `debit_negative_balances` — we recover refunds and disputes from seller balances |
| **Fee-only disclosure wording** | Buyers get no protection on the principal. Burying this is a consumer-law risk as well as a trust failure (ADR-0007) |
| Privacy policy, DPAs, retention periods | GDPR |
| Message risk-scoring disclosure | Lawful basis for scanning message content |
| EU Digital Services Act obligations | Marketplaces owe trader traceability, notice-and-action, statements of reasons, complaint handling. **Scope before Phase 9** — it shapes the moderation design |
| Prohibited-goods rules for the UK | Launch country |

## 🔴 D-C · UK tax advice — blocks public launch

**Status: not started.** Owner: an accountant or tax adviser.

VAT treatment of the commission and of the fee-only success fee; whether the
marketplace is ever a deemed supplier; VAT registration threshold and timing;
future EU expansion (OSS/IOSS). Getting this wrong is expensive and retrospective.

## 🟠 D-D · Company incorporation

**Status: assumed in progress.** `packages/brand` has empty `companyNumber` and
`vatNumber` — fill them in when available. Needed before a Stripe live account.

## 🟠 D-E · Native Kurdish review of all copy — blocks launch

**Status: not started.** Owner: native Sorani and Kurmanji speakers.

The catalogues in `packages/i18n/messages` are **machine-assisted drafts**. They
prove the architecture; they are not launch quality. Financial vocabulary
(offer, commission, payout, dispute, refund, verification) is where a wrong word
destroys trust. Sorani is needed for launch; Kurmanji before enabling `kmr`.

Also needs a native reader: confirming the Arabic-script font renders Sorani
letterforms (ڕ ێ ۆ ڵ گ چ پ ژ) correctly. Many "Arabic" fonts do not.

## 🟠 D-F · External penetration test — blocks taking real money

**Status: not started.** Schedule after Phase 12, before live payments.

## 🟡 D-G · Domain and infrastructure accounts

Domain registration for the launch brand; UK/EU-region hosting, managed Postgres
and Redis, object storage and CDN, transactional email with a warmed sending
domain (SPF/DKIM/DMARC). Needed for Phase 14; nothing blocks earlier phases.

## 🟡 D-H · Toolchain watch item

`typescript-eslint` does not support TypeScript ≥ 7 (ADR-0008). We are pinned to
TypeScript 6 deliberately. Upgrade as a standalone change when support lands.

---

## Summary

| ID | Dependency | Blocks | Status |
|---|---|---|---|
| D-A | **Stripe written approval** | **Phase 7** | 🔴 Not obtained — **start now** |
| D-B | UK legal review | Launch | 🔴 Not started |
| D-C | UK tax advice | Launch | 🔴 Not started |
| D-D | Company incorporation | Stripe live | 🟠 Assumed in progress |
| D-E | Native Kurdish review | Launch | 🟠 Not started |
| D-F | Penetration test | Live payments | 🟠 Not started |
| D-G | Domain, hosting, email | Phase 14 | 🟡 Not started |
| D-H | TypeScript 7 support | — | 🟡 Watching |
