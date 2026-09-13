-- Reverses 'contact_only_marketplace'.
--
-- Drops the constraint only. The category rows are NOT restored to their
-- previous payment flows: which flow each category had is not recoverable from
-- this migration, and guessing would silently re-enable payment collection on
-- the wrong categories. Re-seed to restore intended category configuration.
ALTER TABLE "categories" ALTER COLUMN "transaction_flow" SET DEFAULT 'BUY_NOW';
ALTER TABLE "categories" ALTER COLUMN "allows_online_payment" SET DEFAULT true;

ALTER TABLE "categories"
  DROP CONSTRAINT IF EXISTS "categories_contact_only_flow";
ALTER TABLE "categories"
  DROP CONSTRAINT IF EXISTS "categories_no_online_payment_for_seller_goods";

-- The deleted permission rows are NOT recreated. They are seed data: re-running
-- `pnpm db:seed` against a definition that contains them is how they come back,
-- and inventing rows here would produce permissions with no grants and no
-- matching definition.
