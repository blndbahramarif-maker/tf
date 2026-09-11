/**
 * The E2E database URL.
 *
 * Lives in its own module because `playwright.config.ts` is evaluated BEFORE
 * `globalSetup` runs. Having global setup export the value through an
 * environment variable therefore does not work — the config has already read
 * it, and the web server starts with no DATABASE_URL at all.
 */
export const E2E_DB_NAME = 'kurdora_e2e';

export function e2eDatabaseUrl(): string {
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      'TEST_DATABASE_URL or DATABASE_URL must be set to run E2E tests. See docs/14-environments.md.',
    );
  }
  const url = new URL(base);
  url.pathname = `/${E2E_DB_NAME}`;
  return url.toString();
}

export function maintenanceDatabaseUrl(): string {
  const url = new URL(e2eDatabaseUrl());
  url.pathname = '/postgres';
  return url.toString();
}

/**
 * A Prisma client bound to the E2E database.
 *
 * Used only to ASSERT on state the UI does not show — "was a second account
 * created?" — never to fabricate a session or skip a flow.
 */
export async function e2ePrisma() {
  process.env.DATABASE_URL = e2eDatabaseUrl();
  const { PrismaClient } = await import('../src/generated/prisma/client');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: e2eDatabaseUrl() }) });
}
