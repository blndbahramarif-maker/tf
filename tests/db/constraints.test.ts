import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createTempDatabase, dropTempDatabase, hasDatabase, runMigrations } from './helpers';

/**
 * Database constraints.
 *
 * These prove that the money rules hold against raw SQL, not merely against
 * code that happens to go through the domain layer. Each test writes something
 * that SHOULD be impossible and asserts the database refuses it.
 */

const DB_NAME = 'kurdora_test_constraints';
let url = '';
let client: Client;

/** Minimal fixture graph, so order and listing constraints can be exercised. */
async function seedFixtures(): Promise<{
  countryId: string;
  categoryId: string;
  userId: string;
  sellerProfileId: string;
  listingId: string;
}> {
  const country = await client.query<{ id: string }>(
    `INSERT INTO countries (id, code, default_currency, updated_at)
     VALUES (gen_random_uuid(), 'GB', 'GBP', now()) RETURNING id`,
  );
  const countryId = country.rows[0]!.id;

  const category = await client.query<{ id: string }>(
    `INSERT INTO categories (id, path, slug, updated_at)
     VALUES (gen_random_uuid(), '/test/', 'test', now()) RETURNING id`,
  );
  const categoryId = category.rows[0]!.id;

  const user = await client.query<{ id: string }>(
    `INSERT INTO users (id, email, updated_at)
     VALUES (gen_random_uuid(), 'seller@example.com', now()) RETURNING id`,
  );
  const userId = user.rows[0]!.id;

  const seller = await client.query<{ id: string }>(
    `INSERT INTO seller_profiles (id, user_id, slug, display_name, country_id, member_since, updated_at)
     VALUES (gen_random_uuid(), $1, 'seller', 'Seller', $2, now(), now()) RETURNING id`,
    [userId, countryId],
  );
  const sellerProfileId = seller.rows[0]!.id;

  const listing = await client.query<{ id: string }>(
    `INSERT INTO listings (id, seller_profile_id, category_id, title, slug, description,
                           currency, country_id, updated_at, price_minor, price_type)
     VALUES (gen_random_uuid(), $1, $2, 'Test', 'test-listing', 'desc', 'GBP', $3, now(), 10000, 'FIXED')
     RETURNING id`,
    [sellerProfileId, categoryId, countryId],
  );

  return { countryId, categoryId, userId, sellerProfileId, listingId: listing.rows[0]!.id };
}

let fx: Awaited<ReturnType<typeof seedFixtures>>;
let orderCounter = 0;
let listingCounter = 0;

/** A second listing owned by the fixture seller, for per-listing rules. */
async function insertListing(): Promise<string> {
  listingCounter += 1;
  const result = await client.query<{ id: string }>(
    `INSERT INTO listings (id, seller_profile_id, category_id, title, slug, description,
                           currency, country_id, updated_at, price_minor, price_type)
     VALUES (gen_random_uuid(), $1, $2, 'Offer fixture', $3, 'desc', 'GBP', $4, now(), 100000, 'FIXED')
     RETURNING id`,
    [fx.sellerProfileId, fx.categoryId, `offer-listing-${listingCounter}`, fx.countryId],
  );
  return result.rows[0]!.id;
}

async function insertOffer(
  over: { listingId?: string; amount?: number; status?: string } = {},
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO offers (id, listing_id, buyer_id, amount_minor, currency, status,
                         expires_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, 'GBP', $4::offer_status,
             now() + interval '7 days', now())
     RETURNING id`,
    [
      over.listingId ?? (await insertListing()),
      fx.userId,
      over.amount ?? 90000,
      over.status ?? 'SUBMITTED',
    ],
  );
  return result.rows[0]!.id;
}

function insertOfferEvent(
  offerId: string,
  over: { amount?: number; actorRole?: string; actorId?: string | null } = {},
) {
  const actorRole = over.actorRole ?? 'buyer';
  const actorId = 'actorId' in over ? over.actorId : fx.userId;
  return client.query(
    `INSERT INTO offer_events (id, offer_id, from_status, to_status, actor_role, actor_id,
                               amount_minor, currency)
     VALUES (gen_random_uuid(), $1, NULL, 'SUBMITTED', $2, $3, $4, 'GBP')`,
    [offerId, actorRole, actorId, over.amount ?? 9000],
  );
}

interface OrderOverrides {
  subtotal?: number;
  shipping?: number;
  tax?: number;
  total?: number;
  commission?: number;
  seller?: number;
  bps?: number;
  currency?: string;
  status?: string;
  listingId?: string;
}

async function insertOrder(over: OrderOverrides = {}): Promise<void> {
  orderCounter += 1;
  const values = {
    subtotal: 10_000,
    shipping: 0,
    tax: 0,
    total: 10_000,
    commission: 600,
    seller: 9_400,
    bps: 600,
    currency: 'GBP',
    status: 'PENDING_PAYMENT',
    ...over,
  };

  await client.query(
    `INSERT INTO orders (id, order_number, listing_id, buyer_id, seller_profile_id, flow_type,
                         status, subtotal_minor, shipping_minor, tax_minor, total_minor, currency,
                         commission_percent_bps, commission_amount_minor, seller_amount_minor, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 'BUY_NOW', $5::order_status,
             $6, $7, $8, $9, $10, $11, $12, $13, now())`,
    [
      `ORD-${orderCounter}`,
      values.listingId ?? fx.listingId,
      fx.userId,
      fx.sellerProfileId,
      values.status,
      values.subtotal,
      values.shipping,
      values.tax,
      values.total,
      values.currency,
      values.bps,
      values.commission,
      values.seller,
    ],
  );
}

describe.skipIf(!hasDatabase)('database constraints', () => {
  beforeAll(async () => {
    url = await createTempDatabase(DB_NAME);
    await runMigrations(url);
    client = new Client({ connectionString: url });
    await client.connect();
    fx = await seedFixtures();
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    await dropTempDatabase(DB_NAME);
  }, 60_000);

  describe('order money integrity', () => {
    it('accepts a consistent order', async () => {
      await expect(insertOrder()).resolves.toBeUndefined();
    });

    it('rejects a total that is not the sum of its parts', async () => {
      await expect(insertOrder({ total: 9_999 })).rejects.toThrow(
        /orders_total_is_sum_of_parts|orders_seller_amount_is_remainder/,
      );
    });

    it('rejects a seller amount that is not total minus commission', async () => {
      // The bug this prevents: someone recomputing the seller share
      // independently and drifting by a penny.
      await expect(insertOrder({ seller: 9_401 })).rejects.toThrow(
        /orders_seller_amount_is_remainder/,
      );
    });

    it('rejects commission larger than the order', async () => {
      await expect(insertOrder({ commission: 10_001, seller: -1 })).rejects.toThrow(
        /orders_commission_within_total|orders_amounts_non_negative/,
      );
    });

    it('rejects a negative amount', async () => {
      await expect(insertOrder({ subtotal: -1, total: -1, seller: -601 })).rejects.toThrow(
        /orders_amounts_non_negative/,
      );
    });

    it('rejects basis points above 100%', async () => {
      await expect(insertOrder({ bps: 10_001 })).rejects.toThrow(/orders_commission_bps_sane/);
    });

    it('rejects a lowercase currency code', async () => {
      // Mixed case would silently split reporting between 'gbp' and 'GBP'.
      await expect(insertOrder({ currency: 'gbp' })).rejects.toThrow(/orders_currency_upper/);
    });

    it('allows only one open order per buyer per listing', async () => {
      // The database half of double-payment protection.
      //
      // Uses its own listing so the assertion does not depend on what earlier
      // tests left behind.
      const listing = await client.query<{ id: string }>(
        `INSERT INTO listings (id, seller_profile_id, category_id, title, slug, description,
                               currency, country_id, updated_at, price_minor, price_type)
         VALUES (gen_random_uuid(), $1, $2, 'Dup', 'dup-listing', 'd', 'GBP', $3, now(), 10000, 'FIXED')
         RETURNING id`,
        [fx.sellerProfileId, fx.categoryId, fx.countryId],
      );
      const listingId = listing.rows[0]!.id;

      const open = () => insertOrder({ status: 'PENDING_PAYMENT', listingId });

      await expect(open()).resolves.toBeUndefined();
      await expect(open()).rejects.toThrow(/orders_one_open_per_buyer_listing/);

      // Once the first order leaves the open states, a new one is allowed —
      // a buyer whose payment expired must be able to try again.
      await client.query(
        `UPDATE orders SET status = 'EXPIRED' WHERE listing_id = $1 AND status = 'PENDING_PAYMENT'`,
        [listingId],
      );
      await expect(open()).resolves.toBeUndefined();
    });
  });

  describe('listing integrity', () => {
    it('allows only one primary image per listing', async () => {
      const insertImage = (isPrimary: boolean) =>
        client.query(
          `INSERT INTO listing_images (id, listing_id, storage_key, url, is_primary)
           VALUES (gen_random_uuid(), $1, 'k', 'u', $2)`,
          [fx.listingId, isPrimary],
        );

      await expect(insertImage(true)).resolves.toBeDefined();
      await expect(insertImage(true)).rejects.toThrow(/listing_images_one_primary_per_listing/);
      // Non-primary images are unrestricted.
      await expect(insertImage(false)).resolves.toBeDefined();
      await expect(insertImage(false)).resolves.toBeDefined();
    });

    it('rejects a FIXED-price listing with no price', async () => {
      await expect(
        client.query(
          `INSERT INTO listings (id, seller_profile_id, category_id, title, slug, description,
                                 currency, country_id, updated_at, price_type)
           VALUES (gen_random_uuid(), $1, $2, 'No price', 'no-price', 'd', 'GBP', $3, now(), 'FIXED')`,
          [fx.sellerProfileId, fx.categoryId, fx.countryId],
        ),
      ).rejects.toThrow(/listings_fixed_price_requires_amount/);
    });
  });

  describe('attribute values', () => {
    it('requires exactly one typed value', async () => {
      const attribute = await client.query<{ id: string }>(
        `INSERT INTO attribute_definitions (id, category_id, key, data_type, updated_at)
         VALUES (gen_random_uuid(), $1, 'mileage', 'INTEGER', now()) RETURNING id`,
        [fx.categoryId],
      );
      const attributeId = attribute.rows[0]!.id;

      // Zero values set.
      await expect(
        client.query(
          `INSERT INTO listing_attribute_values (id, listing_id, attribute_definition_id)
           VALUES (gen_random_uuid(), $1, $2)`,
          [fx.listingId, attributeId],
        ),
      ).rejects.toThrow(/exactly_one_value/);

      // Two values set.
      await expect(
        client.query(
          `INSERT INTO listing_attribute_values (id, listing_id, attribute_definition_id, value_integer, value_text)
           VALUES (gen_random_uuid(), $1, $2, 50000, 'fifty thousand')`,
          [fx.listingId, attributeId],
        ),
      ).rejects.toThrow(/exactly_one_value/);

      // Exactly one.
      await expect(
        client.query(
          `INSERT INTO listing_attribute_values (id, listing_id, attribute_definition_id, value_integer)
           VALUES (gen_random_uuid(), $1, $2, 50000)`,
          [fx.listingId, attributeId],
        ),
      ).resolves.toBeDefined();

      // And a listing cannot hold TWO values for the same attribute — the hole
      // that a plain unique index over a nullable option_id would have left.
      await expect(
        client.query(
          `INSERT INTO listing_attribute_values (id, listing_id, attribute_definition_id, value_integer)
           VALUES (gen_random_uuid(), $1, $2, 90000)`,
          [fx.listingId, attributeId],
        ),
      ).rejects.toThrow(/listing_attribute_values_listing_id_attribute_definition_id_key/);
    });
  });

  describe('commission rules', () => {
    it('rejects a fixed amount without a currency', async () => {
      await expect(
        client.query(
          `INSERT INTO commission_rules (id, scope_type, model, fixed_minor, updated_at)
           VALUES (gen_random_uuid(), 'PLATFORM', 'FIXED', 500, now())`,
        ),
      ).rejects.toThrow(/commission_rules_fixed_requires_currency/);
    });

    it('rejects a scope whose target does not match', async () => {
      await expect(
        client.query(
          `INSERT INTO commission_rules (id, scope_type, percent_bps, updated_at)
           VALUES (gen_random_uuid(), 'CATEGORY', 600, now())`,
        ),
      ).rejects.toThrow(/commission_rules_scope_target_matches/);
    });

    it('allows only one active platform default', async () => {
      // A second default would make commission resolution non-deterministic.
      await client.query(
        `INSERT INTO commission_rules (id, scope_type, applies_to, percent_bps, updated_at)
         VALUES (gen_random_uuid(), 'PLATFORM', 'ORDER', 600, now())`,
      );
      await expect(
        client.query(
          `INSERT INTO commission_rules (id, scope_type, applies_to, percent_bps, updated_at)
           VALUES (gen_random_uuid(), 'PLATFORM', 'ORDER', 700, now())`,
        ),
      ).rejects.toThrow(/commission_rules_one_active_platform_default/);
    });
  });

  describe('payment event identity', () => {
    it('uses the provider event id as the primary key, so replays conflict', async () => {
      // This is what makes webhook processing exactly-once.
      const insert = () =>
        client.query(
          `INSERT INTO payment_events (id, type, payload, signature_verified)
           VALUES ('evt_3Q1abcdef', 'payment_intent.succeeded', '{}'::jsonb, true)`,
        );
      await expect(insert()).resolves.toBeDefined();
      await expect(insert()).rejects.toThrow(/payment_events_pkey|duplicate key/);
    });
  });

  describe('self-reference guards', () => {
    it('refuses a user blocking themselves', async () => {
      await expect(
        client.query(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $1)`, [
          fx.userId,
        ]),
      ).rejects.toThrow(/user_blocks_not_self/);
    });

    it('refuses a conversation with oneself', async () => {
      await expect(
        client.query(
          `INSERT INTO conversations (id, buyer_id, seller_id, updated_at)
           VALUES (gen_random_uuid(), $1, $1, now())`,
          [fx.userId],
        ),
      ).rejects.toThrow(/conversations_not_self/);
    });
  });

  describe('append-only tables', () => {
    it('refuses updates and deletes on audit_logs', async () => {
      await client.query(
        `INSERT INTO audit_logs (id, actor_type, action, entity_type)
         VALUES (gen_random_uuid(), 'system', 'test', 'none')`,
      );
      await expect(client.query(`UPDATE audit_logs SET action = 'x'`)).rejects.toThrow(
        /append-only/,
      );
      await expect(client.query(`DELETE FROM audit_logs`)).rejects.toThrow(/append-only/);
    });

    it('refuses updates and deletes on offer_events', async () => {
      const offerId = await insertOffer();
      await client.query(
        `INSERT INTO offer_events (id, offer_id, from_status, to_status, actor_role, actor_id,
                                   amount_minor, currency)
         VALUES (gen_random_uuid(), $1, NULL, 'SUBMITTED', 'buyer', $2, 9000, 'GBP')`,
        [offerId, fx.userId],
      );

      // The offer history is the record of who agreed to what. If it can be
      // edited after the fact it will still be believed, which is worse than
      // having none at all.
      await expect(
        client.query(`UPDATE offer_events SET to_status = 'ACCEPTED' WHERE offer_id = $1`, [
          offerId,
        ]),
      ).rejects.toThrow(/append-only/);
      await expect(
        client.query(`DELETE FROM offer_events WHERE offer_id = $1`, [offerId]),
      ).rejects.toThrow(/append-only/);
    });
  });

  describe('payment integrity (Phase 7 Part 1)', () => {
    /** A FEE_ONLY order: £50,000 sale, £250 fee. */
    async function insertFeeOnlyOrder(
      over: {
        total?: number;
        commission?: number;
        seller?: number;
        principal?: number | null;
      } = {},
    ) {
      orderCounter += 1;
      const values = {
        total: 25_000,
        commission: 25_000,
        seller: 0,
        principal: 5_000_000,
        ...over,
      };
      // A fresh listing each time: `orders_one_open_per_buyer_listing` permits
      // the fixture buyer only one open order per listing.
      const listingId = await insertListing();
      return client.query<{ id: string }>(
        `INSERT INTO orders (id, order_number, listing_id, buyer_id, seller_profile_id, flow_type,
                             status, subtotal_minor, shipping_minor, tax_minor, total_minor,
                             principal_minor, currency, commission_percent_bps,
                             commission_amount_minor, seller_amount_minor, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'FEE_ONLY', 'DRAFT',
                 $5, 0, 0, $5, $6, 'GBP', 50, $7, $8, now())
         RETURNING id`,
        [
          `FEE-${orderCounter}`,
          listingId,
          fx.userId,
          fx.sellerProfileId,
          values.total,
          values.principal,
          values.commission,
          values.seller,
        ],
      );
    }

    it('accepts a correct fee-only order', async () => {
      await expect(insertFeeOnlyOrder()).resolves.toBeDefined();
    });

    it('REFUSES a fee-only order that charges the sale principal', async () => {
      // The £50,000 mistake, written by hand with every TypeScript check
      // bypassed. This is the constraint the whole flow rests on.
      await expect(
        insertFeeOnlyOrder({ total: 5_000_000, commission: 5_000_000, seller: 0 }),
      ).rejects.toThrow(/orders_fee_only_principal_recorded/);
    });

    it('REFUSES a fee-only order whose total is not exactly the commission', async () => {
      await expect(insertFeeOnlyOrder({ total: 30_000, commission: 25_000 })).rejects.toThrow(
        /orders_fee_only_charges_fee_alone|orders_seller_amount_is_remainder/,
      );
    });

    it('REFUSES a fee-only order that owes the seller anything', async () => {
      // Kurdora never holds the sale price, so it can never owe the seller.
      await expect(
        insertFeeOnlyOrder({ total: 25_000, commission: 20_000, seller: 5_000 }),
      ).rejects.toThrow(/orders_fee_only_charges_fee_alone/);
    });

    it('REFUSES a fee-only order with no recorded principal', async () => {
      await expect(insertFeeOnlyOrder({ principal: null })).rejects.toThrow(
        /orders_fee_only_principal_recorded/,
      );
    });

    it('refuses a non-positive principal', async () => {
      await expect(insertFeeOnlyOrder({ principal: 0 })).rejects.toThrow(
        /orders_principal_positive|orders_fee_only_principal_recorded/,
      );
    });

    it('refuses half a transfer leg on a payment', async () => {
      const order = await insertFeeOnlyOrder();
      const orderId = order.rows[0]!.id;

      // A destination without a fee moves money to nowhere.
      await expect(
        client.query(
          `INSERT INTO payments (id, order_id, provider_payment_intent_id, status, amount_minor,
                                 currency, flow_type, destination_account_id, updated_at)
           VALUES (gen_random_uuid(), $1, 'pi_half_a', 'REQUIRES_PAYMENT_METHOD', 25000,
                   'GBP', 'BUY_NOW', 'acct_x', now())`,
          [orderId],
        ),
      ).rejects.toThrow(/payments_transfer_leg_is_whole/);

      // And a fee without a destination.
      await expect(
        client.query(
          `INSERT INTO payments (id, order_id, provider_payment_intent_id, status, amount_minor,
                                 currency, flow_type, application_fee_amount_minor, updated_at)
           VALUES (gen_random_uuid(), $1, 'pi_half_b', 'REQUIRES_PAYMENT_METHOD', 25000,
                   'GBP', 'BUY_NOW', 100, now())`,
          [orderId],
        ),
      ).rejects.toThrow(/payments_transfer_leg_is_whole/);
    });

    it('REFUSES a transfer leg on a fee-only payment', async () => {
      const order = await insertFeeOnlyOrder();
      await expect(
        client.query(
          `INSERT INTO payments (id, order_id, provider_payment_intent_id, status, amount_minor,
                                 currency, flow_type, destination_account_id,
                                 application_fee_amount_minor, updated_at)
           VALUES (gen_random_uuid(), $1, 'pi_feeonly_transfer', 'REQUIRES_PAYMENT_METHOD', 25000,
                   'GBP', 'FEE_ONLY', 'acct_x', 100, now())`,
          [order.rows[0]!.id],
        ),
      ).rejects.toThrow(/payments_fee_only_has_no_transfer/);
    });

    it('allows only one live payment per order', async () => {
      const order = await insertFeeOnlyOrder();
      const orderId = order.rows[0]!.id;

      const insert = (intent: string, status: string) =>
        client.query(
          `INSERT INTO payments (id, order_id, provider_payment_intent_id, status, amount_minor,
                                 currency, flow_type, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3::payment_status, 25000, 'GBP', 'FEE_ONLY', now())`,
          [orderId, intent, status],
        );

      await expect(insert('pi_live_1', 'REQUIRES_PAYMENT_METHOD')).resolves.toBeDefined();
      await expect(insert('pi_live_2', 'PROCESSING')).rejects.toThrow(
        /payments_one_live_per_order/,
      );

      // A settled attempt does not lock the order: a declined card can retry.
      await client.query(`UPDATE payments SET status = 'FAILED' WHERE order_id = $1`, [orderId]);
      await expect(insert('pi_live_3', 'REQUIRES_PAYMENT_METHOD')).resolves.toBeDefined();
    });

    it('allows one payment attempt per provider charge, and no more', async () => {
      const order = await insertFeeOnlyOrder();
      const payment = await client.query<{ id: string }>(
        `INSERT INTO payments (id, order_id, provider_payment_intent_id, status, amount_minor,
                               currency, flow_type, updated_at)
         VALUES (gen_random_uuid(), $1, 'pi_attempts', 'PROCESSING', 25000, 'GBP', 'FEE_ONLY', now())
         RETURNING id`,
        [order.rows[0]!.id],
      );

      const insertAttempt = (charge: string, status = 'PENDING') =>
        client.query(
          `INSERT INTO payment_attempts (id, payment_id, provider_charge_id, status,
                                         amount_minor, currency, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, 25000, 'GBP', now())`,
          [payment.rows[0]!.id, charge, status],
        );

      await expect(insertAttempt('ch_one')).resolves.toBeDefined();
      // A replayed webhook must not create a second attempt for one charge.
      await expect(insertAttempt('ch_one')).rejects.toThrow(/provider_charge_id/);
      // A genuine retry is a DIFFERENT charge, and is allowed.
      await expect(insertAttempt('ch_two', 'FAILED')).resolves.toBeDefined();
      await expect(insertAttempt('ch_three', 'NONSENSE')).rejects.toThrow(
        /payment_attempts_status_valid/,
      );
    });

    it('makes the money snapshot immutable once an order leaves DRAFT', async () => {
      const order = await insertFeeOnlyOrder();
      const orderId = order.rows[0]!.id;

      // Still DRAFT: correctable.
      await expect(
        client.query(`UPDATE orders SET commission_amount_minor = 25000 WHERE id = $1`, [orderId]),
      ).resolves.toBeDefined();

      await client.query(`UPDATE orders SET status = 'PENDING_PAYMENT' WHERE id = $1`, [orderId]);

      // "Changing a commission rule tomorrow must NEVER rewrite yesterday's
      // orders" — enforced, not merely documented.
      for (const column of [
        'commission_amount_minor = 1',
        'commission_percent_bps = 0',
        'total_minor = 1',
        'principal_minor = 1',
        'seller_amount_minor = 1',
        `currency = 'USD'`,
        `flow_type = 'BUY_NOW'`,
      ]) {
        await expect(
          client.query(`UPDATE orders SET ${column} WHERE id = $1`, [orderId]),
          column,
        ).rejects.toThrow(/immutable/);
      }

      // The status itself still moves — the trigger guards money, not state.
      await expect(
        client.query(`UPDATE orders SET status = 'CANCELLED' WHERE id = $1`, [orderId]),
      ).resolves.toBeDefined();
    });
  });

  describe('connected-account integrity (Phase 7 Part 2)', () => {
    /**
     * Every assertion here is written in raw SQL with every TypeScript check
     * bypassed. That is the point: the application already refuses these, and
     * these tests prove the database refuses them too — because application
     * checks bind only the code that goes through them (ADR-0010).
     */

    /**
     * A minimal FEE_ONLY order to hang a payment off.
     *
     * Local rather than shared with the Part 1 block above: these tests are
     * about payment_attempts, and borrowing a fixture whose invariants belong
     * to a different describe is how one block's edit breaks another's.
     */
    let part2OrderCounter = 0;
    async function insertOrderForPayment(): Promise<string> {
      part2OrderCounter += 1;
      const listingId = await insertListing();
      const result = await client.query<{ id: string }>(
        `INSERT INTO orders (id, order_number, listing_id, buyer_id, seller_profile_id, flow_type,
                             status, subtotal_minor, shipping_minor, tax_minor, total_minor,
                             principal_minor, currency, commission_percent_bps,
                             commission_amount_minor, seller_amount_minor, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'FEE_ONLY', 'DRAFT',
                 25000, 0, 0, 25000, 5000000, 'GBP', 50, 25000, 0, now())
         RETURNING id`,
        [`P2-${part2OrderCounter}-${Date.now()}`, listingId, fx.userId, fx.sellerProfileId],
      );
      return result.rows[0]!.id;
    }

    const setProfile = (columns: string, values: unknown[]) =>
      client.query(`UPDATE seller_profiles SET ${columns} WHERE id = $1`, [
        fx.sellerProfileId,
        ...values,
      ]);

    it('REFUSES charges_enabled without a connected account', async () => {
      // "Payable with no account" is the state that would send a destination
      // charge to nowhere. It must be unrepresentable, not merely unlikely.
      await expect(
        setProfile(`stripe_account_id = NULL, charges_enabled = true`, []),
      ).rejects.toThrow(/seller_profiles_enabled_requires_account/);

      await expect(
        setProfile(`stripe_account_id = NULL, payouts_enabled = true`, []),
      ).rejects.toThrow(/seller_profiles_enabled_requires_account/);
    });

    it('REFUSES an ACTIVE onboarding status without a connected account', async () => {
      await expect(
        setProfile(`stripe_account_id = NULL, onboarding_status = 'ACTIVE'`, []),
      ).rejects.toThrow(/seller_profiles_active_requires_account/);
    });

    it('accepts a genuinely onboarded seller', async () => {
      await expect(
        setProfile(
          `stripe_account_id = $2, charges_enabled = true, payouts_enabled = true,
           onboarding_status = 'ACTIVE', details_submitted = true`,
          [`acct_constraint_${Date.now()}`],
        ),
      ).resolves.toBeDefined();
    });

    it('REFUSES a nonsensical payout delay', async () => {
      await expect(setProfile(`stripe_payout_delay_days = -1`, [])).rejects.toThrow(
        /seller_profiles_stripe_payout_delay_sane/,
      );
    });

    it('REFUSES a refund larger than the charge it refunds', async () => {
      const payment = await client.query<{ id: string }>(
        `INSERT INTO payments (id, order_id, provider_payment_intent_id, status, amount_minor,
                               currency, flow_type, updated_at)
         VALUES (gen_random_uuid(), $1, 'pi_refund_bounds', 'SUCCEEDED', 25000, 'GBP',
                 'FEE_ONLY', now())
         RETURNING id`,
        [await insertOrderForPayment()],
      );

      const insertAttempt = (charge: string, refunded: number, flag = false) =>
        client.query(
          `INSERT INTO payment_attempts (id, payment_id, provider_charge_id, status,
                                         amount_minor, currency, amount_refunded_minor,
                                         refunded, updated_at)
           VALUES (gen_random_uuid(), $1, $2, 'SUCCEEDED', 25000, 'GBP', $3, $4, now())`,
          [payment.rows[0]!.id, charge, refunded, flag],
        );

      // Refunding more than was taken is money appearing from nowhere.
      await expect(insertAttempt('ch_over_refund', 25_001)).rejects.toThrow(
        /payment_attempts_refund_within_amount/,
      );
      // A full refund of exactly the charge is legitimate.
      await expect(insertAttempt('ch_full_refund', 25_000, true)).resolves.toBeDefined();
    });

    it('REFUSES a "fully refunded" flag with nothing refunded', async () => {
      const payment = await client.query<{ id: string }>(
        `INSERT INTO payments (id, order_id, provider_payment_intent_id, status, amount_minor,
                               currency, flow_type, updated_at)
         VALUES (gen_random_uuid(), $1, 'pi_refund_flag', 'SUCCEEDED', 25000, 'GBP',
                 'FEE_ONLY', now())
         RETURNING id`,
        [await insertOrderForPayment()],
      );

      // Stripe's `refunded` means FULLY refunded. True with a zero amount is
      // a contradiction, and a reconciliation report would believe it.
      await expect(
        client.query(
          `INSERT INTO payment_attempts (id, payment_id, provider_charge_id, status,
                                         amount_minor, currency, amount_refunded_minor,
                                         refunded, updated_at)
           VALUES (gen_random_uuid(), $1, 'ch_flag_only', 'SUCCEEDED', 25000, 'GBP', 0,
                   true, now())`,
          [payment.rows[0]!.id],
        ),
      ).rejects.toThrow(/payment_attempts_refunded_implies_amount/);
    });
  });

  describe('offer integrity', () => {
    it('refuses a zero or negative event amount', async () => {
      const offerId = await insertOffer();
      for (const amount of [0, -1]) {
        await expect(insertOfferEvent(offerId, { amount })).rejects.toThrow(
          /offer_events_amount_positive/,
        );
      }
    });

    it('refuses an actor role the state machine does not know', async () => {
      const offerId = await insertOffer();
      await expect(insertOfferEvent(offerId, { actorRole: 'admin' })).rejects.toThrow(
        /offer_events_actor_role_valid/,
      );
    });

    it('refuses a party transition with no actor', async () => {
      // "The buyer did this, and we do not know who the buyer was" is not a
      // history entry, it is a hole in one.
      const offerId = await insertOffer();
      await expect(
        insertOfferEvent(offerId, { actorRole: 'buyer', actorId: null }),
      ).rejects.toThrow(/offer_events_actor_present/);
    });

    it('refuses a system transition that names an actor', async () => {
      // Expiry is nobody's decision. Attributing it to a person would make the
      // trail say something untrue.
      const offerId = await insertOffer();
      await expect(
        insertOfferEvent(offerId, { actorRole: 'system', actorId: fx.userId }),
      ).rejects.toThrow(/offer_events_actor_present/);
    });

    it('accepts a system transition with no actor', async () => {
      const offerId = await insertOffer();
      await expect(
        insertOfferEvent(offerId, { actorRole: 'system', actorId: null }),
      ).resolves.toBeDefined();
    });

    it('allows a buyer only one open offer per listing', async () => {
      const listing = await insertListing();
      await insertOffer({ listingId: listing, status: 'SUBMITTED' });

      // `offers_one_pending_per_buyer_listing`, so a buyer cannot bury a
      // seller under simultaneous bids on the same item.
      await expect(insertOffer({ listingId: listing, status: 'SUBMITTED' })).rejects.toThrow(
        /offers_one_pending_per_buyer_listing/,
      );

      // The index is partial, so a settled offer does not lock the listing.
      await client.query(`UPDATE offers SET status = 'DECLINED' WHERE listing_id = $1`, [listing]);
      await expect(insertOffer({ listingId: listing, status: 'SUBMITTED' })).resolves.toBeDefined();
    });

    it('refuses a zero or negative offer amount', async () => {
      await expect(insertOffer({ amount: 0 })).rejects.toThrow(/offers_amount_positive/);
      await expect(insertOffer({ amount: -500 })).rejects.toThrow(/offers_amount_positive/);
    });
  });
});
