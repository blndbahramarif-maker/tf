# 11 — Risks & Key Decisions

## Risks, worst first

### R-1 · The commission rate is below the payment processing cost `CRITICAL` → **MITIGATED**
0.5% commission vs 1.5–3.15% + 20p card fees. On a £50,000 destination charge the
platform nets **−£500.20**. Full arithmetic in [04](./04-payments-architecture.md).
**Mitigation:** choose a model in Q-2 — fee-only for high value, realistic commission
for everyday goods. **RESOLVED ([DL-2](./12-decisions-log.md)):** fee-only for high value, realistic
per-category rates for everyday goods. Residual risk: the everyday-goods rates are
seeded defaults and must be sanity-checked against real order values after launch.

### R-2 · Chargeback exposure on high-value transactions `CRITICAL` → **LARGELY ELIMINATED**
As merchant of record on destination charges, your platform balance is debited for the
full disputed amount. One disputed £50,000 car sale where the seller has already
withdrawn = a £50,000 hole.
**RESOLVED for high value ([DL-2](./12-decisions-log.md)):** the principal never passes
through Stripe, so the maximum disputable amount on a business or car sale is the ~£250
fee, not £50,000. Residual exposure is limited to everyday-goods orders, where order
values are small.
**Remaining mitigations (still required):** payout delays; rolling reserves;
`debit_negative_balances`; per-seller value caps; strong identity verification; good
in-platform dispute resolution.

### R-3 · Stripe may not approve the business model `HIGH` → **REDUCED**
High-value goods are a restricted category requiring additional due diligence; vehicle
sales are prohibited in some jurisdictions; the sale of whole businesses is not an
enumerated category at all.
**Mitigation:** complete the Stripe platform profile and obtain **written**
confirmation before Phase 7. [DL-2](./12-decisions-log.md) already adopts the fee-only
design, which is the lower-risk model — Kurdora is charging a service fee for an
introduction rather than processing £50,000 vehicle and business sales, which is a
materially easier model for Stripe to approve.
**Status 2026-09-12:** still NOT obtained, and re-confirmed by the owner as a
**hard go-live blocker** at the Phase 7 Part 2 review. Phase 7 shipped in TEST
MODE only on that basis; `LIVE_MODE_PERMITTED = false` stays enforced and
Kurdora must not be described as Stripe-production-ready. See
[13 · D-A](./13-dependencies-and-blockers.md).

### R-4 · Holding funds may make Kurdora a regulated payment institution `HIGH` `[LEGAL]`
Stripe does not provide escrow; manual payouts cap at 90 days; Connect is designed to
keep the platform out of possession of funds.
**Mitigation:** lawyer confirms hold limits before Phase 8; never use the word
"escrow"; keep holds short and rule-based rather than discretionary.

### R-5 · EU Digital Services Act obligations `HIGH` `[LEGAL]`
Online marketplaces have specific duties: trader traceability (KYB), notice-and-action,
statements of reasons for every moderation decision, internal complaint handling,
transparency reporting.
**Mitigation:** scope with a lawyer before Phase 9; the moderation and verification
schema already anticipates it, but the obligations must drive the detail.

### R-6 · VAT and marketplace deemed-supplier rules `HIGH` `[LEGAL/TAX]`
Cross-border EU sales, OSS/IOSS, and whether the marketplace becomes the deemed
supplier in any flow. Getting this wrong is expensive and retrospective.
**Mitigation:** tax adviser before launch; the schema already carries `tax_minor` and
per-country settings.

### R-7 · Fraud concentration in high-value categories `HIGH`
Cars and businesses attract advance-fee fraud, cloned listings, stolen vehicles and
impersonation.
**Mitigation:** mandatory verified identity for high-value sellers; listing approval for
those categories; image reverse-check; velocity limits; visible safety guidance;
prohibited-item rules.

### R-8 · Prohibited goods differ across 30+ jurisdictions `MEDIUM` `[LEGAL]`
What is legal in one European country is illegal in another.
**Mitigation:** `prohibited_item_rules` are per-country and per-category from day one;
launch in few countries; keep rules admin-editable.

### R-9 · Scope is very large for the stated ambition `HIGH` → **PARTLY ADDRESSED**
The brief describes roughly 3–5 mature products (marketplace + payments + messaging +
ads + subscriptions + moderation + analytics).
**Mitigation:** [DL-4](./12-decisions-log.md) cuts the launch to one country and 3–4
categories, and [DL-3](./12-decisions-log.md) cuts the stack to one application.
Residual risk is real: solo development of phases 1–8 is still 4–7 months of consistent
work, and the remaining phases are a multi-year programme.

### R-10 · Kurdish language quality `MEDIUM`
Sorani and Kurmanji need genuine native review; poor translation in a community
platform is a credibility failure, and financial terminology is unforgiving.
**Mitigation:** budget native reviewers as a launch dependency; admin-editable
translation overlay so fixes ship without a deploy.

### R-11 · Multi-currency complexity `MEDIUM`
GBP/EUR plus per-country settlement, FX on cross-currency payments (+2% conversion fee),
reporting in a base currency.
**Mitigation:** store `fx_rate_to_base` on every order; never convert live for
historical reporting; prefer same-currency settlement per corridor.

### R-12 · Stripe Accounts v2 is on a preview API version `MEDIUM`
Stripe directs new platforms to Accounts v2, but it is served under
`2026-08-26.preview`, cannot manage payout settings, and has documented limitations.
**Mitigation:** confirm GA status at the start of Phase 7; fallback to Accounts v1 with
controller properties, which is fully supported.

### R-14 · Solo-developer bus factor `MEDIUM-HIGH` (new, from [DL-3](./12-decisions-log.md))
One person holds all context for a system that moves real money. Illness, burnout or a
lost laptop stalls everything.
**Mitigation:** this documentation set is the first mitigation and must be kept current
as code lands. Plus: everything in version control, no undocumented manual production
steps, runbooks for payment incidents, tested backup restores, secrets in a managed
store recoverable independently of any one machine, and an ADR per significant decision.

### R-13 · Single-admin key-person risk `MEDIUM`
One `super_admin` account is a single point of catastrophic failure.
**Mitigation:** mandatory 2FA, break-glass procedure, at least two admins, audit
alerting, backup restore tested.

---

## Decisions needing your sign-off

| # | Decision | My recommendation |
|---|---|---|
| **D-1** | Accounts v2 vs Accounts v1 + controller properties | Re-verify at Phase 7; default to **v1 + controller properties** unless v2 is GA, because payout settings still require v1 |
| **D-2** | Destination charges vs separate charges & transfers | **Destination charges** for simplicity and cross-border support; keep separate charges & transfers available for delayed-release flows |
| **D-3** | Own auth vs managed IdP | **Own auth** (control, cost, seller-state coupling) with the guardrails in [08](./08-security-architecture.md). Switch to a managed IdP if the team is very small |
| **D-4** | Prisma vs Drizzle | **Prisma**, re-evaluate at Phase 4 if attribute filtering suffers |
| **D-5** | Postgres FTS vs dedicated search engine at launch | **Postgres first**, engine at 4b. Arabic-script quality is the likely trigger |
| **D-6** | Separate admin app vs route group | ✅ **RESOLVED — route group** (`/[locale]/admin`) per [DL-3](./12-decisions-log.md). Compensating controls: mandatory TOTP, step-up auth on money operations, stricter CSP, separate cookie scope, full audit logging |
| **D-7** | Full stack (Next + Nest) vs lean (Next only) | ✅ **RESOLVED — lean** ([DL-3](./12-decisions-log.md)). `src/domain` stays framework-free so the API can be extracted later without touching business logic |
| **D-8** | Multi-item cart at launch | **No** — single-item orders. The schema supports `order_items` for later |
| **D-9** | Guest checkout | **No** at launch. Accounts give dispute resolution, reviews and fraud signals |
| **D-10** | Buyer protection window / payout delay | **Yes** for everyday goods, per category, short and rule-based — pending R-4 legal confirmation on fund holding. Not applicable to fee-only categories, which have no payout leg |
