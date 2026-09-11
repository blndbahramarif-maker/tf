-- Down migration for: auth_sessions_and_verification

DROP TABLE IF EXISTS "two_factor_recovery_codes" CASCADE;
DROP TABLE IF EXISTS "verification_tokens" CASCADE;

DROP TYPE IF EXISTS "verification_purpose";

ALTER TABLE "users"          DROP COLUMN IF EXISTS "password_changed_at";
ALTER TABLE "roles"          DROP COLUMN IF EXISTS "requires_two_factor";
ALTER TABLE "refresh_tokens" DROP COLUMN IF EXISTS "step_up_at";
ALTER TABLE "refresh_tokens" DROP COLUMN IF EXISTS "last_used_at";
