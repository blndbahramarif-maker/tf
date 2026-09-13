-- Reverses 'service_billing'. Purely additive migration, so the reversal is
-- a clean drop: nothing outside these tables was changed.
DROP TRIGGER IF EXISTS "subscription_events_no_update" ON "subscription_events";
DROP FUNCTION IF EXISTS "subscription_events_append_only"();
DROP TABLE IF EXISTS "subscription_events";
DROP TABLE IF EXISTS "listing_subscriptions";
DROP TABLE IF EXISTS "billing_customers";
DROP TABLE IF EXISTS "service_plans";
