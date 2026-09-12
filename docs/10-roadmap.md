# 10 — Development Roadmap

> **Re-cut for solo development ([DL-3](./12-decisions-log.md)) and a reduced launch
> scope ([DL-4](./12-decisions-log.md)).** Each phase ends at a state you can actually
> look at and use — not a half-finished layer — so that progress is visible and
> reviewable by one person.

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

### Phase 0 — Requirements & clarification  ✅ **COMPLETE**
Deliverables: this documentation set. Blocking questions answered in
[12 — Decisions log](./12-decisions-log.md).

### Phase 1 — Project skeleton & architecture sign-off  ✅ **COMPLETE (2026-09-11)**
Next.js 15 app with the `app/ · src/domain · src/infra · worker/ · packages/` layout
from [01](./01-tech-stack.md); ESLint boundary rule (`src/domain` may not import Next.js);
the RTL lint rule banning physical direction classes; brand config package; ADRs for the
decisions in [11](./11-risks-and-decisions.md) and [12](./12-decisions-log.md); OpenAPI
contract v0; CI (lint, typecheck, test, migrate, `gitleaks`); `docker compose` for local
Postgres, Redis and MinIO. **No business logic yet.**
*Exit:* CI green; `docker compose up` plus one command gives a working local environment
from a clean clone; a deliberate `src/domain → next` import fails lint.

**Exit gate met.** 78 tests passing; format, lint (`--max-warnings 0`), typecheck,
Prisma schema validation, OpenAPI lint and production build all clean. Boundary
and RTL rules verified by `tests/architecture.test.ts`, which lints deliberate
violations and asserts each rule fires. Runtime verified: `/en` serves
`dir="ltr"`, `/ckb` serves `dir="rtl"`, `/` redirects to `/en`, and
`/api/v1/health` returns 200.
**Not verified here:** `docker compose up` could not be executed — the Docker
daemon is unavailable in the build sandbox. The compose file parses
(`docker compose config`) but has not been booted. **First action in Phase 2 is
to run it on a real machine.**

### Phase 2 — Database  ✅ **COMPLETE (2026-09-11)**
Full Prisma schema from [03](./03-database-architecture.md), all migrations, seed data
(countries, cities, currencies, category tree with attributes, commission rules, roles,
locales). Ledger invariant test.
*Exit:* migrations reversible; seeds idempotent; `entry_group_id` sums to zero test passes.

**Exit gate met.** 170 tests passing (12 files), ~96% coverage of domain/shared.
Migration reversal proven by applying, reversing and re-applying every migration
and asserting an identical schema snapshot. Seeds proven idempotent over three
consecutive runs. The ledger invariant is enforced by a deferred database
trigger and tested against a raw SQL connection, not only through the ORM.

**Deviations and fixes are documented** in `docs/03-database-architecture.md`
and ADR-0010: category paths use a delimited text column rather than `ltree`,
and three unique constraints required `NULLS NOT DISTINCT` because a nullable
column left them unenforced.

**Not verified:** `docker compose up` still could not be executed — no Docker
daemon in the build environment. Phase 2 was developed against a locally
installed PostgreSQL 16 instead. The compose file pins **postgres:17**, which is
therefore untested; nothing in the schema requires 17 over 16, but this must be
confirmed on a real machine.

### Phase 3 — Authentication & roles  ✅ **COMPLETE (2026-09-11)**
Register, verify email, login, refresh rotation with reuse detection, password reset,
TOTP 2FA, RBAC guards, ownership guards, rate limiting, audit interceptor, session
management.
*Exit:* authorisation test matrix (every role × every protected route) passes; a
deliberate IDOR attempt returns 403/404 for every owned resource.

### Phase 4 — Listings, categories, search  ✅ **COMPLETE (2026-09-11)**
Category & attribute admin CRUD, listing create/edit with dynamic category fields,
image pipeline, publish/expire lifecycle, browse, filter, faceted search, SEO
(sitemap, structured data, `hreflang`, canonicals), category and country landing pages.
*Exit:* a listing can be created in each of the four locales and found by keyword,
category, country, price and a category-specific attribute; Lighthouse SEO ≥ 95;
p95 search latency < 300 ms on 100k seeded listings.
*4b (conditional):* migrate search to Typesense/Meilisearch if quality or latency fails.

**Exit gate met for the scope that was approved.** 590 tests passing across 23
files; format, lint (`--max-warnings 0`), typecheck, migration reversibility,
OpenAPI lint and the production build all clean. Verified against a running
server with a real listing: create → upload an image → publish → find it by
keyword, by category, by price range, by an ENUM attribute and by a numeric
attribute range; a stale slug 308-redirects to the canonical URL; the served
WebP derivative carries no EXIF and no GPS.

**Carried into Phase 5, deliberately.** Three exit-gate items are NOT met and
are not claimed:

- **No seller dashboard in the browser.** The listing lifecycle is complete and
  tested through the authenticated API, but the web app has no signed-in
  session: Phase 3 issues bearer tokens, and a browser session is an
  auth-transport decision (`HttpOnly` cookies, CSRF defence, refresh rotation)
  that belongs with the account UI. Holding an access token in
  JavaScript-reachable storage to ship a form sooner would hand any XSS a full
  session. `/[locale]/sell` says this plainly rather than showing a form that
  cannot submit.
- **No E2E suite.** The gate calls for E2E from this phase. The verification
  above was performed by hand against a running build, which is evidence but is
  not a regression test. Playwright is installed in the sandbox; wiring it into
  CI is the first Phase 5 task.
- **No Lighthouse score and no 100k-listing latency measurement.** Both need an
  environment this phase has not had: a seeded dataset at scale and a browser
  harness. The search adapter is written for it — keyset pagination, a capped
  count, GIN indexes on the tsvector and on the attribute JSONB — but "written
  for it" is not "measured", and it is not being reported as measured.

### Phase 5 — Seller dashboard & browser sessions  ✅ **COMPLETE (2026-09-11)**
Seller profile, business profile, public profile pages, listing management, buyer
dashboard, favourites, saved searches, notification centre, notification preferences.
*Exit:* full E2E journey — register → become seller → publish → another user finds it.

**Delivered:** cookie session transport (ADR-0012), CSRF, sign-up/verify/sign-in/
sign-out, seller dashboard (overview, listings, create/edit, images,
publish/pause/sold, profile, session visibility), 25 Playwright E2E tests, CI
E2E job.

**NOT delivered, carried to a later phase:** buyer dashboard, favourites, saved
searches, notification centre and preferences, business profile, public seller
profile pages. Phase 5's scope as approved was the SELLER dashboard and the
browser authentication transport; those items were not in it.

### Phase 6 — Messaging & offers  ✅ **COMPLETE (2026-09-12)**
Realtime conversations, read receipts, attachments, block, report, offer lifecycle
(make/counter/accept/decline/expire), risk scoring feeding the moderation queue.
*Exit:* message delivery survives a server restart; offer state machine fully tested
including expiry and the single-use constraint.

**Delivered:** buyer-to-seller conversations with per-participant read state and
keyset-paginated history; plain-text message safety with risk SCORING (never
blocking, never silent rewriting); reporting that marks a thread and deletes
nothing; an explicit offer state machine driven by a transition table, with an
append-only `offer_events` audit trail enforced by database triggers; inbox,
thread, contact, offer list and offer detail pages; account-keyed rate limits on
every messaging and offer write. 759 unit/integration tests and 40 Playwright
E2E tests pass.

**NOT delivered, and not claimed:**

- **No realtime.** Messages arrive on a page load, not over a socket. Nothing in
  this phase pushes; the read model and the pagination are built so that a
  transport can be added without changing them.
- **"Delivery survives a server restart" is proven only by durability.** Messages
  are committed to Postgres inside a transaction, so no restart test was needed
  to know they persist — but there is no queued-delivery mechanism to survive a
  restart, because there is no queue.
- **No attachments and no block.** Images in messages and blocking a
  counterparty were in the phase description and not in the approved Phase 6
  scope, so neither was built. `ConversationStatus.BLOCKED` exists in the enum
  and the composer already refuses on it; nothing sets it yet.
- **No counter-offers.** `COUNTERED` is in the enum with NO transitions into it,
  deliberately: an unreachable state is honest about what is not built.
- **No moderation queue UI.** Risk scores and reports are recorded for a
  reviewer who has no screen yet. That was an explicit scope boundary.
- **No money, anywhere.** An accepted offer records agreement. It creates no
  order, no payment, no ledger entry and no payout, and a test asserts that.

### Phase 7 — Stripe Connect  ⚠️ the highest-risk phase  ← **Parts 1 and 2 complete (TEST MODE), Part 3 not started**

**Part 1 delivered (2026-09-12):** the `stripe` package behind a
`PaymentGateway` port; orders priced entirely server-side; BUY_NOW destination
charges with `application_fee_amount`; FEE_ONLY plain charges with no transfer
leg; database-durable idempotency; a raw-body, signature-verified webhook with
three independent layers of duplicate protection; the Order / Payment /
PaymentAttempt state machines. 856 tests pass.

**Part 2 delivered (2026-09-12):** a `ConnectGateway` port with a Stripe
adapter; server-side connected-account creation under a deterministic
idempotency key; Stripe-hosted onboarding links, minted fresh every time;
`account.updated` handling that is out-of-order safe and cannot re-enable a
rejected seller; `charge.*` handling that completes a PaymentAttempt with the
REAL provider fee and net from an expanded balance transaction; seller
eligibility hardened to include outstanding requirements; a seller payouts page
in four languages. 917 tests and 49 E2E tests pass.

**Part 2 did NOT deliver, and does not claim to:** any payment UI, payouts,
refunds, disputes, reconciliation, or a single real payment. **The real Stripe
API was never called, and no webhook was ever received from Stripe** — this
environment has no credentials and no Stripe CLI, so
`tests/api/stripe-live.test.ts` is written and SKIPPED. See
[16 — Phase 7 Part 2](./16-phase-7-part-2.md) for exactly what is unverified.


**Gate report:** [15 — Phase 7 gate](./15-phase-7-gate.md) · **ADR:** [0013](./adr/0013-phase-7-payment-architecture.md)
Architecture decided against Stripe documentation re-verified on 2026-09-12.
Classified **B — implementation-ready but Stripe business approval still
required**. Test-mode build may proceed; **live mode is blocked** until written
Stripe approval exists (R-3). No payment code, package, migration or webhook
route exists.
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

## Honest timeline — solo, reduced launch scope

| Milestone | Phases | Estimate |
|---|---|---|
| Browsable marketplace (no payments) | 1–5 | **2–3 months** |
| Payable MVP, ready for a soft launch | 1–8 | **4–7 months** |
| Trust & safety complete | 1–9 | +1–2 months |
| The full brief (subscriptions, ads, analytics, hardening) | 1–14 | **12–24 months** |

Those are estimates for consistent, focused work with Claude Code doing the
implementation. They assume the reduced launch scope; they do not assume evenings only.

Running in parallel, and **not optional**, none of which is engineering time:
- Stripe platform profile and **written** approval of the model (blocks Phase 7 — start now)
- UK legal review: seller agreement, terms, privacy policy, fee-only disclosure, DSA duties
- Tax adviser on VAT and the marketplace's supplier status
- Native Sorani and Kurmanji review of the UI copy
- An external penetration test before taking real money

### Where a solo build usually goes wrong, and the guard for each

| Failure mode | Guard built into this plan |
|---|---|
| Building admin tooling before anything works | Admin CRUD only where a phase needs it; no speculative screens |
| Payment code written once, never tested against failure | Phase 7 exit gate requires replayed webhooks, forged signatures and timeout-retry to be proven safe |
| Schema drift and manual production SQL | Every change is a migration; CI runs them forward and back |
| i18n retrofitted late | Locale routing and the RTL lint rule land in **Phase 1**, before any UI exists |
| Money bugs found in production | Double-entry ledger with a zero-sum invariant test from Phase 2, reconciled nightly from Phase 8 |
| Losing all context after a break | This documentation set, kept current as code lands (R-14) |

**Start the Stripe platform profile this week.** It is the only dependency that can
block Phase 7 entirely and it is completely outside your control.
