-- Phase 4: listing search vector and the image upload pipeline.
--
-- ⚠️ HAND-EDITED, twice over:
--
-- 1. `prisma migrate dev` again generated DROP INDEX for the three raw-SQL
--    indexes created in Phase 2 (listings_attributes_gin, listings_title_trgm,
--    seller_profiles_display_name_trgm). Its diff cannot see objects absent
--    from schema.prisma and reads them as drift. The drops were REMOVED.
--    `pnpm check:migrations` now fails the build if they ever reappear.
--
-- 2. `listing_images.updated_at` was generated NOT NULL with no default, which
--    fails on a table that already has rows. A DEFAULT was added.

/*
  Warnings:

  - Added the required column `updated_at` to the `listing_images` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "image_upload_status" AS ENUM ('PENDING_UPLOAD', 'PROCESSING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "listing_images" ADD COLUMN     "byte_size" INTEGER,
ADD COLUMN     "checksum_sha256" TEXT,
ADD COLUMN     "content_type" TEXT,
ADD COLUMN     "failure_reason" TEXT,
ADD COLUMN     "processed_at" TIMESTAMPTZ(6),
ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "upload_status" "image_upload_status" NOT NULL DEFAULT 'PENDING_UPLOAD',
ADD COLUMN     "variants" JSONB NOT NULL DEFAULT '{}',
ALTER COLUMN "url" SET DEFAULT '';

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "search_document" tsvector;

-- CreateIndex
CREATE INDEX "listing_images_upload_status_created_at_idx" ON "listing_images"("upload_status", "created_at");

-- ─────────────────────────────────────────────────────────────────────────────
-- Full-text search
--
-- The search vector is maintained by a TRIGGER rather than by application code,
-- so it cannot drift from the row it describes — an edit that forgets to
-- reindex is not possible.
--
-- Configuration is `simple`, NOT `english`. PostgreSQL has no Kurdish
-- dictionary, and English stemming applied to Sorani or Kurmanji produces
-- nonsense. `simple` plus `unaccent` plus the trigram indexes from Phase 2 is
-- the honest compromise for launch, and the main reason a dedicated search
-- engine is on the roadmap for Phase 4b (ADR-0003).
--
-- Weights: title (A) outranks description (B), which outranks attribute
-- values (C).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION kurdora_listing_search_document()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  attribute_text text;
BEGIN
  -- Flatten attribute VALUES only. Including the keys would make every diesel
  -- car match a search for "fuel".
  SELECT coalesce(string_agg(value, ' '), '')
    INTO attribute_text
    FROM jsonb_each_text(COALESCE(NEW."attributes", '{}'::jsonb)) AS entries(key, value);

  NEW."search_document" :=
      setweight(to_tsvector('simple', unaccent(coalesce(NEW."title", ''))), 'A')
   || setweight(to_tsvector('simple', unaccent(coalesce(NEW."description", ''))), 'B')
   || setweight(to_tsvector('simple', unaccent(attribute_text)), 'C');

  RETURN NEW;
END;
$$;

CREATE TRIGGER "listings_search_document"
  BEFORE INSERT OR UPDATE OF "title", "description", "attributes"
  ON "listings"
  FOR EACH ROW EXECUTE FUNCTION kurdora_listing_search_document();

CREATE INDEX "listings_search_document_gin"
  ON "listings" USING GIN ("search_document");

-- Backfill anything already present.
UPDATE "listings" SET "title" = "title";

-- Facet counts and sorted browse both scan active listings by category and
-- country; a covering partial index keeps that off the full table.
CREATE INDEX "listings_active_price"
  ON "listings" ("category_id", "country_id", "price_minor")
  WHERE "status" = 'ACTIVE' AND "deleted_at" IS NULL;

-- Only READY images are ever served, so the join that builds a results page
-- should not walk the pending and failed ones.
CREATE INDEX "listing_images_ready"
  ON "listing_images" ("listing_id", "position")
  WHERE "upload_status" = 'READY' AND "moderation_status" = 'APPROVED';
