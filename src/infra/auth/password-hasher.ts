import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id password hashing.
 *
 * Parameters follow the OWASP Password Storage Cheat Sheet minimum for
 * Argon2id: m=19456 KiB (19 MiB), t=2, p=1. Measured at roughly 110 ms per
 * hash on this hardware — slow enough to matter to an attacker, fast enough
 * not to be a login bottleneck.
 *
 * The salt is generated and embedded in the encoded hash by the library; we
 * never manage it ourselves.
 *
 * `algorithm` is deliberately not passed: @node-rs/argon2 already defaults to
 * Argon2id, and its `Algorithm` export is an ambient const enum that cannot be
 * read under `isolatedModules`. Rather than trust that default silently,
 * `ARGON2_PREFIX` below is asserted against real output in the unit tests — so
 * a library change that switched to Argon2i would fail the build.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** The encoded-hash prefix the configuration above must produce. */
export const ARGON2_PREFIX = '$argon2id$v=19$m=19456,t=2,p=1$';

/**
 * A pre-computed hash used to burn comparable CPU time when an account does
 * not exist. Without it, "unknown email" returns measurably faster than
 * "wrong password", which turns the login endpoint into an account-enumeration
 * oracle.
 */
let dummyHash: string | null = null;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    // A malformed stored hash must fail closed, not throw into the caller.
    return false;
  }
}

/** Spends roughly the cost of a real verification, then fails. */
export async function verifyPasswordAgainstDummy(password: string): Promise<false> {
  dummyHash ??= await hash('kurdora-timing-equaliser', ARGON2_OPTIONS);
  await verifyPassword(dummyHash, password);
  return false;
}

/** True when the stored hash was produced with weaker parameters than current. */
export function needsRehash(storedHash: string): boolean {
  return !storedHash.startsWith(ARGON2_PREFIX);
}
