import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { apiTestDatabaseUrl, API_TEST_DB_NAME, maintenanceDatabaseUrl } from './db-url';

const exec = promisify(execFile);

/**
 * Creates the API test database once per run, migrates and seeds it.
 *
 * Seeding is required: the authorization tests read the real roles and
 * permissions, so they exercise the same data production will use rather than
 * a fixture that could drift from it.
 */
export async function setup(): Promise<void> {
  if (!process.env.TEST_DATABASE_URL) return;

  const admin = new Client({ connectionString: maintenanceDatabaseUrl() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${API_TEST_DB_NAME}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${API_TEST_DB_NAME}"`);
  } finally {
    await admin.end();
  }

  const databaseUrl = apiTestDatabaseUrl();
  const env = { ...process.env, DATABASE_URL: databaseUrl };

  await exec('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { env, cwd: process.cwd() });
  await exec('pnpm', ['exec', 'tsx', 'prisma/seed/run.ts'], { env, cwd: process.cwd() });
}

export async function teardown(): Promise<void> {
  if (!process.env.TEST_DATABASE_URL) return;
  const admin = new Client({ connectionString: maintenanceDatabaseUrl() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${API_TEST_DB_NAME}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
