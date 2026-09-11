-- Down migration for: constraints_triggers_indexes
--
-- Drops every object the up migration created, in reverse dependency order.
-- Triggers must go before the functions they reference.

-- 8. Restore Prisma's default (NULLS DISTINCT) unique indexes
DROP INDEX IF EXISTS "listing_attribute_values_listing_id_attribute_definition_id_key";
CREATE UNIQUE INDEX "listing_attribute_values_listing_id_attribute_definition_id_key"
  ON "listing_attribute_values" ("listing_id", "attribute_definition_id", "option_id");

DROP INDEX IF EXISTS "conversations_listing_id_buyer_id_seller_id_key";
CREATE UNIQUE INDEX "conversations_listing_id_buyer_id_seller_id_key"
  ON "conversations" ("listing_id", "buyer_id", "seller_id");

DROP INDEX IF EXISTS "settings_key_scope_scope_id_key";
CREATE UNIQUE INDEX "settings_key_scope_scope_id_key"
  ON "settings" ("key", "scope", "scope_id");

-- 7. Indexes
DROP INDEX IF EXISTS "payment_events_pending";
DROP INDEX IF EXISTS "outbox_events_pending";
DROP INDEX IF EXISTS "listings_active_browse";
DROP INDEX IF EXISTS "seller_profiles_display_name_trgm";
DROP INDEX IF EXISTS "listings_title_trgm";
DROP INDEX IF EXISTS "listings_attributes_gin";

-- 6. Ledger balance invariant
DROP TRIGGER IF EXISTS "ledger_entries_must_balance" ON "ledger_entries";
DROP FUNCTION IF EXISTS kurdora_assert_ledger_balanced();

-- 5. Append-only enforcement
DROP TRIGGER IF EXISTS "seller_verification_events_append_only" ON "seller_verification_events";
DROP TRIGGER IF EXISTS "order_events_append_only" ON "order_events";
DROP TRIGGER IF EXISTS "audit_logs_append_only" ON "audit_logs";
DROP TRIGGER IF EXISTS "ledger_entries_append_only" ON "ledger_entries";
DROP FUNCTION IF EXISTS kurdora_reject_mutation();

-- 4. Domain CHECKs
ALTER TABLE "countries"                 DROP CONSTRAINT IF EXISTS "countries_code_upper";
ALTER TABLE "currencies"                DROP CONSTRAINT IF EXISTS "currencies_code_upper";
ALTER TABLE "offers"                    DROP CONSTRAINT IF EXISTS "offers_currency_upper";
ALTER TABLE "listings"                  DROP CONSTRAINT IF EXISTS "listings_currency_upper";
ALTER TABLE "ledger_entries"            DROP CONSTRAINT IF EXISTS "ledger_entries_currency_upper";
ALTER TABLE "refunds"                   DROP CONSTRAINT IF EXISTS "refunds_currency_upper";
ALTER TABLE "payouts"                   DROP CONSTRAINT IF EXISTS "payouts_currency_upper";
ALTER TABLE "payments"                  DROP CONSTRAINT IF EXISTS "payments_currency_upper";
ALTER TABLE "orders"                    DROP CONSTRAINT IF EXISTS "orders_currency_upper";
ALTER TABLE "listing_attribute_values"  DROP CONSTRAINT IF EXISTS "listing_attribute_values_exactly_one_value";
ALTER TABLE "categories"                DROP CONSTRAINT IF EXISTS "categories_path_delimited";
ALTER TABLE "categories"                DROP CONSTRAINT IF EXISTS "categories_not_own_parent";
ALTER TABLE "categories"                DROP CONSTRAINT IF EXISTS "categories_depth_non_negative";
ALTER TABLE "messages"                  DROP CONSTRAINT IF EXISTS "messages_risk_score_range";
ALTER TABLE "conversations"             DROP CONSTRAINT IF EXISTS "conversations_not_self";
ALTER TABLE "user_blocks"               DROP CONSTRAINT IF EXISTS "user_blocks_not_self";
ALTER TABLE "seller_profiles"           DROP CONSTRAINT IF EXISTS "seller_profiles_payout_delay_sane";
ALTER TABLE "seller_profiles"           DROP CONSTRAINT IF EXISTS "seller_profiles_rating_count_non_negative";
ALTER TABLE "seller_profiles"           DROP CONSTRAINT IF EXISTS "seller_profiles_rating_range";
ALTER TABLE "reviews"                   DROP CONSTRAINT IF EXISTS "reviews_subject_matches_direction";
ALTER TABLE "reviews"                   DROP CONSTRAINT IF EXISTS "reviews_rating_range";

-- 3. Partial unique indexes
DROP INDEX IF EXISTS "offers_one_pending_per_buyer_listing";
DROP INDEX IF EXISTS "orders_one_open_per_buyer_listing";
DROP INDEX IF EXISTS "listing_images_one_primary_per_listing";

-- 2. Commission rules
DROP INDEX IF EXISTS "commission_rules_one_active_platform_default";
ALTER TABLE "commission_rules" DROP CONSTRAINT IF EXISTS "commission_rules_scope_target_matches";
ALTER TABLE "commission_rules" DROP CONSTRAINT IF EXISTS "commission_rules_effective_range_ordered";
ALTER TABLE "commission_rules" DROP CONSTRAINT IF EXISTS "commission_rules_min_max_ordered";
ALTER TABLE "commission_rules" DROP CONSTRAINT IF EXISTS "commission_rules_fixed_requires_currency";
ALTER TABLE "commission_rules" DROP CONSTRAINT IF EXISTS "commission_rules_fixed_non_negative";
ALTER TABLE "commission_rules" DROP CONSTRAINT IF EXISTS "commission_rules_bps_sane";

-- 1. Money sanity
ALTER TABLE "currencies"     DROP CONSTRAINT IF EXISTS "currencies_minor_unit_digits_sane";
ALTER TABLE "ledger_entries" DROP CONSTRAINT IF EXISTS "ledger_entries_amount_positive";
ALTER TABLE "listings"       DROP CONSTRAINT IF EXISTS "listings_fixed_price_requires_amount";
ALTER TABLE "listings"       DROP CONSTRAINT IF EXISTS "listings_quantity_positive";
ALTER TABLE "listings"       DROP CONSTRAINT IF EXISTS "listings_price_non_negative";
ALTER TABLE "offers"         DROP CONSTRAINT IF EXISTS "offers_amount_positive";
ALTER TABLE "disputes"       DROP CONSTRAINT IF EXISTS "disputes_amount_positive";
ALTER TABLE "payouts"        DROP CONSTRAINT IF EXISTS "payouts_amount_positive";
ALTER TABLE "refunds"        DROP CONSTRAINT IF EXISTS "refunds_amount_positive";
ALTER TABLE "payments"       DROP CONSTRAINT IF EXISTS "payments_application_fee_within_amount";
ALTER TABLE "payments"       DROP CONSTRAINT IF EXISTS "payments_amount_positive";
ALTER TABLE "order_items"    DROP CONSTRAINT IF EXISTS "order_items_amounts_non_negative";
ALTER TABLE "order_items"    DROP CONSTRAINT IF EXISTS "order_items_quantity_positive";
ALTER TABLE "orders"         DROP CONSTRAINT IF EXISTS "orders_commission_bps_sane";
ALTER TABLE "orders"         DROP CONSTRAINT IF EXISTS "orders_seller_amount_is_remainder";
ALTER TABLE "orders"         DROP CONSTRAINT IF EXISTS "orders_commission_within_total";
ALTER TABLE "orders"         DROP CONSTRAINT IF EXISTS "orders_total_is_sum_of_parts";
ALTER TABLE "orders"         DROP CONSTRAINT IF EXISTS "orders_amounts_non_negative";
