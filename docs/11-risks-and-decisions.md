# 11 — Risks & Key Decisions

## Risks, worst first

### R-1 · The commission rate is below the payment processing cost `CRITICAL`
0.5% commission vs 1.5–3.15% + 20p card fees. On a £50,000 destination charge the
platform nets **−£500.20**. Full arithmetic in [04](./04-payments-architecture.md).
**Mitigation:** choose a model in Q-2 — fee-only for high value, realistic commission
for everyday goods. **This must be decided before any payment code is written**, because
it determines the flow, the schema usage and the UI.

### R-2 · Chargeback exposure on high-value transactions `CRITICAL`
As merchant of record on destination charges, your platform balance is debited for the
full disputed amount. One disputed £50,000 car sale where the seller has already
withdrawn = a £50,000 hole.
**Mitigation:** fee-only flow for high value; payout delays; rolling reserves;
`debit_negative_balances`; per-seller value caps; strong identity verification; good
in-platform dispute resolution.

### R-3 · Stripe may not approve the business model `HIGH`
High-value goods are a restricted category requiring additional due diligence; vehicle
sales are prohibited in some jurisdictions; the sale of whole businesses is not an
enumerated category at all.
**Mitigation:** complete the Stripe platform profile and obtain **written**
confirmation before Phase 7. Have model B as the fallback design.

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

### R-9 · Scope is very large for the stated ambition `HIGH`
The brief describes roughly 3–5 mature products (marketplace + payments + messaging +
ads + subscriptions + moderation + analytics).
**Mitigation:** the phased plan and the "cut the launch scope" recommendation in
[10](./10-roadmap.md).

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
| **D-6** | Separate admin app vs route group | **Separate app** on its own subdomain for isolation; route group is acceptable in the lean variant |
| **D-7** | Full stack (Next + Nest) vs lean (Next only) | Depends on Q-8. Lean keeps every expensive decision intact and halves the work |
| **D-8** | Multi-item cart at launch | **No** — single-item orders. The schema supports `order_items` for later |
| **D-9** | Guest checkout | **No** at launch. Accounts give dispute resolution, reviews and fraud signals |
| **D-10** | Buyer protection window / payout delay | **Yes**, per category, short and rule-based — pending D-4 legal confirmation on fund holding |
