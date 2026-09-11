# 10 — Development Roadmap

Every phase ends with the same gate. **No phase starts until the previous one passes it.**

### Phase exit gate (applied to every phase)
1. Automated tests written and passing (unit + integration; E2E from Phase 4).
2. `pnpm lint && pnpm typecheck` clean — zero errors, zero new warnings.
3. Security review against [08](./08-security-architecture.md) for the new surface.
4. Migrations run forward **and** roll back cleanly on a copy of staging data.
5. What was completed, written down.
6. What remains, written down.
7. Anything mock/stubbed is **explicitly labelled** as mock in the code and the summary.

---

### Phase 0 — Requirements & clarification ← **we are here**
Deliverables: this documentation set. **Blocked on your answers to the open questions
in [00](./00-scope-and-open-questions.md), especially Q-1, Q-2, Q-3 and Q-8.**

### Phase 1 — Architecture sign-off
Monorepo skeleton, ADRs for the decisions in [11](./11-risks-and-decisions.md), OpenAPI
contract v0, CI pipeline (lint, typecheck, test, migrate, secret scan), Docker compose
for local Postgres/Redis/MinIO. **No business logic yet.**
*Exit:* CI green on an empty but complete skeleton; `docker compose up` gives a working
local environment from a clean clone.

### Phase 2 — Project setup & database
Full Prisma schema from [03](./03-database-architecture.md), all migrations, seed data
(countries, cities, currencies, category tree with attributes, commission rules, roles,
locales). Ledger invariant test.
*Exit:* migrations reversible; seeds idempotent; `entry_group_id` sums to zero test passes.

### Phase 3 — Authentication & roles
Register, verify email, login, refresh rotation with reuse detection, password reset,
TOTP 2FA, RBAC guards, ownership guards, rate limiting, audit interceptor, session
management.
*Exit:* authorisation test matrix (every role × every protected route) passes; a
deliberate IDOR attempt returns 403/404 for every owned resource.

### Phase 4 — Listings, categories, search
Category & attribute admin CRUD, listing create/edit with dynamic category fields,
image pipeline, publish/expire lifecycle, browse, filter, faceted search, SEO
(sitemap, structured data, `hreflang`, canonicals), category and country landing pages.
*Exit:* a listing can be created in each of the four locales and found by keyword,
category, country, price and a category-specific attribute; Lighthouse SEO ≥ 95;
p95 search latency < 300 ms on 100k seeded listings.
*4b (conditional):* migrate search to Typesense/Meilisearch if quality or latency fails.

### Phase 5 — Buyer & seller dashboards
Seller profile, business profile, public profile pages, listing management, buyer
dashboard, favourites, saved searches, notification centre, notification preferences.
*Exit:* full E2E journey — register → become seller → publish → another user finds it.

### Phase 6 — Messaging & offers
Realtime conversations, read receipts, attachments, block, report, offer lifecycle
(make/counter/accept/decline/expire), risk scoring feeding the moderation queue.
*Exit:* message delivery survives a server restart; offer state machine fully tested
including expiry and the single-use constraint.

### Phase 7 — Stripe Connect  ⚠️ the highest-risk phase
**Starts with re-verification of the Stripe docs and a written decision on
Accounts v2 vs v1 + controller properties.** Seller onboarding via Stripe-hosted
onboarding, `account.updated` handling, capability gating, PaymentIntent creation,
Payment Element, webhook infrastructure (signature verification, exactly-once,
async processing), idempotency everywhere, **test mode only**.
*Exit:* full test-mode payment with the Stripe CLI; replayed webhooks cause no double
credit; a forged signature is rejected and alerted; a simulated timeout-then-retry
creates exactly one charge; SCA/3DS challenge path passes.

### Phase 8 — Orders, payouts, commissions, refunds
Order state machine, commission engine with snapshotting, internal ledger, payout
tracking, refunds with `reverse_transfer` / `refund_application_fee`, dispute handling,
payout delay and reserve policy, nightly reconciliation job.
*Exit:* ledger reconciles to Stripe test-mode balance transactions to the penny across
a scripted scenario of purchase → partial refund → full refund → dispute.

### Phase 9 — Reviews, reports, moderation
Order-gated reviews, seller responses, report intake and triage queue, moderation
actions, sanctions, prohibited-item rule engine per country, statements of reasons
(DSA-shaped — see [08](./08-security-architecture.md)), appeals.
*Exit:* a report reaches a moderator, an action is taken, the user is notified with a
reason, and the whole path is in the audit log.

### Phase 10 — Subscriptions & advertising
Plans and prices (admin-configured, no prices in code), Stripe Billing subscriptions,
entitlement enforcement (listing/image quotas, badges), featured/premium listing
purchase, ad placements and serving, ad statistics.
*Exit:* a downgrade correctly revokes entitlements; a failed renewal is handled without
data loss.

### Phase 11 — Admin analytics
GMV, commission, net revenue after payment fees, refunds, disputes, payouts, by
category / country / time; seller and listing analytics; export.
*Exit:* dashboard figures match the ledger exactly; multi-currency figures use stored
FX rates, not live ones.

### Phase 12 — Security hardening
Full CSP rollout, penetration-test checklist, dependency and secret scanning in CI,
GDPR export/deletion workflows, cookie consent, DPA register, incident runbook.
*Exit:* OWASP ASVS L2 checklist reviewed; **an external penetration test is strongly
recommended before taking real money.**

### Phase 13 — Testing & QA
Coverage targets (payments/commission/ledger ≥ 95%), load testing, RTL visual
regression, accessibility audit (WCAG 2.2 AA), cross-browser/device, four-locale
content QA with native speakers.

### Phase 14 — Production deployment
EU/UK infrastructure, backups with **tested restores**, monitoring and alerting,
runbooks, staged rollout — soft launch in one country and one or two categories
before opening Europe-wide.

---

## Honest timeline

| Team | Phases 1–8 (payable MVP) | Phases 1–14 (full brief) |
|---|---|---|
| Solo experienced full-stack dev | 8–12 months | 18–30 months |
| 2–3 experienced devs | 4–6 months | 9–14 months |
| 4–6 (incl. design, QA, PM) | 3–4 months | 6–9 months |

Plus, in parallel and not optional: legal review, Stripe platform approval, native
Kurdish translation review, and an external security test.

**Strong recommendation: cut the launch scope.** One country, three or four categories,
one transaction flow, English + Sorani. Prove the payment loop and the trust model with
real money and real users, then expand. The architecture above is built so that
expansion is configuration, not rewriting — that is precisely why it is worth designing
it properly now even though you launch with less.
