-- Reverses 'connect_onboarding'.

DROP INDEX IF EXISTS "payment_events_account_events_idx";

DROP INDEX IF EXISTS "payment_attempts_provider_payment_intent_idx";
ALTER TABLE "payment_attempts" DROP CONSTRAINT IF EXISTS "payment_attempts_refunded_implies_amount";
ALTER TABLE "payment_attempts" DROP CONSTRAINT IF EXISTS "payment_attempts_refund_within_amount";
ALTER TABLE "payment_attempts"
  DROP COLUMN IF EXISTS "failed_at",
  DROP COLUMN IF EXISTS "provider_net_minor",
  DROP COLUMN IF EXISTS "destination_account_id",
  DROP COLUMN IF EXISTS "provider_transfer_id",
  DROP COLUMN IF EXISTS "disputed",
  DROP COLUMN IF EXISTS "refunded",
  DROP COLUMN IF EXISTS "amount_refunded_minor",
  DROP COLUMN IF EXISTS "provider_payment_intent_id";

DROP INDEX IF EXISTS "seller_profiles_onboarding_status_idx";
ALTER TABLE "seller_profiles" DROP CONSTRAINT IF EXISTS "seller_profiles_stripe_payout_delay_sane";
ALTER TABLE "seller_profiles" DROP CONSTRAINT IF EXISTS "seller_profiles_active_requires_account";
ALTER TABLE "seller_profiles" DROP CONSTRAINT IF EXISTS "seller_profiles_enabled_requires_account";
ALTER TABLE "seller_profiles"
  DROP COLUMN IF EXISTS "stripe_account_synced_at",
  DROP COLUMN IF EXISTS "onboarding_completed_at",
  DROP COLUMN IF EXISTS "onboarding_started_at",
  DROP COLUMN IF EXISTS "stripe_payout_delay_days",
  DROP COLUMN IF EXISTS "stripe_controller",
  DROP COLUMN IF EXISTS "stripe_account_country",
  DROP COLUMN IF EXISTS "stripe_capabilities",
  DROP COLUMN IF EXISTS "stripe_disabled_reason",
  DROP COLUMN IF EXISTS "details_submitted",
  DROP COLUMN IF EXISTS "onboarding_status";

DROP TYPE IF EXISTS "onboarding_status";
