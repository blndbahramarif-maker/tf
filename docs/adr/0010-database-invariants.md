# ADR-0010 — Correctness enforced by the database, not only by application code

**Status:** Accepted · 2026-09-11
**Context docs:** `docs/03-database-architecture.md`, `prisma/migrations/README.md`

## Context

Kurdora's money rules — the ledger balances, commission never exceeds the
order, an order total is the sum of its parts — are currently only reachable
through application code that does not exist yet. Once Phase 8 ships, they will
be enforced by TypeScript in `src/domain`.

That is not enough. Application checks bind only code that goes through them.
They do not bind a migration, a maintenance script, a data fix typed at a psql
prompt at 2am, or a future contributor who writes a repository method that
skips the service layer. Those are precisely the moments when money gets
corrupted, and they are also the moments when nobody is watching.

## Decision

Every invariant that would be expensive or impossible to repair is enforced in
PostgreSQL as well as in the domain layer.

**The ledger zero-sum invariant** is a `CONSTRAINT TRIGGER ... DEFERRABLE
INITIALLY DEFERRED`. It runs at COMMIT, not per statement — which is essential,
because a balanced group is inserted as several rows and is unbalanced at every
moment except the last. Each `entry_group_id` must sum to zero **per currency**;
netting GBP against EUR would silently invent an exchange rate.

**Append-only tables** (`ledger_entries`, `audit_logs`, `order_events`,
`seller_verification_events`) have a trigger that raises on UPDATE and DELETE.
Evidence that can be edited is not evidence.

**Money CHECK constraints** make impossible states unstorable:
`seller_amount_minor = total_minor − commission_amount_minor` is the important
one. If the two are ever computed independently and drift by a penny, the
INSERT fails rather than the discrepancy surviving into a payout.

**`NULLS NOT DISTINCT` unique indexes** where a nullable column would otherwise
leave the constraint unenforced.

The domain layer duplicates these checks so a mistake surfaces where it was
made, with the offending values in hand, rather than as a constraint violation
with no context. Two layers, same rule — deliberate, not redundant.

## Consequences

**Good.** The invariants hold against any client, including ones that do not
exist yet. They are testable directly (`tests/db/`), and those tests exercise
the real guarantee rather than a mock of it. Writing a data-fix script that
would corrupt the ledger simply fails.

**Bad.**
- Triggers are invisible in `schema.prisma`, so someone reading only the Prisma
  schema will not know they exist. Mitigated by `prisma/migrations/README.md`
  and by tests that assert each object is present after migration.
- The deferred trigger runs a query per inserted row. At ledger volumes this is
  irrelevant; if it ever is not, the fix is a statement-level trigger, not
  removing the check.
- Constraints make some test fixtures more work to construct. That is the
  constraint doing its job.

**Operationally.** `pnpm db:migrate:down` refuses to run under
`APP_ENV=production`. Rewinding a schema is a development tool; production
recovery is restore-from-backup.

## Alternatives rejected

- **Application-only enforcement.** Cheaper and more flexible, and it is how
  most of these bugs reach production.
- **A periodic reconciliation job instead of a trigger.** Still wanted for
  Stripe reconciliation, but it detects corruption after the fact. A constraint
  prevents it.
- **Storing signed amounts instead of amount + direction.** Simpler arithmetic,
  but it loses the explicit debit/credit reading that makes a ledger auditable,
  and it allows a "negative debit", which is meaningless.
