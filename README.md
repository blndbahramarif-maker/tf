# Kurdora

A multi-vendor marketplace for Kurdish communities across Europe.

> **Status: Phase 1 — project skeleton.**
> No marketplace features are implemented yet: no database models, no
> authentication, no listings, no payments. This repository currently contains
> the foundation (structure, contracts, tooling, CI) and the planning
> documentation. See [`docs/10-roadmap.md`](./docs/10-roadmap.md).
>
> "Kurdora" is a working brand name, isolated in `packages/brand` so it can be
> changed without touching application code.

## Quick start

```bash
pnpm install
cp .env.example .env.local
pnpm docker:up          # Postgres 17, Redis 7, MinIO, Mailpit
pnpm env:check
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
prisma/       schema and migrations
openapi/      API contract (authoritative, linted in CI)
docs/         architecture, payments, security, roadmap, ADRs
```

Dependencies point inward only: `app → lib → infra → domain → shared`.
This is enforced by ESLint and verified by `tests/architecture.test.ts`.

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
