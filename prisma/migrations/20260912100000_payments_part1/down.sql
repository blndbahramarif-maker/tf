-- Reverses 'payments_part1'.

DROP TRIGGER IF EXISTS "orders_snapshot_immutable" ON "orders";
DROP FUNCTION IF EXISTS kurdora_orders_snapshot_immutable();

DROP INDEX IF EXISTS "payment_events_type_related_object_idx";

DROP INDEX IF EXISTS "payment_attempts_payment_id_created_at_idx";
DROP INDEX IF EXISTS "payment_attempts_provider_charge_id_key";
DROP TABLE IF EXISTS "payment_attempts";

DROP INDEX IF EXISTS "payments_one_live_per_order";

-- `payments_amount_positive` and `payments_application_fee_within_amount` are
-- NOT dropped here: they belong to the Phase 2 constraints migration, and
-- dropping another migration's constraint would leave the schema wrong after a
-- partial rollback.
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_transfer_leg_is_whole";
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_fee_only_has_no_transfer";
ALTER TABLE "payments" DROP COLUMN IF EXISTS "flow_type";

ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_fee_only_principal_recorded";
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_fee_only_charges_fee_alone";
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_principal_positive";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "principal_minor";
