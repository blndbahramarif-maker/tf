# Migrations

## Rules

1. **Every migration ships a `down.sql`.** Prisma has no native down
   migrations, so reversibility is something we own. `tests/db/migrations.test.ts`
   fails the build if any migration directory lacks one.
2. **Never edit an applied migration.** Write a new one.
3. **Custom SQL lives in migrations, not in `schema.prisma`.** CHECK
   constraints, partial and `NULLS NOT DISTINCT` unique indexes, triggers and
   functions cannot be expressed in Prisma's schema language.
4. **Anything expressible in `schema.prisma` belongs there**, so `prisma migrate
   dev` does not try to re-add it.

## Commands

```bash
pnpm db:migrate            # create + apply during development
pnpm db:deploy             # apply in CI and production
pnpm db:migrate:down       # reverse the most recent migration
pnpm db:migrate:down --steps 2
pnpm db:migrate:down --all
pnpm db:reset              # drop, re-apply, re-seed (local only)
```

`db:migrate:down` refuses to run when `APP_ENV=production`. Production recovery
is a restore-from-backup procedure, not a schema rewind.

## Migrations

### `init`
All 55 tables, 32 enums, foreign keys and Prisma-expressible indexes.
Prepends the `citext`, `pg_trgm` and `unaccent` extensions — Prisma emits
`CITEXT` for `users.email` but does not provision the extension, so without
this the first migration fails on a clean database.

### `constraints_triggers_indexes`
Everything Prisma cannot express:

| Section | What it guarantees |
|---|---|
| Money sanity | Order totals are the sum of their parts; the seller amount is exactly total − commission; no negative amounts; basis points within 0–10000 |
| Commission rules | Fixed amounts carry a currency; scopes carry their target; exactly one active platform default |
| Partial unique indexes | One primary image per listing; one open order per buyer per listing; one pending offer per buyer per listing |
| Domain CHECKs | Ratings 1–5; no self-blocking or self-conversation; exactly one typed attribute value; uppercase currency codes |
| Append-only | `ledger_entries`, `audit_logs`, `order_events`, `seller_verification_events` refuse UPDATE and DELETE |
| **Ledger balance** | A deferred constraint trigger verifies at COMMIT that every `entry_group_id` sums to zero per currency |
| Search indexes | GIN on listing attributes, trigram on titles, partial indexes for hot queries |
| `NULLS NOT DISTINCT` | Fixes three unique constraints that a nullable column left unenforced |

## Why `NULLS NOT DISTINCT` matters

In SQL, `NULL <> NULL`, so a plain unique index containing a nullable column
does **not** prevent duplicates when that column is null. Prisma's `@@unique`
emits exactly such an index. Three constraints were silently unenforced:

- `settings(key, scope, scope_id)` — `scope_id` is null for global settings
- `conversations(listing_id, buyer_id, seller_id)` — null off-listing
- `listing_attribute_values(listing_id, attribute_definition_id, option_id)`

The third was the dangerous one: a listing could hold two different values for
the same attribute, so a car could be both 20,000 and 90,000 miles. Covered by
`tests/db/constraints.test.ts`.

## Known caveat

`prisma migrate dev` diffs `schema.prisma` against the database and does not
know about objects it cannot represent. It has not tried to drop our triggers
or CHECK constraints, but **always read the generated SQL before applying it**.
If a future Prisma version starts dropping them, the migration tests will fail
first — which is what they are for.
