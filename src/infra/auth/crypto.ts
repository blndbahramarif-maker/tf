import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Symmetric encryption and token hashing.
 *
 * TOTP secrets are encrypted at rest with AES-256-GCM: a database leak alone
 * must not let an attacker generate valid second factors. Refresh tokens and
 * verification tokens are stored as SHA-256 hashes — we never need the
 * original, only to recognise it.
 */

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function encryptionKey(): Buffer {
  const raw = process.env.AUTH_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('AUTH_ENCRYPTION_KEY is not set. It must be 64 hex characters (32 bytes).');
  }
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) {
    throw new Error(
      `AUTH_ENCRYPTION_KEY must be 32 bytes (64 hex characters), got ${key.length} bytes.`,
    );
  }
  return key;
}

/** Returns `iv:ciphertext:authTag`, all hex. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${ciphertext.toString('hex')}:${authTag.toString('hex')}`;
}

export function decryptSecret(payload: string): string {
  const [ivHex, ciphertextHex, authTagHex] = payload.split(':');
  if (!ivHex || !ciphertextHex || !authTagHex) {
    throw new Error('Malformed encrypted payload');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivHex, 'hex'));
  // GCM authenticates: tampering makes final() throw rather than returning
  // silently wrong plaintext.
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

/** 256 bits of entropy, URL-safe. Used for refresh and verification tokens. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison for anything secret-adjacent. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export { AUTH_TAG_LENGTH };
