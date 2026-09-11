# 02 — System Architecture

> **Adjusted for the lean stack ([DL-3](./12-decisions-log.md)).** The component
> diagram below shows the *logical* architecture, which is unchanged. Physically,
> `kurdora.com` and `api.kurdora.com` are **one Next.js deployment** (the API lives at
> `/api/v1/*`), and the admin console is a route group rather than a separate app.
> The worker fleet **remains a separate process** — that one is a correctness
> requirement, not a scale optimisation. Everything else on this page — module
> boundaries, domain events and the outbox, the request lifecycle, caching, the scaling
> path — applies exactly as written, because `src/domain` is framework-free and does
> not care how it is deployed.

## Component view

```
                        ┌──────────────── CDN / WAF / DDoS edge ────────────────┐
                        │                                                        │
   Browser ─────────────┤  kurdora.com          (Next.js web — SSR/ISR)          │
   Mobile app (future) ─┤  api.kurdora.com      (NestJS REST + WS)               │
   Platform staff ──────┤  admin.kurdora.com    (Next.js admin, 2FA enforced)    │
   Stripe ──────────────┤  api.kurdora.com/webhooks/stripe   (raw body, signed)  │
                        │  cdn.kurdora.com      (user images — cookieless origin) │
                        └────────────────────────────────────────────────────────┘
                                             │
        ┌────────────────────────────────────┼────────────────────────────────────┐
        │                                    │                                    │
   PostgreSQL 17                        Redis 7                          Object storage (S3/R2)
   (primary + read replica)      cache · queues · rate limit · WS pubsub    originals + derivatives
        │
   Search index (Postgres FTS → Typesense at Phase 4b)

   Worker fleet (BullMQ): webhooks · payouts · email · images · indexing · analytics · expiry
```

**The web app never talks to Postgres or Stripe directly.** All data access is through
the API. This is what makes a mobile app a client rather than a rewrite, and it keeps
exactly one code path for authorisation.

## Module boundaries (`src/domain`)

Grouped by bounded context. Modules communicate through service interfaces and domain
events, not by reaching into each other's tables.

| Context | Modules |
|---|---|
| Identity | `auth`, `users`, `sessions`, `rbac`, `two-factor` |
| Selling | `seller-profiles`, `businesses`, `verification`, `subscriptions` |
| Catalogue | `categories`, `attributes`, `listings`, `media`, `geo` (countries/cities) |
| Discovery | `search`, `saved-searches`, `recommendations` (later) |
| Interaction | `conversations`, `messages`, `offers`, `favourites` |
| Commerce | `orders`, `payments`, `commissions`, `payouts`, `refunds`, `disputes`, `ledger` |
| Trust | `reviews`, `reports`, `moderation`, `sanctions` (bans/suspensions) |
| Monetisation | `promotions` (featured listings), `advertisements`, `billing` |
| Platform | `notifications`, `settings`, `translations`, `audit`, `analytics`, `admin` |
| Integration | `stripe` (single gateway — the only module importing the Stripe SDK) |

**Rule: exactly one module imports the Stripe SDK.** Everything else depends on
domain interfaces (`PaymentGateway`, `PayoutGateway`, `OnboardingGateway`). This makes
the payment code independently testable and means a provider change is contained.

## Domain events

Emitted transactionally via an **outbox table** (written in the same DB transaction as
the state change, relayed to the queue by a worker). Without an outbox you eventually
get an order marked paid with no notification sent, or a notification for an order
that rolled back.

Examples: `listing.published`, `offer.accepted`, `order.paid`, `payout.settled`,
`review.created`, `report.filed`, `seller.verification.updated`.

Consumers: notifications, search indexing, analytics rollups, moderation queue.

## Request lifecycle (API)

```
Edge (WAF, IP rate limit)
  → Helmet security headers
  → CORS allowlist (exact origins, credentials true)
  → Body parser (raw body preserved ONLY for /webhooks/stripe)
  → Correlation-ID + structured logging
  → Rate limiter (per IP + per user + per route class)
  → Auth guard (JWT verify) → RBAC guard (permission check) → Ownership guard
  → Idempotency interceptor (POST/PATCH with Idempotency-Key)
  → Zod validation (shared schema)
  → Controller → Service (domain logic) → Repository (Prisma)
  → Audit interceptor (writes audit_logs for mutating admin/money actions)
  → Response serialiser (explicit allowlist of fields — never leak raw entities)
```

The serialiser is an allowlist, not a denylist. Adding a column to `users` must never
be able to accidentally expose it through an API response.

## Caching strategy

| Layer | What | Invalidation |
|---|---|---|
| CDN | Images, static assets, public category pages | Content-hash / tag purge on publish |
| Next.js ISR | Home, category, country landing pages | Tag-based revalidation on `listing.published` |
| Redis | Category tree, settings, commission rules, exchange rates, session lookups | Explicit bust on admin write |
| Postgres | Materialised views for admin analytics | Scheduled refresh (worker) |

Never cache: anything authenticated, anything price/availability-critical at checkout,
anything payment-state related. Checkout always reads from the primary.

## Scaling path

Sequenced by what actually breaks first:
1. Read replica for listing/search reads.
2. Dedicated search engine (Phase 4b).
3. Separate worker fleet (already separate at day one).
4. Partition `messages`, `notifications`, `audit_logs`, `payment_events` by month.
5. Regional CDN for images (day one, it is free).

## Environments

`local` → `test` (CI, ephemeral DB) → `staging` (Stripe **test mode**, seeded data)
→ `production` (Stripe live mode).

`STRIPE_MODE` is explicit, stored on every payment row as `livemode`, and the UI shows
a persistent banner in non-production. A test-mode payment can never be reconciled
against a live payout, and the schema enforces this.
