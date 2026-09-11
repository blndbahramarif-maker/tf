import { generate, generateURI, NobleCryptoPlugin, ScureBase32Plugin, TOTP, verify } from 'otplib';
import { brand } from '@kurdora/brand';

/**
 * Time-based one-time passwords (RFC 6238).
 *
 * otplib v13 requires explicit crypto and base32 plugins; there is no implicit
 * global configuration. Verified against the installed version rather than
 * assumed — the v12 `authenticator` singleton no longer exists.
 */

const crypto = new NobleCryptoPlugin();
const base32 = new ScureBase32Plugin();

/**
 * Accept codes one 30-second step either side of now, to tolerate clock skew
 * between the server and the user's phone. Wider windows meaningfully weaken
 * the factor.
 */
const EPOCH_TOLERANCE_SECONDS = 30;

export function generateTotpSecret(): string {
  return new TOTP({ crypto, base32 }).generateSecret();
}

export async function generateTotpCode(secret: string): Promise<string> {
  return generate({ secret, crypto, base32 });
}

export async function verifyTotpCode(secret: string, token: string): Promise<boolean> {
  // Reject anything that is not six digits before doing crypto work.
  if (!/^\d{6}$/.test(token)) return false;

  const result = await verify({
    secret,
    token,
    crypto,
    base32,
    epochTolerance: EPOCH_TOLERANCE_SECONDS,
  });
  return result.valid === true;
}

/** otpauth:// URI for authenticator apps. */
export function totpEnrolmentUri(secret: string, accountLabel: string): string {
  // generateURI takes no base32 plugin: the secret is already Base32.
  return generateURI({ secret, label: accountLabel, issuer: brand.name });
}
