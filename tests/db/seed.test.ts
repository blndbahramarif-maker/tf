import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Client } from 'pg';
import { seed } from '../../prisma/seed';
import { CATEGORIES, COMMISSION_RULES, PERMISSIONS, ROLES } from '../../prisma/seed/data';
import {
  createTempDatabase,
  dropTempDatabase,
  hasDatabase,
  runMigrations,
  withClient,
} from './helpers';

/**
 * Seed idempotency.
 *
 * Seeds run on every developer machine, in CI on every push, and on staging
 * after every deploy. A seed that is only safe the first time is a seed that
 * will eventually duplicate a category or double a commission rule on a live
 * system. So it is run three times and the resulting state compared.
 */

const DB_NAME = 'kurdora_test_seed';
let url = '';

const COUNTED_TABLES = [
  'currencies',
  'countries',
  'country_translations',
  'cities',
  'categories',
  'category_translations',
  'attribute_definitions',
  'attribute_options',
  'attribute_option_translations',
  'permissions',
  'roles',
  'role_permissions',
  'commission_rules',
  'settings',
  'prohibited_item_rules',
] as const;

async function countRows(client: Client): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "${table}"`,
    );
    counts[table] = Number(result.rows[0]?.count ?? '0');
  }
  return counts;
}

describe.skipIf(!hasDatabase)('seed', () => {
  let afterFirst: Record<string, number>;

  beforeAll(async () => {
    url = await createTempDatabase(DB_NAME);
    await runMigrations(url);
  }, 120_000);

  afterAll(async () => {
    await dropTempDatabase(DB_NAME);
  }, 60_000);

  it('seeds an empty database', async () => {
    await seed({ databaseUrl: url });
    afterFirst = await withClient(url, countRows);

    expect(afterFirst.categories).toBe(CATEGORIES.length);
    expect(afterFirst.permissions).toBe(PERMISSIONS.length);
    expect(afterFirst.roles).toBe(ROLES.length);
    expect(afterFirst.commission_rules).toBe(COMMISSION_RULES.length);
  }, 60_000);

  it('is idempotent across repeated runs', async () => {
    await seed({ databaseUrl: url });
    const afterSecond = await withClient(url, countRows);
    expect(afterSecond).toEqual(afterFirst);

    await seed({ databaseUrl: url });
    const afterThird = await withClient(url, countRows);
    expect(afterThird).toEqual(afterFirst);
  }, 120_000);

  it('does not revert operator changes to settings', async () => {
    // An admin who changed a setting must not have it silently undone by the
    // next deploy's seed run.
    await withClient(url, async (client) => {
      await client.query(
        `UPDATE settings SET value = '99'::jsonb WHERE key = 'order.payment_window_minutes'`,
      );
    });

    await seed({ databaseUrl: url });

    const value = await withClient(url, async (client) =>
      client.query<{ value: string }>(
        `SELECT value::text AS value FROM settings WHERE key = 'order.payment_window_minutes'`,
      ),
    );
    expect(value.rows[0]?.value).toBe('99');
  }, 60_000);

  it('does not reactivate a currency an operator deactivated', async () => {
    await withClient(url, async (client) => {
      await client.query(`UPDATE currencies SET is_active = false WHERE code = 'EUR'`);
    });

    await seed({ databaseUrl: url });

    const row = await withClient(url, async (client) =>
      client.query<{ is_active: boolean }>(`SELECT is_active FROM currencies WHERE code = 'EUR'`),
    );
    expect(row.rows[0]?.is_active).toBe(false);
  }, 60_000);

  it('revokes a role permission that was removed from the seed definition', async () => {
    // The opposite failure: a seed that only ever ADDS lets privileges
    // accumulate, which quietly defeats least privilege.
    await withClient(url, async (client) => {
      const role = await client.query<{ id: string }>(`SELECT id FROM roles WHERE key = 'buyer'`);
      const permission = await client.query<{ id: string }>(
        `SELECT id FROM permissions WHERE key = 'user:ban'`,
      );
      await client.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`, [
        role.rows[0]?.id,
        permission.rows[0]?.id,
      ]);
    });

    await seed({ databaseUrl: url });

    const remaining = await withClient(url, async (client) =>
      client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.key = 'buyer' AND p.key = 'user:ban'`,
      ),
    );
    expect(remaining.rows[0]?.count).toBe('0');
  }, 60_000);

  it('seeds the launch configuration: UK active, others inactive', async () => {
    const rows = await withClient(url, async (client) =>
      client.query<{ code: string; is_active: boolean }>(
        `SELECT code, is_active FROM countries ORDER BY position`,
      ),
    );
    const active = rows.rows.filter((r) => r.is_active).map((r) => r.code);
    expect(active).toEqual(['GB']);
    // The rest are present but off — expansion is a toggle, not a migration.
    expect(rows.rows.length).toBeGreaterThan(5);
  });

  it('seeds the two commission regimes correctly', async () => {
    const rows = await withClient(url, async (client) =>
      client.query<{ slug: string; percent_bps: number; transaction_flow: string }>(
        `SELECT c.slug, cr.percent_bps, c.transaction_flow
           FROM commission_rules cr
           JOIN categories c ON c.id = cr.category_id
          WHERE cr.scope_type = 'CATEGORY'
          ORDER BY c.slug`,
      ),
    );
    const bySlug = Object.fromEntries(rows.rows.map((r) => [r.slug, r]));

    /*
     * EVERY category is contact-only. Kurdora provides the place to advertise
     * and to make contact; the transaction happens directly between buyer and
     * seller, outside the platform.
     *
     * The commission rates are retained but INERT — nothing charges them,
     * because nothing charges anything. They are kept rather than zeroed so
     * that the rate history survives, and because a future Kurdora-service fee
     * is a different thing from a commission on somebody else's sale.
     */
    for (const slug of ['cars', 'business', 'mobile-electronics', 'kurdish-clothing']) {
      expect(bySlug[slug]?.transaction_flow, slug).toBe('CONTACT_ONLY');
    }
  });

  it('records that Stripe has NOT approved the business model', async () => {
    // Guards against this quietly becoming true without written confirmation
    // (docs/13-dependencies-and-blockers.md, D-A).
    const row = await withClient(url, async (client) =>
      client.query<{ value: string }>(
        `SELECT value::text AS value FROM settings WHERE key = 'stripe.platform_approved'`,
      ),
    );
    expect(row.rows[0]?.value).toBe('false');
  });

  it('builds delimited category paths', async () => {
    const rows = await withClient(url, async (client) =>
      client.query<{ slug: string; path: string; depth: number }>(
        `SELECT slug, path, depth FROM categories ORDER BY position`,
      ),
    );
    for (const row of rows.rows) {
      expect(row.path.startsWith('/')).toBe(true);
      expect(row.path.endsWith('/')).toBe(true);
    }
    expect(rows.rows.find((r) => r.slug === 'cars')?.path).toBe('/cars/');
  });

  it('translates every category into all four locales', async () => {
    const rows = await withClient(url, async (client) =>
      client.query<{ locale: string; count: string }>(
        `SELECT locale, count(*)::text AS count FROM category_translations GROUP BY locale ORDER BY locale`,
      ),
    );
    const byLocale = Object.fromEntries(rows.rows.map((r) => [r.locale, Number(r.count)]));
    // Kurmanji and Arabic are seeded now even though they launch later — the
    // schema and data are ready before the UI enables them.
    for (const locale of ['en', 'ckb', 'kmr', 'ar']) {
      expect(byLocale[locale]).toBe(CATEGORIES.length);
    }
  });
});
