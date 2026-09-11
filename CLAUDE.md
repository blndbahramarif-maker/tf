# Kurdora — working conventions

Read `docs/README.md` before making architectural changes. Read
`docs/12-decisions-log.md` for the decisions that are already settled.

## Current state

**Phase 1 complete: project skeleton only.** There are no marketplace features,
no database models, no authentication and no payment code. Phase 2 (database)
has not started. See `docs/10-roadmap.md`.

## Commands

```bash
pnpm docker:up        # Postgres, Redis, MinIO, Mailpit
pnpm env:check        # validate .env.local
pnpm dev              # http://localhost:3000/en
pnpm worker           # background worker (separate process)

pnpm verify           # format + lint + typecheck + test + openapi  ← run before every commit
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
10. **Database changes are migrations.** Never manual production DDL.

## Adding things

**A language:** one entry in `packages/i18n/src/index.ts` + one catalogue file.
Set `enabled: true` only after native-speaker review.

**An API endpoint:** define the schema in `src/shared`, document it in
`openapi/openapi.yaml`, implement in `app/api/v1/`, use `src/lib/api/respond.ts`
for the envelope. Money-moving endpoints require `Idempotency-Key`.

**Business logic:** it goes in `src/domain`, with unit tests that need no
database.

## Honesty rules

- Do not mark a feature complete unless it actually works and is tested.
- Label mock and test-mode code as such, in the code and in any summary.
- **Never claim Stripe has approved the business model.** Written confirmation
  does not exist yet (R-3, ADR-0007).
- Re-verify Stripe API behaviour against official documentation before writing
  payment code. Do not rely on memory or on what this repository's docs say.
