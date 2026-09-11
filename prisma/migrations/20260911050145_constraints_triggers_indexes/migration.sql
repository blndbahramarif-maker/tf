-- Constraints, triggers and indexes that Prisma's schema language cannot
-- express. Everything here is a correctness guarantee that must hold even if
-- application code is wrong, bypassed, or written by someone new.
--
-- Grouped as:
--   1. Money sanity CHECKs
--   2. Partial unique indexes
--   3. Domain CHECKs
--   4. Append-only enforcement
--   5. Double-entry ledger zero-sum invariant
--   6. Search and JSONB indexes

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Money sanity
--
-- Money is BigInt minor units. These constraints make an impossible amount
-- impossible to store, rather than merely unlikely.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_amounts_non_negative" CHECK (
    "subtotal_minor" >= 0
    AND "shipping_minor" >= 0
    AND "tax_minor" >= 0
    AND "total_minor" >= 0
    AND "commission_amount_minor" >= 0
    AND "seller_amount_minor" >= 0
  ),
  -- The order total must actually be the sum of its parts.
  ADD CONSTRAINT "orders_total_is_sum_of_parts" CHECK (
    "total_minor" = "subtotal_minor" + "shipping_minor" + "tax_minor"
  ),
  -- Commission can never exceed the order.
  ADD CONSTRAINT "orders_commission_within_total" CHECK (
    "commission_amount_minor" <= "total_minor"
  ),
  -- The seller amount is derived by subtraction. If these ever disagree,
  -- something recomputed it independently — which is the bug this prevents.
  ADD CONSTRAINT "orders_seller_amount_is_remainder" CHECK (
    "seller_amount_minor" = "total_minor" - "commission_amount_minor"
  ),
  ADD CONSTRAINT "orders_commission_bps_sane" CHECK (
    "commission_percent_bps" >= 0 AND "commission_percent_bps" <= 10000
  );

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "order_items_amounts_non_negative" CHECK (
    "unit_price_minor" >= 0 AND "total_minor" >= 0
  );

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "payments_application_fee_within_amount" CHECK (
    "application_fee_amount_minor" IS NULL
    OR ("application_fee_amount_minor" >= 0
        AND "application_fee_amount_minor" <= "amount_minor")
  );

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_amount_positive" CHECK ("amount_minor" > 0);

ALTER TABLE "payouts"
  ADD CONSTRAINT "payouts_amount_positive" CHECK ("amount_minor" > 0);

ALTER TABLE "disputes"
  ADD CONSTRAINT "disputes_amount_positive" CHECK ("amount_minor" > 0);

ALTER TABLE "offers"
  ADD CONSTRAINT "offers_amount_positive" CHECK ("amount_minor" > 0);

ALTER TABLE "listings"
  ADD CONSTRAINT "listings_price_non_negative" CHECK (
    "price_minor" IS NULL OR "price_minor" >= 0
  ),
  ADD CONSTRAINT "listings_quantity_positive" CHECK ("quantity" > 0),
  -- A fixed-price listing without a price is not sellable. Catch it here
  -- rather than at checkout.
  ADD CONSTRAINT "listings_fixed_price_requires_amount" CHECK (
    "price_type" <> 'FIXED' OR "price_minor" IS NOT NULL
  );

ALTER TABLE "ledger_entries"
  -- Amounts are always positive; `direction` carries the sign. Allowing a
  -- negative debit would make the zero-sum check meaningless.
  ADD CONSTRAINT "ledger_entries_amount_positive" CHECK ("amount_minor" > 0);

ALTER TABLE "currencies"
  ADD CONSTRAINT "currencies_minor_unit_digits_sane" CHECK (
    "minor_unit_digits" >= 0 AND "minor_unit_digits" <= 4
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Commission rules
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "commission_rules"
  ADD CONSTRAINT "commission_rules_bps_sane" CHECK (
    "percent_bps" >= 0 AND "percent_bps" <= 10000
  ),
  ADD CONSTRAINT "commission_rules_fixed_non_negative" CHECK ("fixed_minor" >= 0),
  -- A fixed amount without a currency is meaningless.
  ADD CONSTRAINT "commission_rules_fixed_requires_currency" CHECK (
    "fixed_minor" = 0 OR "currency" IS NOT NULL
  ),
  ADD CONSTRAINT "commission_rules_min_max_ordered" CHECK (
    "min_minor" IS NULL OR "max_minor" IS NULL OR "min_minor" <= "max_minor"
  ),
  ADD CONSTRAINT "commission_rules_effective_range_ordered" CHECK (
    "effective_to" IS NULL OR "effective_to" > "effective_from"
  ),
  -- Each scope must carry exactly the target it claims to scope by.
  ADD CONSTRAINT "commission_rules_scope_target_matches" CHECK (
    ("scope_type" = 'PLATFORM' AND "category_id" IS NULL AND "seller_profile_id" IS NULL AND "country_id" IS NULL)
    OR ("scope_type" = 'CATEGORY' AND "category_id" IS NOT NULL)
    OR ("scope_type" = 'SELLER'   AND "seller_profile_id" IS NOT NULL)
    OR ("scope_type" = 'COUNTRY'  AND "country_id" IS NOT NULL)
    OR ("scope_type" = 'PROMO'    AND "promo_code" IS NOT NULL)
  );

-- Exactly one active PLATFORM default rule per applies_to. A second one would
-- make commission resolution non-deterministic.
CREATE UNIQUE INDEX "commission_rules_one_active_platform_default"
  ON "commission_rules" ("applies_to")
  WHERE "scope_type" = 'PLATFORM' AND "is_active" = true AND "effective_to" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Partial unique indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- A listing may have at most ONE primary image.
CREATE UNIQUE INDEX "listing_images_one_primary_per_listing"
  ON "listing_images" ("listing_id")
  WHERE "is_primary" = true;

-- A buyer may hold at most ONE open order per listing. This is the database's
-- half of double-payment protection; deterministic Stripe idempotency keys are
-- the other half.
CREATE UNIQUE INDEX "orders_one_open_per_buyer_listing"
  ON "orders" ("buyer_id", "listing_id")
  WHERE "status" IN ('DRAFT', 'PENDING_PAYMENT');

-- One pending offer per buyer per listing, so a buyer cannot spam a seller
-- with simultaneous offers.
CREATE UNIQUE INDEX "offers_one_pending_per_buyer_listing"
  ON "offers" ("listing_id", "buyer_id")
  WHERE "status" = 'PENDING';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Domain CHECKs
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" >= 1 AND "rating" <= 5),
  -- The review's subject must match its direction.
  ADD CONSTRAINT "reviews_subject_matches_direction" CHECK (
    ("direction" = 'BUYER_TO_SELLER' AND "subject_seller_id" IS NOT NULL AND "subject_user_id" IS NULL)
    OR ("direction" = 'SELLER_TO_BUYER' AND "subject_user_id" IS NOT NULL AND "subject_seller_id" IS NULL)
  );

ALTER TABLE "seller_profiles"
  ADD CONSTRAINT "seller_profiles_rating_range" CHECK (
    "rating_avg" >= 0 AND "rating_avg" <= 5
  ),
  ADD CONSTRAINT "seller_profiles_rating_count_non_negative" CHECK ("rating_count" >= 0),
  ADD CONSTRAINT "seller_profiles_payout_delay_sane" CHECK (
    "payout_delay_days" >= 0 AND "payout_delay_days" <= 90
  );

-- A user cannot block themselves.
ALTER TABLE "user_blocks"
  ADD CONSTRAINT "user_blocks_not_self" CHECK ("blocker_id" <> "blocked_id");

-- A user cannot open a conversation with themselves.
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_not_self" CHECK ("buyer_id" <> "seller_id");

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_risk_score_range" CHECK (
    "risk_score" >= 0 AND "risk_score" <= 100
  );

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_depth_non_negative" CHECK ("depth" >= 0),
  ADD CONSTRAINT "categories_not_own_parent" CHECK ("id" <> "parent_id"),
  -- Materialised paths are delimited, so a prefix scan cannot match a sibling
  -- whose slug merely starts with the same characters.
  ADD CONSTRAINT "categories_path_delimited" CHECK (
    "path" LIKE '/%' AND "path" LIKE '%/'
  );

-- A listing attribute value must hold exactly one typed value.
ALTER TABLE "listing_attribute_values"
  ADD CONSTRAINT "listing_attribute_values_exactly_one_value" CHECK (
    (
      ("value_text"    IS NOT NULL)::int
    + ("value_number"  IS NOT NULL)::int
    + ("value_integer" IS NOT NULL)::int
    + ("value_boolean" IS NOT NULL)::int
    + ("value_date"    IS NOT NULL)::int
    + ("option_id"     IS NOT NULL)::int
    ) = 1
  );

-- Currency codes are uppercase ISO-4217 everywhere. Mixed case would silently
-- split reporting between 'gbp' and 'GBP'.
ALTER TABLE "orders"          ADD CONSTRAINT "orders_currency_upper"          CHECK ("currency" = upper("currency"));
ALTER TABLE "payments"        ADD CONSTRAINT "payments_currency_upper"        CHECK ("currency" = upper("currency"));
ALTER TABLE "payouts"         ADD CONSTRAINT "payouts_currency_upper"         CHECK ("currency" = upper("currency"));
ALTER TABLE "refunds"         ADD CONSTRAINT "refunds_currency_upper"         CHECK ("currency" = upper("currency"));
ALTER TABLE "ledger_entries"  ADD CONSTRAINT "ledger_entries_currency_upper"  CHECK ("currency" = upper("currency"));
ALTER TABLE "listings"        ADD CONSTRAINT "listings_currency_upper"        CHECK ("currency" = upper("currency"));
ALTER TABLE "offers"          ADD CONSTRAINT "offers_currency_upper"          CHECK ("currency" = upper("currency"));
ALTER TABLE "currencies"      ADD CONSTRAINT "currencies_code_upper"          CHECK ("code" = upper("code"));
ALTER TABLE "countries"       ADD CONSTRAINT "countries_code_upper"           CHECK ("code" = upper("code"));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Append-only enforcement
--
-- The ledger and the audit log are evidence. If they can be edited, they are
-- not evidence. A trigger is the only way to make that true regardless of who
-- holds the connection.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION kurdora_reject_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Table % is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "ledger_entries_append_only"
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION kurdora_reject_mutation();

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION kurdora_reject_mutation();

CREATE TRIGGER "order_events_append_only"
  BEFORE UPDATE OR DELETE ON "order_events"
  FOR EACH ROW EXECUTE FUNCTION kurdora_reject_mutation();

CREATE TRIGGER "seller_verification_events_append_only"
  BEFORE UPDATE OR DELETE ON "seller_verification_events"
  FOR EACH ROW EXECUTE FUNCTION kurdora_reject_mutation();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Double-entry ledger zero-sum invariant
--
-- Every entry_group_id must balance to zero per currency, with DEBIT positive
-- and CREDIT negative.
--
-- This is a CONSTRAINT TRIGGER declared DEFERRABLE INITIALLY DEFERRED, so it
-- runs at COMMIT rather than per statement. That is essential: the entries of
-- one balanced group are inserted as separate rows, so the group is unbalanced
-- at every moment except the end of the transaction.
--
-- The effect is that an unbalanced ledger cannot be committed — by the
-- application, by a migration, by a script, or by hand at a psql prompt.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION kurdora_assert_ledger_balanced()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  unbalanced RECORD;
BEGIN
  SELECT
    le."currency" AS currency,
    SUM(CASE WHEN le."direction" = 'DEBIT'
             THEN le."amount_minor"
             ELSE -le."amount_minor" END) AS net
  INTO unbalanced
  FROM "ledger_entries" le
  WHERE le."entry_group_id" = NEW."entry_group_id"
  GROUP BY le."currency"
  HAVING SUM(CASE WHEN le."direction" = 'DEBIT'
                  THEN le."amount_minor"
                  ELSE -le."amount_minor" END) <> 0
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Ledger entry group % does not balance in %: net % minor units (debits must equal credits)',
      NEW."entry_group_id", unbalanced.currency, unbalanced.net
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "ledger_entries_must_balance"
  AFTER INSERT ON "ledger_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION kurdora_assert_ledger_balanced();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. JSONB and text search indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- Faceted filtering on category-specific attributes ("diesel, 2018+, under
-- 80,000 km"). jsonb_path_ops is smaller and faster than the default operator
-- class for the containment queries we actually run.
CREATE INDEX "listings_attributes_gin"
  ON "listings" USING GIN ("attributes" jsonb_path_ops);

-- Trigram indexes for fuzzy title matching. Postgres has no Kurdish text
-- search dictionary, so Sorani and Kurmanji rely on trigram similarity rather
-- than stemming. This is a known quality compromise and the main trigger for
-- moving to a dedicated search engine in Phase 4b (ADR-0003).
CREATE INDEX "listings_title_trgm"
  ON "listings" USING GIN ("title" gin_trgm_ops);

CREATE INDEX "seller_profiles_display_name_trgm"
  ON "seller_profiles" USING GIN ("display_name" gin_trgm_ops);

-- Active-listing browse is the hottest query on the site. A partial index
-- keeps it small by excluding the ever-growing tail of sold and expired rows.
CREATE INDEX "listings_active_browse"
  ON "listings" ("category_id", "country_id", "published_at" DESC)
  WHERE "status" = 'ACTIVE' AND "deleted_at" IS NULL;

-- Outbox and webhook drains poll for pending work constantly; partial indexes
-- keep those scans proportional to the backlog, not to total history.
CREATE INDEX "outbox_events_pending"
  ON "outbox_events" ("available_at")
  WHERE "status" = 'PENDING';

CREATE INDEX "payment_events_pending"
  ON "payment_events" ("received_at")
  WHERE "status" = 'PENDING';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Unique indexes over nullable columns
--
-- In SQL, NULL is not equal to NULL, so a plain UNIQUE index containing a
-- nullable column does NOT prevent duplicates when that column is null.
-- Prisma's `@@unique` emits exactly such an index, which left three
-- constraints silently unenforced:
--
--   settings(key, scope, scope_id)                       — scope_id is null for GLOBAL
--   conversations(listing_id, buyer_id, seller_id)       — listing_id is null off-listing
--   listing_attribute_values(listing_id, attribute_definition_id, option_id)
--                                                        — option_id is null for non-enum
--
-- The third was the dangerous one: a listing could hold two different values
-- for the same attribute, so "mileage" could be both 20,000 and 90,000.
--
-- NULLS NOT DISTINCT (PostgreSQL 15+) makes nulls compare equal for uniqueness,
-- which is the behaviour these constraints were always meant to have.
-- ─────────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS "settings_key_scope_scope_id_key";
CREATE UNIQUE INDEX "settings_key_scope_scope_id_key"
  ON "settings" ("key", "scope", "scope_id") NULLS NOT DISTINCT;

DROP INDEX IF EXISTS "conversations_listing_id_buyer_id_seller_id_key";
CREATE UNIQUE INDEX "conversations_listing_id_buyer_id_seller_id_key"
  ON "conversations" ("listing_id", "buyer_id", "seller_id") NULLS NOT DISTINCT;

DROP INDEX IF EXISTS "listing_attribute_values_listing_id_attribute_definition_id_key";
CREATE UNIQUE INDEX "listing_attribute_values_listing_id_attribute_definition_id_key"
  ON "listing_attribute_values" ("listing_id", "attribute_definition_id", "option_id")
  NULLS NOT DISTINCT;
