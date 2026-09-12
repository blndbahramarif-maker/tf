-- Phase 6, part 1 of 2 — offer_status values only.
--
-- This is deliberately its own migration. PostgreSQL refuses to USE a newly
-- added enum value in the same transaction that adds it ("unsafe use of new
-- value ... New enum values must be committed before they can be used"), and
-- part 2 creates a partial index whose predicate names DRAFT. Splitting is the
-- supported way to do this; the alternative is a migration that only works on
-- a database where the value already exists, which is drift waiting to happen.
--
-- The rename preserves data. `prisma migrate dev` proposed dropping and
-- recreating the type to remove PENDING, which would have destroyed every
-- existing offer row. PENDING and SUBMITTED are one state under two names.

ALTER TYPE "offer_status" RENAME VALUE 'PENDING' TO 'SUBMITTED';

ALTER TYPE "offer_status" ADD VALUE 'DRAFT' BEFORE 'SUBMITTED';
ALTER TYPE "offer_status" ADD VALUE 'CANCELLED' BEFORE 'CONVERTED';
