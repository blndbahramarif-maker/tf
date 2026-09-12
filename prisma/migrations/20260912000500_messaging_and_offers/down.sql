-- Reverses 'messaging_and_offers'. The enum values are reversed by the
-- down migration of 'offer_status_values', which runs after this one.

DROP INDEX IF EXISTS "messages_conversation_keyset";
DROP INDEX IF EXISTS "messages_conversation_sender_created";

DROP TRIGGER IF EXISTS "offer_events_no_delete" ON "offer_events";
DROP TRIGGER IF EXISTS "offer_events_no_update" ON "offer_events";
DROP TABLE IF EXISTS "offer_events";
DROP FUNCTION IF EXISTS kurdora_offer_events_append_only();

DROP INDEX IF EXISTS "offers_listing_open";

ALTER TABLE "offers" DROP COLUMN IF EXISTS "cancelled_at";
ALTER TABLE "offers" DROP COLUMN IF EXISTS "withdrawn_at";
ALTER TABLE "offers" DROP COLUMN IF EXISTS "submitted_at";
