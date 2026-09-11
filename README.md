# Kurdora

A multi-vendor marketplace for Kurdish communities across Europe.

> **Status: Phase 3 — authentication and authorization.**
> Schema, migrations, seeds, the double-entry ledger, authentication, RBAC,
> rate limiting and audit logging exist. No marketplace UI yet: no listings,
> no search, no messaging, no payments.
> See [`docs/10-roadmap.md`](./docs/10-roadmap.md).
>
> "Kurdora" is a working brand name, isolated in `packages/brand` so it can be
> changed without touching application code.

## Quick start

```bash
pnpm install
cp .env.example .env.local
pnpm docker:up          # Postgres 17, Redis 7, MinIO, Mailpit
pnpm env:check
pnpm db:deploy          # apply migrations
pnpm db:seed            # seed configuration — idempotent, safe to re-run
pnpm dev                # http://localhost:3000/en  ·  /ckb for right-to-left
```

Verify everything the way CI does:

```bash
pnpm verify             # format + lint + typecheck + test + API contract lint
```

| Service | URL |
|---|---|
| App | http://localhost:3000/en |
| API health | http://localhost:3000/api/v1/health |
| API contract | http://localhost:3000/api/v1/openapi |
| Mailpit (captured email) | http://localhost:8025 |
| MinIO console | http://localhost:9001 |

## Layout

```
app/          routes — [locale] pages and /api/v1 handlers
src/
  shared/     pure: schemas, types, money, state machines
  domain/     business logic — framework-free, no Next/React/Prisma/Stripe
  infra/      adapters — prisma, stripe, redis, storage, mail
  lib/        web-only glue (i18n runtime, API helpers)
worker/       background jobs — a separate process by design
packages/
  brand/      brand configuration
  i18n/       locale registry + message catalogues
prisma/
  schema.prisma   55 models, 32 enums
  migrations/     every migration ships a down.sql — reversal is tested
  seed/           idempotent configuration seeds
openapi/      API contract (authoritative, linted in CI)
docs/         architecture, payments, security, roadmap, ADRs
```

Dependencies point inward only: `app → lib → infra → domain → shared`.
This is enforced by ESLint and verified by `tests/architecture.test.ts`.

## Security

Authorization is enforced server-side, deny-by-default, on every protected
route. Identity comes from the bearer token only — no route accepts a user id
from a path, query or body as proof of who is calling.

The role × protected-route matrix is executed as automated tests and written to
`test-results/authorization-matrix.txt` on every run, so it cannot drift from
the code. Deliberate IDOR attempts are tested against every owned resource.

See [`docs/adr/0011-authentication-and-authorization.md`](./docs/adr/0011-authentication-and-authorization.md).

## Money

Amounts are integer minor units in `bigint` (£50,000.00 is `5000000n`); rates are
integer basis points (0.5% is `50`). No floating point, anywhere.

Every money movement is a balanced double-entry group. A deferred database
trigger verifies at COMMIT that each entry group sums to zero **per currency**,
and `ledger_entries` refuses UPDATE and DELETE. See
[`docs/adr/0010-database-invariants.md`](./docs/adr/0010-database-invariants.md).

## Documentation

- **[`docs/README.md`](./docs/README.md)** — full index
- **[`docs/12-decisions-log.md`](./docs/12-decisions-log.md)** — settled decisions
- **[`docs/04-payments-architecture.md`](./docs/04-payments-architecture.md)** — Stripe design and the commission economics
- **[`docs/adr/`](./docs/adr/) ** — architecture decision records
- **[`CLAUDE.md`](./CLAUDE.md)** — working conventions

## Languages

English (`en`) and Kurdish Sorani (`ckb`) at launch; Kurmanji (`kmr`) and Arabic
(`ar`) are defined and routable but disabled pending native-speaker review.

Sorani is Arabic script and right-to-left; Kurmanji is Latin script and
left-to-right. They are distinct languages, not variants of one.

**The non-English catalogues in this repository are machine-assisted drafts and
are not launch quality.** See `packages/i18n/README.md`.

## Legal notice

No legal advice is given here. Areas marked `[LEGAL REVIEW]` in `docs/` require
review by a qualified UK/EU lawyer and a tax adviser before launch.

**Stripe has not approved this business model.** Written confirmation is a
prerequisite for Phase 7 and has not been obtained.
