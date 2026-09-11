import { apiTestDatabaseUrl } from './db-url';

/**
 * Runs before any test module is imported, so `@/infra/db/client` connects to
 * the API test database rather than the development one.
 */
const url = apiTestDatabaseUrl();
if (url) process.env.DATABASE_URL = url;

process.env.APP_ENV ??= 'test';
process.env.AUTH_SECRET ??= 'test-only-auth-secret-at-least-32-characters-long';
process.env.AUTH_ENCRYPTION_KEY ??=
  '0000000000000000000000000000000000000000000000000000000000000001';
process.env.REDIS_URL ??= 'redis://localhost:6379';

// Image uploads write to a real directory under the OS temp dir, so the whole
// pipeline (upload -> validate -> re-encode -> serve) runs for real in tests.
process.env.LOCAL_STORAGE_DIR ??= `${process.env.TMPDIR ?? '/tmp'}/kurdora-test-storage`;
