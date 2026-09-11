# 01 — Technology Stack

Every choice below is justified against Kurdora's actual constraints, not popularity.
Where I rejected a popular option, the reason is stated.

## Hard constraints that drive the choices

| Constraint | Consequence |
|---|---|
| Listings must rank in Google, per-country and per-language | Server-rendered HTML, not a client-only SPA |
| Native iOS/Android later on the same backend | The API cannot be a web-only RPC layer; it needs a stable, versioned, documented HTTP contract |
| 4 languages, 2 writing directions, more later | i18n at the routing/layout level, not a bolt-on |
| Real money, multi-party, EU regulated | Strong typing, migrations, audit trail, integer money, transactional integrity |
| Category-specific listing fields | Dynamic attributes with fast faceted filtering |
| Small team | Boring, well-documented technology with one language across the stack |

## Recommended stack

### Language: TypeScript everywhere
One language for web, API, shared validation schemas and future React Native.
Validation schemas (Zod) are written once in `packages/shared` and reused by the API
(runtime validation), the web app (form validation) and generated OpenAPI types.
This eliminates the single most common marketplace bug class: client and server
disagreeing about what a valid listing/order/offer looks like.

*Rejected:* Python/Django and Ruby on Rails. Both are excellent and would ship an
admin panel faster. Rejected because the duplicated validation logic between a Python
API and a TypeScript frontend/mobile app is a permanent tax, and because Stripe +
realtime messaging + SSR are all first-class in Node.

### Frontend: Next.js 15 (App Router) + React 19 + TypeScript
- Server Components + streaming SSR give crawlable HTML with a fast first paint.
- Per-route caching and ISR suit a marketplace: category pages cached, listing
  detail revalidated, dashboards dynamic.
- `next-intl` handles locale routing (`/[locale]/...`), ICU MessageFormat, and
  per-locale metadata/`hreflang` (see [09](./09-i18n-rtl.md)).
- Image optimisation, `next/font`, route-level code splitting are built in.

*Rejected:* Remix (smaller ecosystem for our i18n/SEO needs), Astro (weaker for the
heavily interactive dashboard/messaging half), plain SPA (fatal for SEO).

### Styling: Tailwind CSS v4 + shadcn/ui (Radix primitives)
Radix primitives are accessible by default (focus management, ARIA, keyboard) which
directly serves the accessibility requirement. Tailwind's **logical properties**
(`ps-*`, `pe-*`, `ms-*`, `me-*`, `start-*`, `end-*`) make RTL a configuration concern
rather than a second stylesheet. We add an ESLint rule that **bans physical direction
classes** (`ml-`, `pl-`, `left-`, `text-left`) so RTL cannot silently regress.

### Backend API: NestJS (Node 22) — separate deployable service
A separate API service, not Next.js server actions, because:
1. Mobile apps and any future partner integration need the same contract.
2. Money-handling code should not be co-deployed with the SEO/render layer; they
   have different scaling, restart and blast-radius profiles.
3. NestJS's module boundaries, dependency injection, guards and interceptors are a
   good fit for ~30 bounded modules (listings, offers, orders, payments, payouts,
   moderation, …). Cross-cutting concerns — RBAC guard, audit interceptor,
   idempotency interceptor, rate limiter — are declarative and testable.
4. First-class OpenAPI generation → typed web client + typed mobile client, free.

*Rejected:* tRPC alone (no stable contract for non-TS consumers); bare Express (at this
domain size the lack of enforced structure becomes the bottleneck); Next.js-only
monolith — **but see the "Lean alternative" below, which may be right for you.**

### Database: PostgreSQL 17
Non-negotiable for money. We need transactions, foreign keys, `CHECK` constraints,
`NUMERIC`/`BIGINT` exactness, partial and expression indexes, `JSONB` + GIN for
dynamic category attributes, and full-text search for the MVP. One engine covers
relational integrity *and* flexible attributes *and* early search.

*Rejected:* MongoDB — a marketplace ledger without transactional referential
integrity is a liability, not a feature.

### ORM: Prisma 6 (+ raw SQL escape hatch)
Type-safe queries, a first-class migration workflow (`prisma migrate`, required by
your rule "use migrations for database changes"), and readable schema-as-code.
Faceted search, analytics rollups and ledger queries are written as **reviewed raw
SQL** via `$queryRaw` — ORMs generate poor SQL for those, and money reporting should
be legible to a human auditor.

*Alternative worth considering:* Drizzle ORM, if we find Prisma's query planner
limiting for attribute filtering. Decision point at Phase 4.

### Cache, queues, rate limiting: Redis 7 + BullMQ
Background jobs are mandatory here, not optional: Stripe webhook processing, payout
reconciliation, email, image derivative generation, search indexing, notification
fan-out, scheduled listing expiry, subscription renewals. BullMQ gives retries with
exponential backoff, dead-letter queues and scheduled/repeatable jobs.

### Search: Postgres FTS first → dedicated engine at Phase 4b
Start with `tsvector` + `pg_trgm` behind a `SearchPort` interface. Migrate to
**Typesense** or **Meilisearch** when either (a) result quality for Arabic-script
Sorani/Arabic becomes the complaint, or (b) facet queries exceed ~150 ms p95.

Important: **Postgres has no Kurdish text-search dictionary.** Sorani (Arabic script)
and Kurmanji (Latin script) are different scripts and are *not* mutually intelligible
in writing. MVP uses the `simple` configuration + `unaccent` + trigram similarity, and
we index a per-locale normalised search document. This is a known quality compromise
and is the main reason a dedicated search engine is on the roadmap.

### Object storage + CDN: S3-compatible (Cloudflare R2 or AWS S3) + CDN
Browser uploads go **direct to storage via short-lived presigned URLs** — image bytes
never transit the API. A worker then validates and re-encodes (see [08](./08-security-architecture.md)).
User content is served from a **separate cookieless domain**, never the app origin.

### Auth: implemented in the API (Argon2id + rotating refresh tokens)
Owned rather than outsourced, because seller lifecycle state (KYC status, payout
capability, suspension, subscription tier) is deeply entangled with authorisation and
must be transactional with our own data. No per-MAU cost at marketplace scale.
Non-negotiable guardrails in [08](./08-security-architecture.md): Argon2id, refresh
token rotation with reuse detection, mandatory TOTP for admins, step-up auth for money
operations. **See open decision D-3** — a managed IdP (Keycloak / WorkOS / Clerk) is a
legitimate alternative that trades control for reduced risk.

### Email / notifications
Transactional email behind a `MailPort` (Postmark or AWS SES). Web push and future
mobile push behind a `NotificationPort` so Phase 18-style push is additive.
In-app notifications are rows in our own DB — they are the source of truth.

### Realtime messaging: WebSocket gateway + Redis adapter
Socket.IO on the NestJS side with the Redis adapter for horizontal scale, with
long-poll fallback. Messages persist in Postgres first, then fan out — never the
reverse, so a dropped socket never loses a message.

### Observability: OpenTelemetry + Sentry + pino
Structured JSON logs with a correlation id per request, propagated into jobs and into
Stripe idempotency keys, so one order can be traced end to end. **Payment logs never
contain card data, tokens or full webhook payloads with PII.**

### Testing
- Vitest — unit, especially the commission engine and money arithmetic.
- Supertest + Testcontainers (real Postgres, real Redis) — integration.
- `stripe-mock` + Stripe CLI webhook replay — payment tests. **No hand-written fake
  Stripe.** Test mode is labelled in the UI and in the database (`livemode` column).
- Playwright — critical journeys, run in LTR **and RTL** locales.
- k6 — search and listing page load.

### Infrastructure
Docker images; managed Postgres and Redis; **EU/UK region hosting** for GDPR data
residency. Web on Vercel or containers; API in containers (ECS/Fly/Hetzner+Kamal).
Secrets in a managed secret store (AWS Secrets Manager / Doppler / Infisical) — never
in the repo, never in the client bundle, never in `NEXT_PUBLIC_*`.

## Repository layout (pnpm + Turborepo monorepo)

```
apps/
  web/        Next.js public marketplace + buyer/seller dashboards
  admin/      Next.js admin console (separate app, separate subdomain, no SEO)
  api/        NestJS HTTP + WebSocket API
  worker/     BullMQ job processors (shares api's domain modules)
packages/
  shared/     Zod schemas, DTOs, money utils, enums, state machines
  brand/      Brand config — name, logo, colours, domains, legal entity
  i18n/       Message catalogs (en, ckb, kmr, ar) + locale registry
  ui/         Shared React components (RTL-safe)
  config/     eslint / tsconfig / tailwind presets
infra/        Docker, IaC, migration runners
docs/         This documentation
```

The **admin console is a separate application on its own subdomain**. This is a
security decision: it removes the admin surface from the public app's bundle and
attack surface, and lets us apply 2FA enforcement, stricter CSP, optional IP
allowlisting and shorter sessions without compromising public UX.

## Lean alternative (if you are building solo or near-solo)

If [Q-8](./00-scope-and-open-questions.md) turns out to be "solo founder, limited
budget", the recommended stack above is roughly 2× the work. The lean variant:

- **One Next.js app** with a `/api/v1/*` route handler layer that is written to the
  same OpenAPI contract (so mobile can consume it unchanged later).
- Same Postgres, Prisma, Redis, Stripe design — **the database and payment
  architecture do not change at all**.
- Admin as a protected route group rather than a separate app (accepting the weaker
  isolation), with 2FA still mandatory.

This preserves every architectural decision that is expensive to reverse (money model,
schema, commission engine, i18n) and defers only the ones that are cheap to reverse
(process boundaries). I will recommend this path if you tell me the team is small.
