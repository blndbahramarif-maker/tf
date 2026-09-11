import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Client } from 'pg';
import { migrateDown } from '../../scripts/migrate-down';
import {
  createTempDatabase,
  dropTempDatabase,
  hasDatabase,
  runMigrations,
  snapshotSchema,
  withClient,
  type SchemaSnapshot,
} from './helpers';

/**
 * Migration reversibility.
 *
 * Prisma has no native down migrations, so every migration ships a
 * hand-written `down.sql`. Hand-written means it can be wrong, which is
 * exactly why it is tested rather than trusted: this suite applies every
 * migration, reverses every migration, and applies them again, asserting the
 * schema is identical each time.
 *
 * An un-reversible migration is discovered here, not during an incident.
 */

const DB_NAME = 'kurdora_test_migrations';
let url = '';

const quiet = (): void => {};

describe.skipIf(!hasDatabase)('migrations', () => {
  let afterFirstUp: SchemaSnapshot;

  beforeAll(async () => {
    url = await createTempDatabase(DB_NAME);
  }, 60_000);

  afterAll(async () => {
    await dropTempDatabase(DB_NAME);
  }, 60_000);

  it('applies cleanly to an empty database', async () => {
    await runMigrations(url);
    afterFirstUp = await withClient(url, snapshotSchema);

    expect(afterFirstUp.tables.length).toBeGreaterThan(40);
    expect(afterFirstUp.enums.length).toBeGreaterThan(25);
  }, 120_000);

  it('creates the objects the constraints migration is responsible for', async () => {
    // If these are missing, the invariants tested elsewhere are not actually
    // installed and those tests would be passing against nothing.
    expect(afterFirstUp.functions).toContain('kurdora_assert_ledger_balanced');
    expect(afterFirstUp.functions).toContain('kurdora_reject_mutation');
    expect(afterFirstUp.triggers).toContain('ledger_entries_must_balance');
    expect(afterFirstUp.triggers).toContain('ledger_entries_append_only');
    expect(afterFirstUp.triggers).toContain('audit_logs_append_only');
    expect(afterFirstUp.checkConstraints).toContain('orders_seller_amount_is_remainder');
    expect(afterFirstUp.checkConstraints).toContain('ledger_entries_amount_positive');
    expect(afterFirstUp.indexes).toContain('listing_images_one_primary_per_listing');
    expect(afterFirstUp.indexes).toContain('listings_attributes_gin');
  });

  it('is idempotent: a second deploy is a no-op', async () => {
    await runMigrations(url);
    const again = await withClient(url, snapshotSchema);
    expect(again).toEqual(afterFirstUp);
  }, 120_000);

  it('reverses every migration, leaving the schema empty', async () => {
    const reversed = await migrateDown(url, Number.POSITIVE_INFINITY, quiet);
    expect(reversed.length).toBeGreaterThanOrEqual(2);

    const afterDown = await withClient(url, snapshotSchema);

    // Nothing may be left behind — no orphaned tables, enums, triggers,
    // functions or check constraints.
    expect(afterDown.tables).toEqual([]);
    expect(afterDown.enums).toEqual([]);
    expect(afterDown.triggers).toEqual([]);
    expect(afterDown.checkConstraints).toEqual([]);
    expect(afterDown.functions).toEqual([]);
  }, 120_000);

  it('clears the migration history as it reverses', async () => {
    const rows = await withClient(url, async (client: Client) =>
      client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM _prisma_migrations
          WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
      ),
    );
    expect(rows.rows[0]?.count).toBe('0');
  });

  it('re-applies after reversal, reaching an identical schema', async () => {
    // The real test of reversibility: up → down → up must be a no-op overall.
    // If down.sql left anything behind, this second up fails or diverges.
    await runMigrations(url);
    const afterSecondUp = await withClient(url, snapshotSchema);
    expect(afterSecondUp).toEqual(afterFirstUp);
  }, 120_000);

  it('reverses one step at a time', async () => {
    // Reverses only the MOST RECENT migration, whichever that is, then
    // re-applies. Deliberately does not name the newest migration: this test
    // must keep working as migrations are added.
    const reversed = await migrateDown(url, 1, quiet);
    expect(reversed).toHaveLength(1);

    const partial = await withClient(url, snapshotSchema);

    // Something was removed…
    expect(partial.tables.length).toBeLessThanOrEqual(afterFirstUp.tables.length);
    const removed =
      afterFirstUp.tables.length -
      partial.tables.length +
      (afterFirstUp.enums.length - partial.enums.length) +
      (afterFirstUp.checkConstraints.length - partial.checkConstraints.length);
    expect(removed).toBeGreaterThan(0);

    // …but the core schema from the init migration is still standing.
    expect(partial.tables).toContain('users');
    expect(partial.tables).toContain('ledger_entries');

    await runMigrations(url);
    const restored = await withClient(url, snapshotSchema);
    expect(restored).toEqual(afterFirstUp);
  }, 120_000);

  it('every migration ships a down.sql', async () => {
    const { readdir, access } = await import('node:fs/promises');
    const path = await import('node:path');
    const dir = path.join(process.cwd(), 'prisma', 'migrations');

    const entries = await readdir(dir, { withFileTypes: true });
    const migrations = entries.filter((e) => e.isDirectory());
    expect(migrations.length).toBeGreaterThan(0);

    for (const migration of migrations) {
      // A migration without a reversal is a gap. Fail loudly at review time.
      await expect(
        access(path.join(dir, migration.name, 'down.sql')),
        `${migration.name} is missing down.sql`,
      ).resolves.toBeUndefined();
    }
  });
});
