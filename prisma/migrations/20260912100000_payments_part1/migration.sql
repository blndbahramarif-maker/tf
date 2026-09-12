-- Phase 7 Part 1 — payment foundation.
--
-- Additive only. The Phase 2 financial schema (orders, payments, refunds,
-- payouts, disputes, the ledger, commission rules, idempotency keys) is
-- deliberately NOT redesigned; this migration adds the six things the Phase 7
-- gate identified as missing, and nothing else.
--
-- The most important line in this file is the FEE_ONLY CHECK. It turns
-- "the fee-only flow never charges the sale price" from a convention that
-- reviewers must remember into an invariant Postgres enforces (ADR-0010).

-- ─── 1. The agreed sale price, recorded but never charged ────────────────────
--
-- For FEE_ONLY this is the £50,000 car against a £250 charge. It is the
-- commission basis and a reporting figure. Putting it in total_minor would be
-- a lie that a reconciliation job would later believe.
ALTER TABLE "orders" ADD COLUMN "principal_minor" BIGINT;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_principal_positive"
  CHECK ("principal_minor" IS NULL OR "principal_minor" > 0);

-- ─── 2. THE FEE_ONLY INVARIANT ───────────────────────────────────────────────
--
-- A fee-only order charges the commission, the whole commission, and nothing
-- but the commission. The seller receives nothing THROUGH KURDORA — they are
-- paid directly by the buyer, off-platform, which is the entire point of the
-- flow (ADR-0007, ADR-0013).
--
-- A bug that tried to charge £50,000 through this flow is refused here, one
-- layer below the code that would have made the mistake.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_fee_only_charges_fee_alone"
  CHECK (
    "flow_type" <> 'FEE_ONLY'
    OR ("total_minor" = "commission_amount_minor" AND "seller_amount_minor" = 0)
  );

-- A fee-only order must record what the fee was charged AGAINST, and the fee
-- must be strictly smaller than it. A "fee" equal to the sale price is the
-- principal wearing a different column name.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_fee_only_principal_recorded"
  CHECK (
    "flow_type" <> 'FEE_ONLY'
    OR ("principal_minor" IS NOT NULL AND "total_minor" < "principal_minor")
  );

-- ─── 3. No transfer leg on a fee-only payment ────────────────────────────────
--
-- Enforced on the payment row as well as the order, because the payment is
-- what carries the destination account to Stripe. Both halves have to be
-- impossible, not just the one a reader happens to look at.
-- A CHECK cannot reference another table, so the flow is denormalised onto the
-- payment at creation. Copied once, never updated — the same snapshot
-- discipline the commission columns use.
ALTER TABLE "payments" ADD COLUMN "flow_type" "transaction_flow";

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_fee_only_has_no_transfer"
  CHECK (
    "flow_type" IS NULL
    OR "flow_type" <> 'FEE_ONLY'
    OR ("destination_account_id" IS NULL AND "application_fee_amount_minor" IS NULL)
  );

-- A marketplace charge is the mirror image: a destination and a fee are
-- present together or not at all. Half a transfer moves money to nowhere.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_transfer_leg_is_whole"
  CHECK (
    ("destination_account_id" IS NULL) = ("application_fee_amount_minor" IS NULL)
  );

-- `payments_amount_positive` and `payments_application_fee_within_amount`
-- already exist from the Phase 2 constraints migration. Not re-added: a
-- duplicate CHECK is a failed migration, and re-stating an existing rule here
-- would also hide which migration actually owns it.

-- ─── 4. One live payment per order ───────────────────────────────────────────
--
-- Duplicate-payment protection in the database, not only in the route. A
-- settled or abandoned attempt does not lock the order, so a buyer whose card
-- was declined can try again.
CREATE UNIQUE INDEX "payments_one_live_per_order"
  ON "payments" ("order_id")
  WHERE "status" NOT IN ('FAILED', 'CANCELED');

-- ─── 5. Payment attempts ─────────────────────────────────────────────────────
--
-- One PaymentIntent can produce several charges: a declined card retried on
-- the same intent is a second charge. Stripe's own guidance is that refunds go
-- against "the most recent charge that is created", so the history has to be
-- kept rather than overwritten into payments.provider_charge_id.
CREATE TABLE "payment_attempts" (
  "id"                     UUID PRIMARY KEY,
  "payment_id"             UUID NOT NULL,
  -- The provider's charge id. UNIQUE, so a replayed webhook cannot create a
  -- second attempt for one charge.
  "provider_charge_id"     TEXT NOT NULL,
  "provider_balance_transaction_id" TEXT,
  "status"                 TEXT NOT NULL,
  "amount_minor"           BIGINT NOT NULL,
  "currency"               CHAR(3) NOT NULL,
  "payment_method_type"    TEXT,
  "failure_code"           TEXT,
  "failure_message"        TEXT,
  -- The ACTUAL provider fee, read from the balance transaction. Never
  -- estimated, and null until the charge settles.
  "provider_fee_minor"     BIGINT,
  "livemode"               BOOLEAN NOT NULL DEFAULT false,
  "succeeded_at"           TIMESTAMPTZ(6),
  "created_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_attempts_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,

  CONSTRAINT "payment_attempts_amount_positive" CHECK ("amount_minor" > 0),
  CONSTRAINT "payment_attempts_status_valid"
    CHECK ("status" IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  CONSTRAINT "payment_attempts_fee_non_negative"
    CHECK ("provider_fee_minor" IS NULL OR "provider_fee_minor" >= 0)
);

CREATE UNIQUE INDEX "payment_attempts_provider_charge_id_key"
  ON "payment_attempts" ("provider_charge_id");

CREATE INDEX "payment_attempts_payment_id_created_at_idx"
  ON "payment_attempts" ("payment_id", "created_at" DESC);

-- ─── 6. Webhook semantic deduplication ───────────────────────────────────────
--
-- payment_events already has the provider's event id as its PRIMARY KEY, which
-- makes a replayed delivery a key conflict. That is not sufficient on its own:
-- Stripe documents that "in some cases, two separate Event objects are
-- generated and sent", with different event ids for one underlying change.
--
-- This index supports the second dedup key — (type, object id) — which the
-- processor consults before acting. It is an index rather than a UNIQUE
-- constraint on purpose: two genuinely distinct events of the same type can
-- exist for one object over time (a payment that fails, is retried and
-- succeeds), so uniqueness would refuse legitimate history. Deduplication is a
-- decision the processor makes with the order's current state in hand.
CREATE INDEX "payment_events_type_related_object_idx"
  ON "payment_events" ("type", "related_object_id", "received_at" DESC);

-- ─── 7. Commission snapshots are immutable once the order leaves DRAFT ───────
--
-- "Changing a commission rule tomorrow must NEVER rewrite yesterday's orders"
-- is the schema's own stated rule. Until now it was only a comment.
CREATE OR REPLACE FUNCTION kurdora_orders_snapshot_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" = 'DRAFT' THEN
    RETURN NEW;
  END IF;

  IF NEW."commission_rule_id"      IS DISTINCT FROM OLD."commission_rule_id"
     OR NEW."commission_percent_bps"  IS DISTINCT FROM OLD."commission_percent_bps"
     OR NEW."commission_fixed_minor"  IS DISTINCT FROM OLD."commission_fixed_minor"
     OR NEW."commission_amount_minor" IS DISTINCT FROM OLD."commission_amount_minor"
     OR NEW."seller_amount_minor"     IS DISTINCT FROM OLD."seller_amount_minor"
     OR NEW."subtotal_minor"          IS DISTINCT FROM OLD."subtotal_minor"
     OR NEW."total_minor"             IS DISTINCT FROM OLD."total_minor"
     OR NEW."principal_minor"         IS DISTINCT FROM OLD."principal_minor"
     OR NEW."currency"                IS DISTINCT FROM OLD."currency"
     OR NEW."flow_type"               IS DISTINCT FROM OLD."flow_type"
  THEN
    RAISE EXCEPTION
      'orders: the money snapshot is immutable once an order leaves DRAFT'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "orders_snapshot_immutable"
  BEFORE UPDATE ON "orders"
  FOR EACH ROW EXECUTE FUNCTION kurdora_orders_snapshot_immutable();
