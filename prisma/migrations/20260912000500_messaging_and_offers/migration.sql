-- Phase 6, part 2 of 2 — offer audit trail, constraints and messaging indexes.
--
-- Part 1 added the enum values and committed. They may be used from here.

-- ─── offers ────────────────────────────────────────────────────────────────
ALTER TABLE "offers"
  ADD COLUMN "submitted_at" TIMESTAMPTZ(6),
  ADD COLUMN "withdrawn_at" TIMESTAMPTZ(6),
  ADD COLUMN "cancelled_at" TIMESTAMPTZ(6);

ALTER TABLE "offers" ALTER COLUMN "status" SET DEFAULT 'SUBMITTED';

-- NOTE: `offers_amount_positive` and `expires_at NOT NULL` are NOT declared
-- here. The Phase 2 constraints migration already ships both; re-adding an
-- existing constraint aborts the migration. Checked against pg_constraint
-- rather than assumed.

-- Answers "the open offers on my listing" — the seller's most common query.
CREATE INDEX "offers_listing_open" ON "offers" ("listing_id", "created_at" DESC)
  WHERE "status" IN ('DRAFT', 'SUBMITTED');

-- ─── offer_events ──────────────────────────────────────────────────────────
CREATE TABLE "offer_events" (
  "id"           UUID PRIMARY KEY,
  "offer_id"     UUID NOT NULL,
  "from_status"  "offer_status",
  "to_status"    "offer_status" NOT NULL,
  "actor_role"   TEXT NOT NULL,
  "actor_id"     UUID,
  "amount_minor" BIGINT NOT NULL,
  "currency"     CHAR(3) NOT NULL,
  "note"         TEXT,
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "offer_events_offer_id_fkey"
    FOREIGN KEY ("offer_id") REFERENCES "offers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "offer_events_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,

  -- Money is integer minor units (ADR-0006), enforced in the database as well
  -- as the domain because an application check binds only code that goes
  -- through it (ADR-0010).
  CONSTRAINT "offer_events_amount_positive" CHECK ("amount_minor" > 0),
  CONSTRAINT "offer_events_actor_role_valid"
    CHECK ("actor_role" IN ('buyer', 'seller', 'system')),
  -- A system transition has no actor; a party transition must name one.
  CONSTRAINT "offer_events_actor_present"
    CHECK (("actor_role" = 'system') = ("actor_id" IS NULL))
);

CREATE INDEX "offer_events_offer_id_created_at_idx"
  ON "offer_events" ("offer_id", "created_at");

-- Append-only. The audit trail is what a dispute is argued from, so it is
-- protected by the database rather than by everyone remembering not to write
-- an UPDATE. Same approach as the ledger (ADR-0010).
CREATE OR REPLACE FUNCTION kurdora_offer_events_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'offer_events is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "offer_events_no_update"
  BEFORE UPDATE ON "offer_events"
  FOR EACH ROW EXECUTE FUNCTION kurdora_offer_events_append_only();

CREATE TRIGGER "offer_events_no_delete"
  BEFORE DELETE ON "offer_events"
  FOR EACH ROW EXECUTE FUNCTION kurdora_offer_events_append_only();

-- ─── messaging ─────────────────────────────────────────────────────────────
-- Unread counting is an anti-join between messages and message_reads,
-- excluding the reader's own messages. Without this index the inbox degrades
-- into a sequential scan per conversation.
CREATE INDEX "messages_conversation_sender_created"
  ON "messages" ("conversation_id", "sender_id", "created_at" DESC);

-- Messages are never queried unbounded: every read is by conversation and
-- keyset-paginated on (created_at, id). This serves that cursor comparison.
CREATE INDEX "messages_conversation_keyset"
  ON "messages" ("conversation_id", "created_at" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL;
