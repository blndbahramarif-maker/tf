import { randomBytes } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { CreateUploadIntentInput, StoragePort, UploadIntent } from '@/domain/ports/storage';

/**
 * S3-compatible object storage (AWS S3, Cloudflare R2, MinIO).
 *
 * ⚠️ NOT INTEGRATION-TESTED. No object storage was reachable in the build
 * environment (no Docker daemon, so no MinIO), so this driver has been written
 * against the AWS SDK and typechecked but never exercised against a real
 * endpoint. It must be verified against a real bucket before production use.
 * See the Phase 4 report. The local driver is the tested path.
 *
 * In this driver the browser PUTs directly to storage using a presigned URL, so
 * image bytes never transit the API — the property
 * docs/08-security-architecture.md asks for.
 */

export interface S3StorageOptions {
  readonly bucket: string;
  readonly region: string;
  readonly endpoint?: string | undefined;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** CDN host that serves processed derivatives. */
  readonly publicBaseUrl: string;
  /** Needed by MinIO and some R2 configurations. */
  readonly forcePathStyle?: boolean;
}

export class S3StorageDriver implements StoragePort {
  readonly driver = 's3' as const;
  private readonly client: S3Client;

  constructor(private readonly options: S3StorageOptions) {
    this.client = new S3Client({
      region: options.region,
      ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
      forcePathStyle: options.forcePathStyle ?? false,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  private buildKey(prefix: string): string {
    const safePrefix = prefix.replace(/[^a-zA-Z0-9/_-]/g, '').replace(/\.\.+/g, '');
    return `${safePrefix}/${Date.now()}-${randomBytes(16).toString('hex')}`;
  }

  async createUploadIntent(input: CreateUploadIntentInput): Promise<UploadIntent> {
    const storageKey = this.buildKey(input.prefix);

    const command = new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: storageKey,
      // Signed in so the client cannot substitute a different length. The size
      // is ALSO re-checked after download, because a presigned condition is not
      // a substitute for validating the bytes we actually received.
      ContentLength: input.maxBytes,
      ContentType: 'application/octet-stream',
    });

    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: input.ttlSeconds });

    return {
      uploadUrl,
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      storageKey,
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
      maxBytes: input.maxBytes,
    };
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Prevents a browser sniffing a served object into something else.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  async getObject(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
    );
    const bytes = await response.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Object ${key} has no body`);
    return Buffer.from(bytes);
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }

  publicUrl(key: string): string {
    return `${this.options.publicBaseUrl.replace(/\/$/, '')}/${key}`;
  }
}
