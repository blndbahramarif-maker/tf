import path from 'node:path';
import type { StoragePort } from '@/domain/ports/storage';
import { LocalStorageDriver } from './local-driver';
import { S3StorageDriver } from './s3-driver';

/**
 * Selects a storage driver from configuration.
 *
 * S3 when fully configured; otherwise the local filesystem. Production refuses
 * to start without S3 — falling back to local disk in production would put user
 * uploads on an ephemeral container filesystem and lose them on the next deploy.
 */
let cached: StoragePort | null = null;

export function getStorage(): StoragePort {
  if (cached) return cached;

  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const isProduction = process.env.APP_ENV === 'production';

  if (bucket && accessKeyId && secretAccessKey) {
    cached = new S3StorageDriver({
      bucket,
      region: process.env.S3_REGION ?? 'eu-west-2',
      endpoint: process.env.S3_ENDPOINT,
      accessKeyId,
      secretAccessKey,
      publicBaseUrl: process.env.MEDIA_BASE_URL ?? process.env.S3_ENDPOINT ?? '',
      forcePathStyle: Boolean(process.env.S3_ENDPOINT),
    });
    return cached;
  }

  if (isProduction) {
    throw new Error(
      'Object storage is not configured. Production requires S3_BUCKET, ' +
        'S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY — the local driver writes to ' +
        'an ephemeral container filesystem and would lose every upload.',
    );
  }

  const signingSecret = process.env.AUTH_SECRET;
  if (!signingSecret) throw new Error('AUTH_SECRET is required to sign local upload tickets');

  cached = new LocalStorageDriver({
    rootDir: process.env.LOCAL_STORAGE_DIR ?? path.join(process.cwd(), '.storage'),
    baseUrl: process.env.APP_URL ?? 'http://localhost:3000',
    signingSecret,
  });
  return cached;
}

/** Test hook: forces the next `getStorage()` to rebuild from the environment. */
export function resetStorage(): void {
  cached = null;
}

export { LocalStorageDriver, S3StorageDriver };
