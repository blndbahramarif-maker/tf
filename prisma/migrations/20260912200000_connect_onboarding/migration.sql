-- Phase 7 Part 2 — connected-account onboarding state.
--
-- Part 1 mirrored three booleans from Stripe (`charges_enabled`,
-- `payouts_enabled`, `requirements_due`). That is enough to answer "can this
-- seller be paid?" and not enough to answer anything else: it cannot tell
-- "has not started" from "started and abandoned" from "Stripe rejected them",
-- and `rejected.terms_of_service` is a very different problem from a missing
-- document.
--
-- Everything here is MIRRORED FROM STRIPE via the account.updated webhook or a
-- direct account read. No client request writes any of it.

-- ─── 1. Onboarding lifecycle ────────────────────────────────────────────────
CREATE TYPE "onboarding_status" AS ENUM (
  -- No connected account exists yet.
  'NOT_STARTED',
  -- An account exists and an onboarding link was issued.
  'ONBOARDING_STARTED',
  -- details_submitted = true, but Stripe is still verifying.
  'PENDING_VERIFICATION',
  -- charges_enabled AND payouts_enabled, nothing currently due.
  'ACTIVE',
  -- Usable in part, or with requirements outstanding. Reachable FROM active:
  -- Stripe adds requirements over time and an account can lose eligibility
  -- mid-life, which is why this is not a one-way street.
  'RESTRICTED',
  -- requirements.disabled_reason begins `rejected.`.
  'REJECTED',
  -- Closed or otherwise unusable.
  'DISABLED'
);

ALTER TABLE "seller_profiles"
  ADD COLUMN "onboarding_status" "onboarding_status" NOT NULL DEFAULT 'NOT_STARTED',
  -- Stripe's own `details_submitted`. "They finished the form", which is NOT
  -- the same as "they are verified".
  ADD COLUMN "details_submitted" BOOLEAN NOT NULL DEFAULT false,
  -- `requirements.disabled_reason`. Null when nothing is disabled. This is the
  -- field that distinguishes "not finished" from "Stripe said no".
  ADD COLUMN "stripe_disabled_reason" TEXT,
  -- A snapshot of `capabilities`, e.g. {"card_payments":"active"}. Mirrored
  -- for display and triage; the booleans above remain the decision inputs.
  ADD COLUMN "stripe_capabilities" JSONB NOT NULL DEFAULT '{}',
  -- The account's country, fixed by Stripe at creation and not changeable.
  ADD COLUMN "stripe_account_country" CHAR(2),
  -- Which controller configuration this account was created with. Recorded
  -- because `stripe_dashboard.type` is IMMUTABLE per account: changing it
  -- later means creating a new Account object, so we need to know what we
  -- chose at the time.
  ADD COLUMN "stripe_controller" JSONB NOT NULL DEFAULT '{}',
  -- Stripe's `settings.payouts.schedule.delay_days`, mirrored for display.
  -- `payout_delay_days` (Phase 2) stays OUR risk-tier hold and is not the
  -- same number; keeping them apart avoids one silently overwriting the other.
  ADD COLUMN "stripe_payout_delay_days" INTEGER,
  ADD COLUMN "onboarding_started_at" TIMESTAMPTZ(6),
  ADD COLUMN "onboarding_completed_at" TIMESTAMPTZ(6),
  -- The last account.updated we applied. Lets an out-of-order or replayed
  -- event be recognised without re-deriving state.
  ADD COLUMN "stripe_account_synced_at" TIMESTAMPTZ(6);

-- A seller cannot be payable without an account. Belt and braces against a
-- code path that sets the booleans without setting the id.
ALTER TABLE "seller_profiles"
  ADD CONSTRAINT "seller_profiles_enabled_requires_account"
  CHECK (
    "stripe_account_id" IS NOT NULL
    OR ("charges_enabled" = false AND "payouts_enabled" = false)
  );

-- An ACTIVE account must have an id. Same reasoning, one level up.
ALTER TABLE "seller_profiles"
  ADD CONSTRAINT "seller_profiles_active_requires_account"
  CHECK (
    "onboarding_status" <> 'ACTIVE' OR "stripe_account_id" IS NOT NULL
  );

ALTER TABLE "seller_profiles"
  ADD CONSTRAINT "seller_profiles_stripe_payout_delay_sane"
  CHECK (
    "stripe_payout_delay_days" IS NULL
    OR ("stripe_payout_delay_days" >= 0 AND "stripe_payout_delay_days" <= 365)
  );

-- Finding the seller an account.updated belongs to is the hot path of that
-- webhook; `stripe_account_id` is already UNIQUE, which serves it.
CREATE INDEX "seller_profiles_onboarding_status_idx"
  ON "seller_profiles" ("onboarding_status");

-- ─── 2. Payment attempts: the fields a refund or dispute will need ──────────
--
-- Part 1 created attempts from `latest_charge` only, which is the CURRENT
-- charge on an intent. It is sufficient to know a payment succeeded and
-- insufficient for anything afterwards: a refund goes against a specific
-- charge, a dispute names a specific charge, and reconciliation needs the
-- balance transaction to know what Stripe actually took.
ALTER TABLE "payment_attempts"
  -- Mirrored from the charge, so a refund does not have to re-fetch it.
  ADD COLUMN "provider_payment_intent_id" TEXT,
  ADD COLUMN "amount_refunded_minor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "refunded" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "disputed" BOOLEAN NOT NULL DEFAULT false,
  -- Present when the charge carried a transfer leg (BUY_NOW). Always null for
  -- FEE_ONLY, which has no transfer at all.
  ADD COLUMN "provider_transfer_id" TEXT,
  ADD COLUMN "destination_account_id" TEXT,
  -- The net after Stripe's fee, from the balance transaction. Never computed.
  ADD COLUMN "provider_net_minor" BIGINT,
  ADD COLUMN "failed_at" TIMESTAMPTZ(6);

ALTER TABLE "payment_attempts"
  ADD CONSTRAINT "payment_attempts_refund_within_amount"
  CHECK ("amount_refunded_minor" >= 0 AND "amount_refunded_minor" <= "amount_minor");

-- Stripe's `refunded` means FULLY refunded, so it implies a positive amount.
-- A partial refund is `refunded = false` with an amount, which is why this is
-- an implication rather than an equivalence.
ALTER TABLE "payment_attempts"
  ADD CONSTRAINT "payment_attempts_refunded_implies_amount"
  CHECK (NOT ("refunded" = true AND "amount_refunded_minor" = 0));

CREATE INDEX "payment_attempts_provider_payment_intent_idx"
  ON "payment_attempts" ("provider_payment_intent_id");

-- ─── 3. Connected-account events ────────────────────────────────────────────
--
-- `payment_events` is keyed by the Stripe event id and already carries
-- account.updated once it is recorded. This index makes "what happened to this
-- account" answerable without scanning, which is what a support question about
-- a seller's onboarding actually looks like.
CREATE INDEX "payment_events_account_events_idx"
  ON "payment_events" ("related_object_id", "received_at" DESC)
  WHERE "type" LIKE 'account.%';
