#!/usr/bin/env tsx
/**
 * Down-migration runner.
 *
 *   pnpm db:migrate:down            # reverse the most recent migration
 *   pnpm db:migrate:down --steps 2  # reverse the last two
 *   pnpm db:migrate:down --all      # reverse everything
 *
 * Prisma has no native down migrations. Rather than pretend the schema is
 * reversible, every migration ships a hand-written `down.sql` and this runner
 * applies them in reverse order, inside a transaction, removing the
 * `_prisma_migrations` row as it goes so Prisma's state stays consistent.
 *
 * tests/db/migrations.test.ts proves up → down → up actually works.
 */
import { config } from 'dotenv';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

config({ path: ['.env.local', '.env'], quiet: true });

const MIGRATIONS_DIR = path.join(process.cwd(), 'prisma', 'migrations');

interface AppliedMigration {
  id: string;
  migration_name: string;
}

function parseArgs(argv: string[]): { steps: number } {
  if (argv.includes('--all')) return { steps: Number.POSITIVE_INFINITY };
  const i = argv.indexOf('--steps');
  if (i !== -1) {
    const value = Number.parseInt(argv[i + 1] ?? '', 10);
    if (Number.isNaN(value) || value < 1) {
      throw new Error('--steps requires a positive integer');
    }
    return { steps: value };
  }
  return { steps: 1 };
}

export async function migrateDown(
  databaseUrl: string,
  steps: number,
  log: (message: string) => void = console.log,
): Promise<string[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const reversed: string[] = [];

  try {
    const tableExists = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = '_prisma_migrations'
       ) AS exists`,
    );
    if (!tableExists.rows[0]?.exists) {
      log('No _prisma_migrations table — nothing to reverse.');
      return reversed;
    }

    const applied = await client.query<AppliedMigration>(
      `SELECT id, migration_name
         FROM _prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        ORDER BY finished_at DESC`,
    );

    const targets = applied.rows.slice(0, steps === Number.POSITIVE_INFINITY ? undefined : steps);

    if (targets.length === 0) {
      log('No applied migrations to reverse.');
      return reversed;
    }

    for (const migration of targets) {
      const downPath = path.join(MIGRATIONS_DIR, migration.migration_name, 'down.sql');

      let sql: string;
      try {
        sql = await readFile(downPath, 'utf8');
      } catch {
        // Refuse rather than leave the database half-reversed. A migration
        // without a down.sql is a gap that must be fixed, not worked around.
        throw new Error(
          `Missing down.sql for "${migration.migration_name}".\n` +
            `Every migration must ship a reversal at:\n  ${downPath}`,
        );
      }

      log(`↓ reversing ${migration.migration_name}`);

      // One transaction per migration: either it reverses fully, or not at all.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('DELETE FROM _prisma_migrations WHERE id = $1', [migration.id]);
        await client.query('COMMIT');
        reversed.push(migration.migration_name);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    log(`Reversed ${reversed.length} migration(s).`);
    return reversed;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  if (process.env.APP_ENV === 'production') {
    throw new Error(
      'Refusing to run down migrations against production. ' +
        'Reversal is a development and CI tool; production recovery is a ' +
        'restore-from-backup procedure, not a schema rewind.',
    );
  }

  const { steps } = parseArgs(process.argv.slice(2));
  await migrateDown(databaseUrl, steps);
}

// Only run when invoked directly, so tests can import migrateDown().
if (process.argv[1]?.endsWith('migrate-down.ts')) {
  main().catch((error: unknown) => {
    console.error('\n✗ Down migration failed:\n', error);
    process.exit(1);
  });
}
