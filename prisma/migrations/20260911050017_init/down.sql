-- Down migration for: init
--
-- Reverses the initial schema completely. Extensions are dropped last and only
-- if nothing else depends on them.
--
-- This file is executed by `pnpm db:migrate:down` (scripts/migrate-down.ts).
-- Prisma has no native down migrations, so reversibility is something we own
-- and TEST rather than assume — see tests/db/migrations.test.ts.

DROP TABLE IF EXISTS "messages" CASCADE;
DROP TABLE IF EXISTS "message_reads" CASCADE;
DROP TABLE IF EXISTS "offers" CASCADE;
DROP TABLE IF EXISTS "order_events" CASCADE;
DROP TABLE IF EXISTS "conversations" CASCADE;
DROP TABLE IF EXISTS "order_items" CASCADE;
DROP TABLE IF EXISTS "payment_events" CASCADE;
DROP TABLE IF EXISTS "seller_verification_events" CASCADE;
DROP TABLE IF EXISTS "payments" CASCADE;
DROP TABLE IF EXISTS "roles" CASCADE;
DROP TABLE IF EXISTS "permissions" CASCADE;
DROP TABLE IF EXISTS "users" CASCADE;
DROP TABLE IF EXISTS "role_permissions" CASCADE;
DROP TABLE IF EXISTS "user_roles" CASCADE;
DROP TABLE IF EXISTS "country_translations" CASCADE;
DROP TABLE IF EXISTS "cities" CASCADE;
DROP TABLE IF EXISTS "city_translations" CASCADE;
DROP TABLE IF EXISTS "refresh_tokens" CASCADE;
DROP TABLE IF EXISTS "countries" CASCADE;
DROP TABLE IF EXISTS "user_blocks" CASCADE;
DROP TABLE IF EXISTS "exchange_rates" CASCADE;
DROP TABLE IF EXISTS "currencies" CASCADE;
DROP TABLE IF EXISTS "attribute_definitions" CASCADE;
DROP TABLE IF EXISTS "attribute_definition_translations" CASCADE;
DROP TABLE IF EXISTS "attribute_options" CASCADE;
DROP TABLE IF EXISTS "attribute_option_translations" CASCADE;
DROP TABLE IF EXISTS "category_translations" CASCADE;
DROP TABLE IF EXISTS "favourites" CASCADE;
DROP TABLE IF EXISTS "listing_images" CASCADE;
DROP TABLE IF EXISTS "listing_translations" CASCADE;
DROP TABLE IF EXISTS "businesses" CASCADE;
DROP TABLE IF EXISTS "refunds" CASCADE;
DROP TABLE IF EXISTS "idempotency_keys" CASCADE;
DROP TABLE IF EXISTS "payouts" CASCADE;
DROP TABLE IF EXISTS "ledger_entries" CASCADE;
DROP TABLE IF EXISTS "outbox_events" CASCADE;
DROP TABLE IF EXISTS "reports" CASCADE;
DROP TABLE IF EXISTS "user_sanctions" CASCADE;
DROP TABLE IF EXISTS "moderation_actions" CASCADE;
DROP TABLE IF EXISTS "reviews" CASCADE;
DROP TABLE IF EXISTS "disputes" CASCADE;
DROP TABLE IF EXISTS "settings" CASCADE;
DROP TABLE IF EXISTS "translations" CASCADE;
DROP TABLE IF EXISTS "consent_records" CASCADE;
DROP TABLE IF EXISTS "data_subject_requests" CASCADE;
DROP TABLE IF EXISTS "audit_logs" CASCADE;
DROP TABLE IF EXISTS "notifications" CASCADE;
DROP TABLE IF EXISTS "profiles" CASCADE;
DROP TABLE IF EXISTS "prohibited_item_rules" CASCADE;
DROP TABLE IF EXISTS "commission_rules" CASCADE;
DROP TABLE IF EXISTS "seller_profiles" CASCADE;
DROP TABLE IF EXISTS "categories" CASCADE;
DROP TABLE IF EXISTS "listing_attribute_values" CASCADE;
DROP TABLE IF EXISTS "orders" CASCADE;
DROP TABLE IF EXISTS "listings" CASCADE;
DROP TYPE IF EXISTS "user_status" CASCADE;
DROP TYPE IF EXISTS "seller_type" CASCADE;
DROP TYPE IF EXISTS "verification_status" CASCADE;
DROP TYPE IF EXISTS "transaction_flow" CASCADE;
DROP TYPE IF EXISTS "fee_payer" CASCADE;
DROP TYPE IF EXISTS "attribute_data_type" CASCADE;
DROP TYPE IF EXISTS "listing_status" CASCADE;
DROP TYPE IF EXISTS "price_type" CASCADE;
DROP TYPE IF EXISTS "listing_condition" CASCADE;
DROP TYPE IF EXISTS "moderation_status" CASCADE;
DROP TYPE IF EXISTS "conversation_status" CASCADE;
DROP TYPE IF EXISTS "message_type" CASCADE;
DROP TYPE IF EXISTS "offer_status" CASCADE;
DROP TYPE IF EXISTS "order_status" CASCADE;
DROP TYPE IF EXISTS "payment_status" CASCADE;
DROP TYPE IF EXISTS "payment_event_status" CASCADE;
DROP TYPE IF EXISTS "payout_status" CASCADE;
DROP TYPE IF EXISTS "refund_status" CASCADE;
DROP TYPE IF EXISTS "dispute_status" CASCADE;
DROP TYPE IF EXISTS "ledger_account" CASCADE;
DROP TYPE IF EXISTS "ledger_direction" CASCADE;
DROP TYPE IF EXISTS "commission_scope" CASCADE;
DROP TYPE IF EXISTS "commission_model" CASCADE;
DROP TYPE IF EXISTS "commission_applies_to" CASCADE;
DROP TYPE IF EXISTS "review_direction" CASCADE;
DROP TYPE IF EXISTS "review_status" CASCADE;
DROP TYPE IF EXISTS "report_target_type" CASCADE;
DROP TYPE IF EXISTS "report_status" CASCADE;
DROP TYPE IF EXISTS "sanction_type" CASCADE;
DROP TYPE IF EXISTS "prohibited_rule_type" CASCADE;
DROP TYPE IF EXISTS "setting_scope" CASCADE;
DROP TYPE IF EXISTS "outbox_status" CASCADE;

DROP EXTENSION IF EXISTS unaccent;
DROP EXTENSION IF EXISTS pg_trgm;
DROP EXTENSION IF EXISTS citext;
