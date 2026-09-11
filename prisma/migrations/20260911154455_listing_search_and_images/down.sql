-- Down migration for: listing_search_and_images

DROP INDEX IF EXISTS "listing_images_ready";
DROP INDEX IF EXISTS "listings_active_price";
DROP INDEX IF EXISTS "listings_search_document_gin";

DROP TRIGGER IF EXISTS "listings_search_document" ON "listings";
DROP FUNCTION IF EXISTS kurdora_listing_search_document();

DROP INDEX IF EXISTS "listing_images_upload_status_created_at_idx";

ALTER TABLE "listings" DROP COLUMN IF EXISTS "search_document";

ALTER TABLE "listing_images" DROP COLUMN IF EXISTS "variants";
ALTER TABLE "listing_images" DROP COLUMN IF EXISTS "upload_status";
ALTER TABLE "listing_images" DROP COLUMN IF EXISTS "updated_at";
ALTER TABLE "listing_images" DROP COLUMN IF EXISTS "processed_at";
ALTER TABLE "listing_images" DROP COLUMN IF EXISTS "failure_reason";
ALTER TABLE "listing_images" DROP COLUMN IF EXISTS "content_type";
ALTER TABLE "listing_images" DROP COLUMN IF EXISTS "checksum_sha256";
ALTER TABLE "listing_images" DROP COLUMN IF EXISTS "byte_size";
ALTER TABLE "listing_images" ALTER COLUMN "url" DROP DEFAULT;

DROP TYPE IF EXISTS "image_upload_status";
