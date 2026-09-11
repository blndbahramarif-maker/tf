import { describe, expect, it } from 'vitest';
import { checkPassword, MIN_PASSWORD_LENGTH } from '@/domain/auth/password';
import {
  BASE_LOCKOUT_MS,
  type LockoutState,
  FAILURES_BEFORE_LOCKOUT,
  isLockedOut,
  lockoutDurationMs,
  lockoutRemainingMs,
  MAX_LOCKOUT_MS,
  registerFailure,
  registerSuccess,
} from '@/domain/auth/lockout';
import { evaluateRefresh, type RefreshTokenRecord } from '@/domain/auth/refresh-tokens';
import { isStepUpFresh, STEP_UP_WINDOW_MS, stepUpExpiresAt } from '@/domain/auth/step-up';

describe('password policy', () => {
  it('accepts a long passphrase with no symbols', () => {
    // Length beats composition rules, which push people toward "Password1!".
    expect(checkPassword('correct horse battery staple').ok).toBe(true);
  });

  it('rejects anything shorter than the minimum', () => {
    const result = checkPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1));
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('too_short');
  });

  it('rejects an unbounded password', () => {
    // Argon2 cost scales with input; an unbounded password is a cheap DoS.
    const result = checkPassword('a'.repeat(1000));
    expect(result.reasons).toContain('too_long');
  });

  it('rejects well-known passwords', () => {
    expect(checkPassword('password123').reasons).toContain('common');
    expect(checkPassword('QWERTYUIOP').reasons).toContain('common');
  });

  it('rejects a password containing the email local part', () => {
    const result = checkPassword('jennyrosen-is-great', 'jennyrosen@example.com');
    expect(result.reasons).toContain('contains_email');
  });

  it('does not reject on a short email local part', () => {
    expect(checkPassword('a-perfectly-fine-passphrase', 'jo@example.com').ok).toBe(true);
  });
});

describe('login lockout', () => {
  const now = new Date('2026-09-11T12:00:00Z');
  const base = { failedLoginCount: 0, lockedUntil: null, lastFailureAt: null };

  it('tolerates a few mistakes before locking', () => {
    for (let count = 0; count < FAILURES_BEFORE_LOCKOUT; count += 1) {
      expect(lockoutDurationMs(count)).toBe(0);
    }
    expect(lockoutDurationMs(FAILURES_BEFORE_LOCKOUT)).toBe(BASE_LOCKOUT_MS);
  });

  it('backs off exponentially', () => {
    expect(lockoutDurationMs(5)).toBe(60_000);
    expect(lockoutDurationMs(6)).toBe(120_000);
    expect(lockoutDurationMs(7)).toBe(240_000);
    expect(lockoutDurationMs(8)).toBe(480_000);
  });

  it('caps the lockout so an attacker cannot lock someone out forever', () => {
    expect(lockoutDurationMs(50)).toBe(MAX_LOCKOUT_MS);
    expect(lockoutDurationMs(500)).toBe(MAX_LOCKOUT_MS);
  });

  it('locks the account on the fifth failure', () => {
    let state: LockoutState = { ...base };
    for (let i = 0; i < 4; i += 1) {
      const next = registerFailure(state, now);
      state = { ...state, ...next, lastFailureAt: now };
      expect(next.lockedUntil).toBeNull();
    }
    const fifth = registerFailure(state, now);
    expect(fifth.failedLoginCount).toBe(5);
    expect(fifth.lockedUntil).not.toBeNull();
  });

  it('reports remaining time while locked, and zero once elapsed', () => {
    const locked = {
      failedLoginCount: 5,
      lockedUntil: new Date(now.getTime() + 30_000),
      lastFailureAt: now,
    };
    expect(isLockedOut(locked, now)).toBe(true);
    expect(lockoutRemainingMs(locked, now)).toBe(30_000);

    const later = new Date(now.getTime() + 31_000);
    expect(isLockedOut(locked, later)).toBe(false);
    expect(lockoutRemainingMs(locked, later)).toBe(0);
  });

  it('resets the counter after a long quiet period', () => {
    // Yesterday's typos must not compound with today's.
    const stale = {
      failedLoginCount: 4,
      lockedUntil: null,
      lastFailureAt: new Date(now.getTime() - 2 * 60 * 60_000),
    };
    expect(registerFailure(stale, now).failedLoginCount).toBe(1);
  });

  it('clears everything on success', () => {
    expect(registerSuccess()).toEqual({ failedLoginCount: 0, lockedUntil: null });
  });
});

describe('refresh token evaluation', () => {
  const now = new Date('2026-09-11T12:00:00Z');
  const record = (over: Partial<RefreshTokenRecord> = {}): RefreshTokenRecord => ({
    id: 'token-1',
    userId: 'user-1',
    familyId: 'family-1',
    expiresAt: new Date(now.getTime() + 60_000),
    revokedAt: null,
    stepUpAt: null,
    ...over,
  });

  it('rotates a valid token', () => {
    expect(evaluateRefresh(record(), now).kind).toBe('rotate');
  });

  it('rejects an unknown token', () => {
    expect(evaluateRefresh(null, now).kind).toBe('unknown');
  });

  it('rejects an expired token without blaming the family', () => {
    // Expiry is not an attack, so it must not revoke a legitimate session set.
    const outcome = evaluateRefresh(record({ expiresAt: new Date(now.getTime() - 1) }), now);
    expect(outcome.kind).toBe('expired');
  });

  it('detects reuse of an already-revoked token', () => {
    expect(evaluateRefresh(record({ revokedAt: now }), now).kind).toBe('reuse_detected');
  });

  it('reports reuse even when the token has ALSO expired', () => {
    // Checking expiry first would downgrade a replayed stolen token to a
    // harmless "expired" and skip revoking the family.
    const outcome = evaluateRefresh(
      record({ revokedAt: new Date(now.getTime() - 1000), expiresAt: new Date(now.getTime() - 1) }),
      now,
    );
    expect(outcome.kind).toBe('reuse_detected');
  });

  it('treats the exact expiry instant as expired', () => {
    expect(evaluateRefresh(record({ expiresAt: now }), now).kind).toBe('expired');
  });
});

describe('step-up freshness', () => {
  const now = new Date('2026-09-11T12:00:00Z');

  it('is not fresh when there has never been a step-up', () => {
    expect(isStepUpFresh(null, now)).toBe(false);
  });

  it('is fresh inside the window', () => {
    expect(isStepUpFresh(new Date(now.getTime() - 60_000), now)).toBe(true);
  });

  it('is stale outside the window', () => {
    expect(isStepUpFresh(new Date(now.getTime() - STEP_UP_WINDOW_MS - 1), now)).toBe(false);
  });

  it('accepts the exact boundary', () => {
    expect(isStepUpFresh(new Date(now.getTime() - STEP_UP_WINDOW_MS), now)).toBe(true);
  });

  it('rejects a future timestamp', () => {
    // A step-up "from the future" is a clock problem or a forged claim.
    // Neither is proof of anything.
    expect(isStepUpFresh(new Date(now.getTime() + 1000), now)).toBe(false);
  });

  it('computes when a step-up expires', () => {
    expect(stepUpExpiresAt(now).getTime()).toBe(now.getTime() + STEP_UP_WINDOW_MS);
  });
});
