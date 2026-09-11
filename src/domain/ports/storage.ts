/**
 * Object storage port.
 *
 * The domain never learns which vendor is behind this. `src/infra/storage`
 * supplies an implementation: S3-compatible storage in production, the local
 * filesystem in development and tests.
 */

export interface UploadIntent {
  /** Where the client sends the bytes. */
  readonly uploadUrl: string;
  readonly method: 'PUT' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  /** Key the bytes will land at. Never guessable by a client. */
  readonly storageKey: string;
  readonly expiresAt: Date;
  /** Hard byte ceiling the storage layer will enforce. */
  readonly maxBytes: number;
}

export interface CreateUploadIntentInput {
  /** Logical prefix, e.g. `listings/<listingId>`. */
  readonly prefix: string;
  /** Declared type. Advisory ONLY — never trusted; magic bytes decide. */
  readonly declaredContentType: string;
  readonly maxBytes: number;
  readonly ttlSeconds: number;
}

export interface StoragePort {
  createUploadIntent(input: CreateUploadIntentInput): Promise<UploadIntent>;
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
  /** Public URL for a processed derivative. */
  publicUrl(key: string): string;
  readonly driver: 'local' | 's3';
}
