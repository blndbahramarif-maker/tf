/**
 * The API test suite gets its own database, derived deterministically from
 * TEST_DATABASE_URL so the global setup and the per-file setup agree without
 * passing state between them.
 */
export const API_TEST_DB_NAME = 'kurdora_test_api';

export function apiTestDatabaseUrl(): string {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) return '';
  const url = new URL(base);
  url.pathname = `/${API_TEST_DB_NAME}`;
  url.search = '';
  return url.toString();
}

export function maintenanceDatabaseUrl(): string {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) return '';
  const url = new URL(base);
  url.pathname = '/postgres';
  url.search = '';
  return url.toString();
}
