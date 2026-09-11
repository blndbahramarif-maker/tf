# ADR-0003 — PostgreSQL with Prisma, raw SQL for money and search

**Status:** Accepted · 2026-09-11
**Context docs:** `docs/03-database-architecture.md`

## Context

Kurdora needs transactional integrity for orders and payouts, flexible
per-category listing attributes, and full-text search — initially without a
dedicated search engine.

## Decision

**PostgreSQL 17** as the only datastore at launch. It covers all three: ACID
transactions and constraints for money, `JSONB` + GIN for dynamic attributes,
and `tsvector` + `pg_trgm` for MVP search.

**Prisma** for schema definition, migrations and typed queries.

**Reviewed raw SQL via `$queryRaw`** for faceted search, ledger queries and
analytics rollups. ORMs generate poor SQL for those, and money reporting should
be legible to a human auditor.

Search sits behind a `SearchPort` interface so Typesense or Meilisearch can be
introduced (Phase 4b) without touching callers.

## Consequences

**Good.** One engine to operate and back up. Migrations are reviewable diffs.
Type safety from schema to query result.

**Bad.**
- Postgres has **no Kurdish text-search dictionary**. Sorani (Arabic script) and
  Kurmanji (Latin script) will use `simple` + `unaccent` + trigram similarity.
  This is a known quality compromise and the main trigger for Phase 4b.
- The hybrid attribute model writes each listing's attributes twice —
  normalised for integrity, `JSONB` for fast filtering — inside one transaction.

## Alternatives rejected

- **Drizzle ORM.** Closer to SQL, better for complex queries. Prisma's migration
  workflow is the deciding factor for a solo developer. Re-evaluate at Phase 4
  if attribute filtering suffers.
- **MongoDB.** A marketplace ledger without transactional referential integrity
  is a liability.
- **A search engine from day one.** More infrastructure to run before there is
  any content to search.
