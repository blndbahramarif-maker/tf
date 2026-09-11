import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  createTempDatabase,
  dropTempDatabase,
  hasDatabase,
  runMigrations,
  testUuid,
} from './helpers';

/**
 * The ledger invariant, enforced by the DATABASE.
 *
 * The application also checks balance (src/domain/ledger), but application
 * checks only bind code that goes through them. These tests prove the rule
 * holds against a raw SQL connection — a migration, a script, or someone at a
 * psql prompt. That is the difference between a convention and a guarantee.
 */

const DB_NAME = 'kurdora_test_ledger';
let url = '';
let client: Client;

async function connect(): Promise<void> {
  client = new Client({ connectionString: url });
  await client.connect();
}

let groupCounter = 0;
function nextGroup(): string {
  groupCounter += 1;
  return testUuid(String(groupCounter));
}

/** Inserts entries in one transaction. Resolves if it commits. */
async function insertGroup(
  entries: Array<{
    account: string;
    direction: 'DEBIT' | 'CREDIT';
    amount: number;
    currency?: string;
  }>,
  groupId = nextGroup(),
): Promise<void> {
  await client.query('BEGIN');
  try {
    for (const e of entries) {
      await client.query(
        `INSERT INTO ledger_entries
           (id, entry_group_id, account, direction, amount_minor, currency, description, occurred_at)
         VALUES (gen_random_uuid(), $1, $2::ledger_account, $3::ledger_direction, $4, $5, $6, now())`,
        [groupId, e.account, e.direction, e.amount, e.currency ?? 'GBP', 'test entry'],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

describe.skipIf(!hasDatabase)('ledger invariant (database-enforced)', () => {
  beforeAll(async () => {
    url = await createTempDatabase(DB_NAME);
    await runMigrations(url);
    await connect();
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    await dropTempDatabase(DB_NAME);
  }, 60_000);

  it('commits a balanced group', async () => {
    await expect(
      insertGroup([
        { account: 'STRIPE_BALANCE', direction: 'DEBIT', amount: 10_000 },
        { account: 'SELLER_PAYABLE', direction: 'CREDIT', amount: 9_400 },
        { account: 'PLATFORM_REVENUE', direction: 'CREDIT', amount: 600 },
      ]),
    ).resolves.toBeUndefined();
  });

  it('rejects a group that is out by one penny', async () => {
    await expect(
      insertGroup([
        { account: 'STRIPE_BALANCE', direction: 'DEBIT', amount: 10_000 },
        { account: 'SELLER_PAYABLE', direction: 'CREDIT', amount: 9_400 },
        { account: 'PLATFORM_REVENUE', direction: 'CREDIT', amount: 599 },
      ]),
    ).rejects.toThrow(/does not balance/);
  });

  it('rejects a lone unbalanced entry', async () => {
    await expect(
      insertGroup([{ account: 'STRIPE_BALANCE', direction: 'DEBIT', amount: 5_000 }]),
    ).rejects.toThrow(/does not balance/);
  });

  it('will not net one currency against another', async () => {
    await expect(
      insertGroup([
        { account: 'STRIPE_BALANCE', direction: 'DEBIT', amount: 10_000, currency: 'GBP' },
        { account: 'SELLER_PAYABLE', direction: 'CREDIT', amount: 10_000, currency: 'EUR' },
      ]),
    ).rejects.toThrow(/does not balance/);
  });

  it('accepts a multi-currency group where every currency balances', async () => {
    await expect(
      insertGroup([
        { account: 'STRIPE_BALANCE', direction: 'DEBIT', amount: 10_000, currency: 'GBP' },
        { account: 'SELLER_PAYABLE', direction: 'CREDIT', amount: 10_000, currency: 'GBP' },
        { account: 'STRIPE_BALANCE', direction: 'DEBIT', amount: 5_000, currency: 'EUR' },
        { account: 'SELLER_PAYABLE', direction: 'CREDIT', amount: 5_000, currency: 'EUR' },
      ]),
    ).resolves.toBeUndefined();
  });

  it('leaves no rows behind when a group is rejected', async () => {
    const groupId = nextGroup();
    await insertGroup(
      [{ account: 'STRIPE_BALANCE', direction: 'DEBIT', amount: 1_234 }],
      groupId,
    ).catch(() => undefined);

    const result = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM ledger_entries WHERE entry_group_id = $1',
      [groupId],
    );
    expect(result.rows[0]?.count).toBe('0');
  });

  it('is deferred: the group may be unbalanced mid-transaction', async () => {
    // This is what makes multi-row groups possible at all. A per-statement
    // check would reject the first INSERT of every balanced group.
    const groupId = nextGroup();
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO ledger_entries
         (id, entry_group_id, account, direction, amount_minor, currency, description, occurred_at)
       VALUES (gen_random_uuid(), $1, 'STRIPE_BALANCE', 'DEBIT', 10000, 'GBP', 'leg 1', now())`,
      [groupId],
    );
    // Unbalanced right now, and that must be fine.
    const mid = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM ledger_entries WHERE entry_group_id = $1',
      [groupId],
    );
    expect(mid.rows[0]?.count).toBe('1');

    await client.query(
      `INSERT INTO ledger_entries
         (id, entry_group_id, account, direction, amount_minor, currency, description, occurred_at)
       VALUES (gen_random_uuid(), $1, 'SELLER_PAYABLE', 'CREDIT', 10000, 'GBP', 'leg 2', now())`,
      [groupId],
    );
    await client.query('COMMIT');

    const after = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM ledger_entries WHERE entry_group_id = $1',
      [groupId],
    );
    expect(after.rows[0]?.count).toBe('2');
  });

  it('rejects a non-positive amount: direction carries the sign', async () => {
    await expect(
      insertGroup([
        { account: 'STRIPE_BALANCE', direction: 'DEBIT', amount: -5_000 },
        { account: 'SELLER_PAYABLE', direction: 'CREDIT', amount: -5_000 },
      ]),
    ).rejects.toThrow(/ledger_entries_amount_positive/);
  });

  it('is append-only: UPDATE is refused', async () => {
    await expect(client.query('UPDATE ledger_entries SET amount_minor = 1')).rejects.toThrow(
      /append-only/,
    );
  });

  it('is append-only: DELETE is refused', async () => {
    await expect(client.query('DELETE FROM ledger_entries')).rejects.toThrow(/append-only/);
  });

  it('keeps the whole ledger balanced in aggregate', async () => {
    // The reconciliation query the nightly job will run.
    const result = await client.query<{ currency: string; net: string }>(
      `SELECT currency,
              SUM(CASE WHEN direction = 'DEBIT' THEN amount_minor ELSE -amount_minor END)::text AS net
         FROM ledger_entries
        GROUP BY currency`,
    );
    for (const row of result.rows) {
      expect(row.net).toBe('0');
    }
  });
});
