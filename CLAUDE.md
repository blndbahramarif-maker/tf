# Kurdora — working conventions

Read `docs/README.md` before making architectural changes. Read
`docs/12-decisions-log.md` for the decisions that are already settled.

## Current state

**Phase 3 complete: authentication and authorization.** The schema, migrations,
seeds, double-entry ledger, auth flows, RBAC guards, rate limiting and audit
logging exist. There is still no marketplace UI: no listings, no search, no
messaging, no payments. Phase 4 (listings) has not started.
See `docs/10-roadmap.md`.

## Commands

```bash
pnpm docker:up        # Postgres, Redis, MinIO, Mailpit
pnpm env:check        # validate .env.local
pnpm db:deploy        # apply migrations
pnpm db:seed          # seed configuration (idempotent)
pnpm dev              # http://localhost:3000/en
pnpm worker           # background worker (separate process)

pnpm verify           # format + lint + typecheck + test + openapi  ← run before every commit
```

Database tests (`tests/db/*`) only run when `TEST_DATABASE_URL` is set. They
create and drop their own throwaway databases — point it at a local server only.

```bash
pnpm db:migrate            # create + apply a migration in development
pnpm db:migrate:down       # reverse the most recent migration
pnpm db:reset              # drop, re-apply, re-seed (local only)
```

## Non-negotiables

These are enforced by lint or by tests. Do not work around them; if one is
genuinely wrong, change the rule deliberately and write an ADR.

1. **`src/domain` must not import Next.js, React, next-intl, Prisma or Stripe.**
   Depend on a port interface; implement it in `src/infra`. (ADR-0002)
2. **Only `src/infra/stripe` may import the Stripe SDK.**
3. **Money is integer minor units (`BigInt`), rates are basis points.**
   No floats, no `parseFloat`, no decimal percentages. (ADR-0006)
4. **Logical CSS properties only** — `ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`.
   Never `ml-`, `pl-`, `left-`, `text-left`. RTL breaks silently otherwise. (ADR-0005)
5. **No hard-coded UI text.** Everything through `@kurdora/i18n` catalogues.
6. **No hard-coded brand name.** Use `@kurdora/brand` or interpolate `{brandName}`.
7. **No hard-coded categories, commission rates or prices.** They are data,
   editable by an admin without a deploy.
8. **Secrets are server-side only.** Never `NEXT_PUBLIC_*`, never in a client
   component, never logged.
9. **Payment state comes only from verified webhooks.** Never trust the browser.
10. **Database changes are migrations.** Never manual production DDL, and
    **every migration ships a `down.sql`** — the migration tests fail without one.
11. **Invariants belong in the database as well as the domain.** Money rules are
    CHECK constraints and triggers, not only TypeScript (ADR-0010). Application
    checks bind only code that goes through them.
12. **The ledger is append-only and must balance.** Every money movement is a
    balanced entry group; use the recipes in `src/domain/ledger/postings.ts`
    rather than writing entries by hand.
13. **Every protected route declares a permission.** An empty requirement is
    DENIED — that is the deny-by-default rule, not an oversight to work around.
14. **Identity comes from the bearer token, never from the request.** No route
    may accept a user id from a path, query or body as proof of who is calling.
15. **Every id-addressed route verifies ownership** against the database, and
    answers `notFound(request)` — never 403 — when the caller is not the owner.
    A 403 there confirms the resource exists and enumerates other people's ids.
16. **Validate an id with `isUuid()` before querying.** An unparseable id makes
    Postgres throw and leaks a database error in a 500.

## Adding things

**A language:** one entry in `packages/i18n/src/index.ts` + one catalogue file.
Set `enabled: true` only after native-speaker review.

**An API endpoint:** define the schema in `src/shared`, document it in
`openapi/openapi.yaml`, implement in `app/api/v1/`, use `src/lib/api/respond.ts`
for the envelope. Money-moving endpoints require `Idempotency-Key`.

**Business logic:** it goes in `src/domain`, with unit tests that need no
database.

**A money movement:** add a recipe to `src/domain/ledger/postings.ts` with a
test proving it balances. Never insert ledger entries ad hoc.

**A database constraint:** put it in a migration with matching `down.sql`, and
add a test in `tests/db/constraints.test.ts` that writes something which should
be impossible and asserts the database refuses it.

**A protected route:** declare its permission requirement, add a row to
`CASES` in `tests/api/authorization-matrix.test.ts` with the expected status for
EVERY role, and — if it is addressed by id — add an IDOR test in
`tests/api/idor.test.ts` asserting 404 and that the victim's data is unchanged.

**A permission:** add it to `PERMISSIONS` in `prisma/seed/data.ts` and grant it
to the roles that need it. The seed REVOKES grants removed from the definition,
so privileges cannot quietly accumulate.

## Honesty rules

- Do not mark a feature complete unless it actually works and is tested.
- Label mock and test-mode code as such, in the code and in any summary.
- **Never claim Stripe has approved the business model.** Written confirmation
  does not exist yet (R-3, ADR-0007).
- Re-verify Stripe API behaviour against official documentation before writing
  payment code. Do not rely on memory or on what this repository's docs say.
