import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { E2E_DB_NAME, e2eDatabaseUrl, maintenanceDatabaseUrl } from './database';

const exec = promisify(execFile);

/**
 * Creates, migrates and seeds the throwaway E2E database.
 *
 * Run as the first half of the Playwright `webServer` command rather than from
 * `globalSetup`, because Playwright starts the web server BEFORE global setup.
 * Preparing the database in global setup means the server boots against a
 * database that does not exist yet and every request 500s while Playwright
 * waits for a healthy URL that never arrives.
 *
 * Seeding is required, not optional: the dashboard renders real categories and
 * attribute definitions, and the roles and permissions the authorization
 * checks read are seed data.
 */
async function main(): Promise<void> {
  const databaseUrl = e2eDatabaseUrl();

  const admin = new Client({ connectionString: maintenanceDatabaseUrl() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${E2E_DB_NAME}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${E2E_DB_NAME}"`);
  } finally {
    await admin.end();
  }

  const env = { ...process.env, DATABASE_URL: databaseUrl };
  await exec('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { env, cwd: process.cwd() });
  await exec('pnpm', ['exec', 'tsx', 'prisma/seed/run.ts'], { env, cwd: process.cwd() });

  console.warn(`[e2e] database ${E2E_DB_NAME} created, migrated and seeded`);
}

main().catch((error: unknown) => {
  console.error('[e2e] database preparation failed:', error);
  process.exit(1);
});
