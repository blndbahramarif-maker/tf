-- Phase 3: authentication sessions, verification tokens, recovery codes.
--
-- ⚠️ HAND-EDITED. `prisma migrate dev` generated three DROP INDEX statements
-- for `listings_attributes_gin`, `listings_title_trgm` and
-- `seller_profiles_display_name_trgm`. Those indexes are created by raw SQL in
-- the Phase 2 constraints migration, so Prisma's diff cannot see them in
-- schema.prisma and reads them as drift to be removed.
--
-- The drops were REMOVED. This is the caveat recorded in
-- prisma/migrations/README.md, now observed in practice: always read generated
-- SQL before applying it. tests/db/migrations.test.ts asserts those indexes
-- exist after migrating, so shipping this unedited would have failed CI.

-- CreateEnum
CREATE TYPE "verification_purpose" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET');

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "last_used_at" TIMESTAMPTZ(6),
ADD COLUMN     "step_up_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "requires_two_factor" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "password_changed_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "verification_purpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "target_email" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factor_recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "two_factor_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_hash_key" ON "verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "verification_tokens_user_id_purpose_consumed_at_idx" ON "verification_tokens"("user_id", "purpose", "consumed_at");

-- CreateIndex
CREATE INDEX "verification_tokens_expires_at_idx" ON "verification_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "two_factor_recovery_codes_user_id_used_at_idx" ON "two_factor_recovery_codes"("user_id", "used_at");

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factor_recovery_codes" ADD CONSTRAINT "two_factor_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
