-- Reverses 'offer_status_values'.
--
-- Enum values cannot be dropped in PostgreSQL, so the type is rebuilt. Rows
-- holding a removed value are mapped to their nearest Phase 2 equivalent
-- rather than destroyed:
--   DRAFT, SUBMITTED -> PENDING    (SUBMITTED was renamed from PENDING)
--   CANCELLED        -> WITHDRAWN  (the closest Phase 2 terminal state)

ALTER TABLE "offers" ALTER COLUMN "status" DROP DEFAULT;

-- `offers_one_pending_per_buyer_listing` is a PARTIAL index, and its predicate
-- compares the status column to a literal of the current enum type. Changing
-- the column's type leaves that comparison between two different types
-- ("operator does not exist: offer_status_old = offer_status"), so the index is
-- dropped here and rebuilt below against the restored type. Plain b-tree
-- indexes on the column need no such handling — they carry no predicate.
DROP INDEX IF EXISTS "offers_one_pending_per_buyer_listing";

CREATE TYPE "offer_status_old" AS ENUM (
  'PENDING', 'ACCEPTED', 'DECLINED', 'COUNTERED', 'WITHDRAWN', 'EXPIRED', 'CONVERTED'
);

ALTER TABLE "offers"
  ALTER COLUMN "status" TYPE "offer_status_old"
  USING (
    CASE "status"::text
      WHEN 'DRAFT'     THEN 'PENDING'
      WHEN 'SUBMITTED' THEN 'PENDING'
      WHEN 'CANCELLED' THEN 'WITHDRAWN'
      ELSE "status"::text
    END
  )::"offer_status_old";

DROP TYPE "offer_status";
ALTER TYPE "offer_status_old" RENAME TO "offer_status";

ALTER TABLE "offers" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- Rebuilt exactly as migration 20260911050145 created it.
CREATE UNIQUE INDEX "offers_one_pending_per_buyer_listing"
  ON "offers" ("listing_id", "buyer_id")
  WHERE "status" = 'PENDING';
