-- Kurdora becomes a CONTACT-ONLY marketplace.
--
-- The business model changed: Kurdora provides the place where sellers
-- advertise and buyers find them, and the transaction happens directly between
-- the two of them, outside Kurdora. Kurdora does not collect the sale price,
-- hold buyer money, or transfer funds to sellers.
--
-- This migration makes that true in the DATABASE, not only in application code,
-- because an application check binds only the code that goes through it
-- (ADR-0010). A category is a row an admin can edit; without the constraint
-- below, re-enabling a payment flow would be one UPDATE away.
--
-- NOTHING IS DROPPED HERE. The order, payment, ledger, payout, refund and
-- dispute tables are left in place, empty and unwritten. Dropping them would be
-- a large irreversible change with no functional benefit, and they are the
-- foundation for charging for KURDORA'S OWN services (paid or promoted
-- listings) later — which is a different thing from processing a seller's sale.

-- 1. Every category becomes contact-only.
UPDATE "categories"
SET "transaction_flow"        = 'CONTACT_ONLY',
    "allows_online_payment"   = false,
    "max_online_amount_minor" = NULL;

-- 2. And can never stop being so without a deliberate, reviewed migration.
--
-- Deliberately phrased as "no category may take money for a seller's goods"
-- rather than "flow must equal CONTACT_ONLY": it is the MONEY that matters, and
-- this leaves room to introduce a differently-named non-paying flow without
-- touching the constraint.
ALTER TABLE "categories"
  ADD CONSTRAINT "categories_no_online_payment_for_seller_goods"
  CHECK ("allows_online_payment" = false AND "max_online_amount_minor" IS NULL);

-- 3. And the flow itself is pinned.
--
-- Not belt-and-braces. The flow is what the PUBLIC UI reads to decide what to
-- tell a buyer, and the other flows say things like "bought and paid for
-- through the platform". Leaving the column free would let one admin edit put a
-- false claim about payment protection on a live page, even with payment
-- collection already impossible. The claim is the risk, not just the charge.
ALTER TABLE "categories"
  ADD CONSTRAINT "categories_contact_only_flow"
  CHECK ("transaction_flow" = 'CONTACT_ONLY');

-- 4. The column DEFAULTS follow the constraints.
--
-- Left alone, a category created without naming these columns would inherit
-- BUY_NOW/true and be refused by the constraints above — a default that cannot
-- be inserted is a trap for whoever writes the next fixture or admin form.
ALTER TABLE "categories" ALTER COLUMN "transaction_flow" SET DEFAULT 'CONTACT_ONLY';
ALTER TABLE "categories" ALTER COLUMN "allows_online_payment" SET DEFAULT false;

-- 5. Permissions that existed only to take money for a seller's sale.
--
-- The seed already revokes the GRANTS (no role holds these), so they are
-- already inert — deny-by-default means an ungranted permission grants nothing.
-- The rows are removed too so the permission list stays an honest description
-- of what the platform can actually do, rather than a list of capabilities
-- with no code behind them.
DELETE FROM "role_permissions" WHERE "permission_id" IN (
  SELECT "id" FROM "permissions" WHERE "key" IN (
    'order:create', 'payment:create', 'order:read_own', 'order:read_any',
    'order:cancel', 'payment:read_any', 'refund:issue', 'payout:read_own',
    'payout:read_any', 'payout:release', 'payout:hold', 'dispute:manage',
    'seller:manage_payouts'
  )
);

DELETE FROM "permissions" WHERE "key" IN (
  'order:create', 'payment:create', 'order:read_own', 'order:read_any',
  'order:cancel', 'payment:read_any', 'refund:issue', 'payout:read_own',
  'payout:read_any', 'payout:release', 'payout:hold', 'dispute:manage',
  'seller:manage_payouts'
);
