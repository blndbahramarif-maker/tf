-- Kurdora service billing (ADR-0015).
--
-- Kurdora charging for KURDORA'S OWN service — keeping a listing active. NOT
-- Stripe Connect and NOT a marketplace payment: no connected account, no
-- destination charge, no application fee, no transfer, no payout. The sale of
-- the listed item stays between buyer and seller, outside Kurdora (ADR-0014).
--
-- ENTIRELY ADDITIVE. Nothing is dropped, renamed or rewritten. The Phase 7
-- marketplace tables are untouched and remain dormant.

CREATE TABLE "service_plans" (
  "id"              UUID PRIMARY KEY,
  "key"             TEXT NOT NULL UNIQUE,
  "name"            TEXT NOT NULL,
  "description"     TEXT,
  "amount_minor"    BIGINT NOT NULL,
  "currency"        CHAR(3) NOT NULL,
  "interval"        TEXT NOT NULL DEFAULT 'month',
  "stripe_price_id" TEXT UNIQUE,
  "is_active"       BOOLEAN NOT NULL DEFAULT true,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ(6) NOT NULL
);

-- A free or negative "price" is a configuration mistake, not a business model.
ALTER TABLE "service_plans"
  ADD CONSTRAINT "service_plans_amount_positive" CHECK ("amount_minor" > 0);
ALTER TABLE "service_plans"
  ADD CONSTRAINT "service_plans_interval_valid" CHECK ("interval" IN ('month', 'year'));

CREATE INDEX "service_plans_is_active_idx" ON "service_plans" ("is_active");

CREATE TABLE "billing_customers" (
  "id"                 UUID PRIMARY KEY,
  "user_id"            UUID NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "stripe_customer_id" TEXT NOT NULL UNIQUE,
  "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"         TIMESTAMPTZ(6) NOT NULL
);

CREATE TABLE "listing_subscriptions" (
  "id"                  UUID PRIMARY KEY,
  "listing_id"          UUID NOT NULL UNIQUE REFERENCES "listings"("id") ON DELETE CASCADE,
  "seller_profile_id"   UUID NOT NULL REFERENCES "seller_profiles"("id") ON DELETE CASCADE,
  "billing_customer_id" UUID NOT NULL REFERENCES "billing_customers"("id") ON DELETE RESTRICT,
  "plan_id"             UUID NOT NULL REFERENCES "service_plans"("id") ON DELETE RESTRICT,

  "status" TEXT NOT NULL DEFAULT 'INCOMPLETE',

  "stripe_subscription_id"     TEXT UNIQUE,
  "stripe_checkout_session_id" TEXT UNIQUE,
  "stripe_latest_invoice_id"   TEXT,

  "amount_minor" BIGINT NOT NULL,
  "currency"     CHAR(3) NOT NULL,

  "current_period_end"   TIMESTAMPTZ(6),
  "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  "canceled_at"          TIMESTAMPTZ(6),
  "provider_updated_at"  TIMESTAMPTZ(6),

  "idempotency_key" TEXT NOT NULL UNIQUE,

  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL
);

-- The status vocabulary, in the database as well as the domain (ADR-0010).
-- An application check binds only the code that goes through it.
ALTER TABLE "listing_subscriptions"
  ADD CONSTRAINT "listing_subscriptions_status_valid" CHECK ("status" IN (
    'INCOMPLETE', 'INCOMPLETE_EXPIRED', 'TRIALING', 'ACTIVE',
    'PAST_DUE', 'UNPAID', 'PAUSED', 'CANCELED'
  ));

ALTER TABLE "listing_subscriptions"
  ADD CONSTRAINT "listing_subscriptions_amount_positive" CHECK ("amount_minor" > 0);

-- A subscription cannot be in an access-granting state without Stripe having
-- created it. This is the invariant that makes a forged "paid" row impossible
-- even by direct SQL: the id comes from the provider or the status cannot hold.
ALTER TABLE "listing_subscriptions"
  ADD CONSTRAINT "listing_subscriptions_active_requires_provider_id" CHECK (
    "status" NOT IN ('TRIALING', 'ACTIVE', 'PAST_DUE')
    OR "stripe_subscription_id" IS NOT NULL
  );

CREATE INDEX "listing_subscriptions_seller_idx"
  ON "listing_subscriptions" ("seller_profile_id", "created_at" DESC);
CREATE INDEX "listing_subscriptions_status_idx" ON "listing_subscriptions" ("status");

CREATE TABLE "subscription_events" (
  "id"                UUID PRIMARY KEY,
  "subscription_id"   UUID NOT NULL REFERENCES "listing_subscriptions"("id") ON DELETE CASCADE,
  "from_status"       TEXT,
  "to_status"         TEXT NOT NULL,
  "provider_event_id" TEXT,
  "reason"            TEXT,
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX "subscription_events_subscription_idx"
  ON "subscription_events" ("subscription_id", "created_at" DESC);

-- Append-only, like every other history table here. A subscription history
-- that can be edited after the fact will still be believed, which is worse
-- than having none.
CREATE OR REPLACE FUNCTION "subscription_events_append_only"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'subscription_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "subscription_events_no_update"
  BEFORE UPDATE OR DELETE ON "subscription_events"
  FOR EACH ROW EXECUTE FUNCTION "subscription_events_append_only"();

-- The default listing plan. Price is DATA, editable by an admin without a
-- deploy — "£5/month" is a business decision, not a constant.
INSERT INTO "service_plans" ("id", "key", "name", "description", "amount_minor", "currency", "interval", "updated_at")
VALUES (
  gen_random_uuid(),
  'listing_monthly',
  'Monthly listing',
  'Keeps one listing active on Kurdora. This pays for Kurdora''s service only — it is not a payment for the item being sold.',
  500,
  'GBP',
  'month',
  now()
);
