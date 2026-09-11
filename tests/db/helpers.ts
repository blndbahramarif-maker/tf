import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from 'pg';

const exec = promisify(execFile);

/**
 * Database tests run against a REAL PostgreSQL instance.
 *
 * They are skipped when TEST_DATABASE_URL is absent so a developer without a
 * database can still run the unit suite — but CI always provides one, so these
 * never silently vanish where it matters. `describe.skipIf` prints the skip,
 * rather than quietly passing.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';
export const hasDatabase = TEST_DATABASE_URL.length > 0;

export function adminUrl(databaseName: string): string {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  url.search = '';
  return url.toString();
}

function maintenanceUrl(): string {
  return adminUrl('postgres');
}

/** Creates a throwaway database so destructive tests cannot damage anything. */
export async function createTempDatabase(name: string): Promise<string> {
  const client = new Client({ connectionString: maintenanceUrl() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
  return adminUrl(name);
}

export async function dropTempDatabase(name: string): Promise<void> {
  const client = new Client({ connectionString: maintenanceUrl() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}

/** Applies all migrations via the real Prisma CLI — not a reimplementation. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  await exec('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    cwd: process.cwd(),
  });
}

export async function withClient<T>(
  databaseUrl: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export interface SchemaSnapshot {
  tables: string[];
  enums: string[];
  triggers: string[];
  checkConstraints: string[];
  indexes: string[];
  functions: string[];
}

/** Everything a migration is responsible for creating, so reversal can be proven. */
export async function snapshotSchema(client: Client): Promise<SchemaSnapshot> {
  const q = async (sql: string): Promise<string[]> => {
    const result = await client.query<{ name: string }>(sql);
    return result.rows.map((r) => r.name).sort();
  };

  return {
    tables: await q(
      `SELECT tablename AS name FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    ),
    enums: await q(
      `SELECT t.typname AS name FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typtype = 'e'`,
    ),
    triggers: await q(
      `SELECT tgname AS name FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace =
              (SELECT oid FROM pg_namespace WHERE nspname = 'public'))`,
    ),
    checkConstraints: await q(
      `SELECT conname AS name FROM pg_constraint
        WHERE contype = 'c'
          AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
          AND conname NOT LIKE '%_not_null'`,
    ),
    indexes: await q(
      `SELECT indexname AS name FROM pg_indexes
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    ),
    functions: await q(
      `SELECT proname AS name FROM pg_proc
        WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')`,
    ),
  };
}

/** A valid UUIDv7-shaped id for fixtures. */
export function testUuid(suffix: string): string {
  const tail = suffix.padStart(12, '0').slice(-12);
  return `00000000-0000-7000-8000-${tail}`;
}
