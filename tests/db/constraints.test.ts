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

  describe('offer integrity', () => {
    it('refuses a zero or negative event amount', async () => {
      const offerId = await insertOffer();
      for (const amount of [0, -1]) {
        await expect(
          insertOfferEvent(offerId, { amount }),
        ).rejects.toThrow(/offer_events_amount_positive/);
      }
    });

    it('refuses an actor role the state machine does not know', async () => {
      const offerId = await insertOffer();
      await expect(
        insertOfferEvent(offerId, { actorRole: 'admin' }),
      ).rejects.toThrow(/offer_events_actor_role_valid/);
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
      await expect(
        insertOffer({ listingId: listing, status: 'SUBMITTED' }),
      ).rejects.toThrow(/offers_one_pending_per_buyer_listing/);

      // The index is partial, so a settled offer does not lock the listing.
      await client.query(`UPDATE offers SET status = 'DECLINED' WHERE listing_id = $1`, [listing]);
      await expect(
        insertOffer({ listingId: listing, status: 'SUBMITTED' }),
      ).resolves.toBeDefined();
    });

    it('refuses a zero or negative offer amount', async () => {
      await expect(insertOffer({ amount: 0 })).rejects.toThrow(/offers_amount_positive/);
      await expect(insertOffer({ amount: -500 })).rejects.toThrow(/offers_amount_positive/);
    });
  });
});
