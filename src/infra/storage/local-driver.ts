import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CreateUploadIntentInput, StoragePort, UploadIntent } from '@/domain/ports/storage';

/**
 * Filesystem storage for development and tests.
 *
 * This is a REAL driver, not a stub: bytes are written to disk, read back and
 * deleted. What it cannot do is issue an S3 presigned URL, so instead it issues
 * an HMAC-signed, expiring, size-capped upload ticket pointing at our own
 * upload endpoint. That ticket is genuinely unforgeable — the same property a
 * presigned URL provides — so the browser flow is identical in both drivers.
 *
 * Production uses the S3 driver, where the bytes never transit the API at all.
 */

export interface LocalStorageOptions {
  readonly rootDir: string;
  readonly baseUrl: string;
  readonly signingSecret: string;
}

export interface UploadTicket {
  readonly storageKey: string;
  readonly maxBytes: number;
  readonly expiresAt: number;
}

export class LocalStorageDriver implements StoragePort {
  readonly driver = 'local' as const;

  constructor(private readonly options: LocalStorageOptions) {}

  /**
   * Keys embed 16 random bytes, so one cannot be guessed from a listing id.
   * Prefix characters are constrained to stop `..` traversal reaching outside
   * the storage root.
   */
  private buildKey(prefix: string): string {
    const safePrefix = prefix.replace(/[^a-zA-Z0-9/_-]/g, '').replace(/\.\.+/g, '');
    return `${safePrefix}/${Date.now()}-${randomBytes(16).toString('hex')}`;
  }

  private resolve(key: string): string {
    const target = path.resolve(this.options.rootDir, key);
    const root = path.resolve(this.options.rootDir);
    // Defence in depth: even a key that escaped sanitisation cannot write
    // outside the root.
    if (!target.startsWith(`${root}${path.sep}`) && target !== root) {
      throw new Error('Refusing to access a path outside the storage root');
    }
    return target;
  }

  sign(ticket: UploadTicket): string {
    const payload = Buffer.from(JSON.stringify(ticket), 'utf8').toString('base64url');
    const signature = createHmac('sha256', this.options.signingSecret)
      .update(payload)
      .digest('base64url');
    return `${payload}.${signature}`;
  }

  /** Returns the ticket only when the signature is valid and unexpired. */
  verify(token: string, now: Date = new Date()): UploadTicket | null {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;

    const expected = createHmac('sha256', this.options.signingSecret)
      .update(payload)
      .digest('base64url');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    try {
      const ticket = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as UploadTicket;
      if (typeof ticket.expiresAt !== 'number' || ticket.expiresAt < now.getTime()) return null;
      return ticket;
    } catch {
      return null;
    }
  }

  async createUploadIntent(input: CreateUploadIntentInput): Promise<UploadIntent> {
    const storageKey = this.buildKey(input.prefix);
    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
    const token = this.sign({
      storageKey,
      maxBytes: input.maxBytes,
      expiresAt: expiresAt.getTime(),
    });

    return {
      uploadUrl: `${this.options.baseUrl}/api/v1/uploads/${token}`,
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      storageKey,
      expiresAt,
      maxBytes: input.maxBytes,
    };
  }

  /** `contentType` is accepted to satisfy the port but unused on disk. */
  async putObject(key: string, body: Buffer, _contentType?: string): Promise<void> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  }

  async getObject(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async deleteObject(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  publicUrl(key: string): string {
    return `${this.options.baseUrl}/media/${key}`;
  }

  /** Exposed for tests that assert on stored content. */
  checksum(body: Buffer): string {
    return createHash('sha256').update(body).digest('hex');
  }
}
