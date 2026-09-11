/**
 * Refresh-token rotation and reuse detection.
 *
 * Every refresh mints a new token and revokes the one presented. A token is
 * therefore valid exactly once.
 *
 * If a token that has already been revoked is presented again, one of two
 * things happened: either an attacker stole it and is racing the real user, or
 * the real user is replaying a token after an attacker used it. We cannot tell
 * which, and it does not matter — both mean the family is compromised, so the
 * whole family is revoked and everyone must log in again.
 *
 * Pure decision logic: no database, no clock, no crypto. The caller supplies
 * the record and the time, and acts on the verdict.
 */

export interface RefreshTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly familyId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly stepUpAt: Date | null;
}

export type RefreshOutcome =
  /** Rotate: issue a new token in the same family, revoke this one. */
  | { readonly kind: 'rotate'; readonly record: RefreshTokenRecord }
  /** The token is not ours. Reject without revealing anything. */
  | { readonly kind: 'unknown' }
  /** Past its expiry. Reject; no family action — expiry is not an attack. */
  | { readonly kind: 'expired'; readonly record: RefreshTokenRecord }
  /** Already used or revoked. Revoke the ENTIRE family. */
  | { readonly kind: 'reuse_detected'; readonly record: RefreshTokenRecord };

export function evaluateRefresh(record: RefreshTokenRecord | null, now: Date): RefreshOutcome {
  if (record === null) return { kind: 'unknown' };

  // Order matters. A revoked token must be reported as reuse even if it has
  // also expired: an attacker replaying a stolen token after expiry is still
  // evidence the family is compromised, and checking expiry first would
  // downgrade that to a harmless "expired".
  if (record.revokedAt !== null) return { kind: 'reuse_detected', record };

  if (record.expiresAt.getTime() <= now.getTime()) return { kind: 'expired', record };

  return { kind: 'rotate', record };
}

/** Default refresh-token lifetime. */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;
/** Access-token lifetime. Short, because revocation is checked on refresh. */
export const ACCESS_TOKEN_TTL_MS = 15 * 60_000;

export function refreshExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
}
