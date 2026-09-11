/**
 * Login lockout with exponential backoff.
 *
 * Rate limiting alone is not enough: an attacker spreading attempts across
 * many IPs still gets unlimited guesses at one account. Per-account lockout
 * closes that, and backoff keeps a brief lockout from becoming a permanent
 * denial of service against the real user.
 */

/** Failures tolerated before any lock is applied. */
export const FAILURES_BEFORE_LOCKOUT = 5;
/** First lock duration. Doubles per subsequent failure. */
export const BASE_LOCKOUT_MS = 60_000;
/** Ceiling, so a targeted attacker cannot lock someone out indefinitely. */
export const MAX_LOCKOUT_MS = 15 * 60_000;
/** A clean run of this long resets the counter. */
export const FAILURE_WINDOW_MS = 60 * 60_000;

export interface LockoutState {
  readonly failedLoginCount: number;
  readonly lockedUntil: Date | null;
  readonly lastFailureAt: Date | null;
}

export function isLockedOut(state: LockoutState, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}

export function lockoutRemainingMs(state: LockoutState, now: Date): number {
  if (!isLockedOut(state, now)) return 0;
  return state.lockedUntil!.getTime() - now.getTime();
}

/** Duration for the given cumulative failure count. 0 means no lock yet. */
export function lockoutDurationMs(failureCount: number): number {
  if (failureCount < FAILURES_BEFORE_LOCKOUT) return 0;
  const step = failureCount - FAILURES_BEFORE_LOCKOUT;
  const duration = BASE_LOCKOUT_MS * 2 ** step;
  return Math.min(duration, MAX_LOCKOUT_MS);
}

export interface LockoutTransition {
  readonly failedLoginCount: number;
  readonly lockedUntil: Date | null;
}

/** New state after a failed attempt. */
export function registerFailure(state: LockoutState, now: Date): LockoutTransition {
  // A long quiet period resets the count, so yesterday's typos do not
  // compound with today's.
  const stale =
    state.lastFailureAt !== null &&
    now.getTime() - state.lastFailureAt.getTime() > FAILURE_WINDOW_MS;

  const failedLoginCount = (stale ? 0 : state.failedLoginCount) + 1;
  const duration = lockoutDurationMs(failedLoginCount);

  return {
    failedLoginCount,
    lockedUntil: duration > 0 ? new Date(now.getTime() + duration) : null,
  };
}

/** New state after a successful attempt: always a full reset. */
export function registerSuccess(): LockoutTransition {
  return { failedLoginCount: 0, lockedUntil: null };
}
