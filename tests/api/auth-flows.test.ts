import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as register } from '../../app/api/v1/auth/register/route';
import { POST as verifyEmail } from '../../app/api/v1/auth/verify-email/route';
import { POST as login } from '../../app/api/v1/auth/login/route';
import { POST as refresh } from '../../app/api/v1/auth/refresh/route';
import { POST as logout } from '../../app/api/v1/auth/logout/route';
import { POST as stepUp } from '../../app/api/v1/auth/step-up/route';
import { POST as changePassword } from '../../app/api/v1/auth/password/route';
import { GET as getMe } from '../../app/api/v1/me/route';
import { prisma } from '@/infra/db/client';
import { generateTotpCode } from '@/infra/auth/totp';
import {
  callRoute,
  clearRateLimits,
  createTestUser,
  disconnect,
  hasDatabase,
  latestAuditLog,
} from './harness';

describe.skipIf(!hasDatabase)('authentication flows', () => {
  beforeEach(async () => {
    await clearRateLimits();
  });

  afterAll(async () => {
    await disconnect();
  });

  describe('registration and email verification', () => {
    it('registers an account and returns a verification token', async () => {
      const email = `reg.${Date.now()}@example.test`;
      const result = await callRoute(register, '/api/v1/auth/register', {
        method: 'POST',
        body: { email, password: 'correct horse battery staple', displayName: 'Reg Test' },
      });

      expect(result.status).toBe(202);
      expect(result.body.status).toBe('pending_verification');
      expect(typeof result.body.devVerificationToken).toBe('string');
    });

    it('does NOT log the user in on registration', async () => {
      const result = await callRoute(register, '/api/v1/auth/register', {
        method: 'POST',
        body: {
          email: `nologin.${Date.now()}@example.test`,
          password: 'correct horse battery staple',
          displayName: 'No Login',
        },
      });
      // Email ownership is proven before a session exists.
      expect(result.body.accessToken).toBeUndefined();
      expect(result.body.refreshToken).toBeUndefined();
    });

    it('returns an IDENTICAL response for an address that already exists', async () => {
      const email = `dupe.${Date.now()}@example.test`;
      const body = { email, password: 'correct horse battery staple', displayName: 'Dupe' };

      const first = await callRoute(register, '/api/v1/auth/register', { method: 'POST', body });
      const second = await callRoute(register, '/api/v1/auth/register', { method: 'POST', body });

      // Account enumeration: both must look the same to the caller.
      expect(second.status).toBe(first.status);
      expect(second.body.status).toBe('pending_verification');
      expect(await prisma.user.count({ where: { email } })).toBe(1);
    });

    it('rejects a weak password', async () => {
      const result = await callRoute(register, '/api/v1/auth/register', {
        method: 'POST',
        body: {
          email: `weak.${Date.now()}@example.test`,
          password: 'password123',
          displayName: 'Weak',
        },
      });
      expect(result.status).toBe(422);
    });

    it('verifies an email with the token, once only', async () => {
      const email = `verify.${Date.now()}@example.test`;
      const registered = await callRoute(register, '/api/v1/auth/register', {
        method: 'POST',
        body: { email, password: 'correct horse battery staple', displayName: 'Verify' },
      });
      const token = registered.body.devVerificationToken as string;

      const first = await callRoute(verifyEmail, '/api/v1/auth/verify-email', {
        method: 'POST',
        body: { token },
      });
      expect(first.status).toBe(200);
      expect(first.body.status).toBe('verified');

      // Single-use: replaying it must fail.
      const second = await callRoute(verifyEmail, '/api/v1/auth/verify-email', {
        method: 'POST',
        body: { token },
      });
      expect(second.status).toBe(422);

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user?.emailVerifiedAt).not.toBeNull();
    });

    it('rejects an unknown verification token', async () => {
      const result = await callRoute(verifyEmail, '/api/v1/auth/verify-email', {
        method: 'POST',
        body: { token: 'a'.repeat(43) },
      });
      expect(result.status).toBe(422);
    });
  });

  describe('login', () => {
    it('issues a session for valid credentials', async () => {
      const user = await createTestUser();
      const result = await callRoute(login, '/api/v1/auth/login', {
        method: 'POST',
        body: { email: user.email, password: user.password },
      });

      expect(result.status).toBe(200);
      expect(typeof result.body.accessToken).toBe('string');
      expect(typeof result.body.refreshToken).toBe('string');
      expect(result.body.tokenType).toBe('Bearer');
      expect(result.headers.get('cache-control')).toBe('no-store');
    });

    it('gives the SAME response for a wrong password and an unknown account', async () => {
      const user = await createTestUser();

      const wrongPassword = await callRoute(login, '/api/v1/auth/login', {
        method: 'POST',
        body: { email: user.email, password: 'definitely not the password' },
      });
      const unknownAccount = await callRoute(login, '/api/v1/auth/login', {
        method: 'POST',
        body: { email: `ghost.${Date.now()}@example.test`, password: 'definitely not it' },
      });

      expect(wrongPassword.status).toBe(401);
      expect(unknownAccount.status).toBe(401);
      // Identical body: no enumeration oracle.
      expect(unknownAccount.body).toMatchObject({
        error: {
          code: 'unauthenticated',
          message: (wrongPassword.body.error as { message: string }).message,
        },
      });
    });

    it('never returns a password hash or token in the error body', async () => {
      const user = await createTestUser();
      const result = await callRoute(login, '/api/v1/auth/login', {
        method: 'POST',
        body: { email: user.email, password: 'wrong' },
      });
      expect(result.raw).not.toContain('$argon2');
      expect(result.raw).not.toContain('passwordHash');
    });

    it('locks the account after repeated failures, then rejects even the CORRECT password', async () => {
      const user = await createTestUser();

      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const failed = await callRoute(login, '/api/v1/auth/login', {
          method: 'POST',
          body: { email: user.email, password: 'wrong password here' },
          ip: '10.9.9.9',
        });
        expect(failed.status).toBe(401);
      }

      const locked = await callRoute(login, '/api/v1/auth/login', {
        method: 'POST',
        body: { email: user.email, password: user.password },
        ip: '10.9.9.9',
      });

      // The real password is refused while the lock holds — this is what stops
      // distributed guessing that rotates IPs.
      expect(locked.status).toBe(429);
      expect(locked.headers.get('retry-after')).toBeTruthy();

      const record = await prisma.user.findUnique({ where: { id: user.id } });
      expect(record?.failedLoginCount).toBeGreaterThanOrEqual(5);
      expect(record?.lockedUntil).not.toBeNull();
    });

    it('refuses a suspended account even with the right password', async () => {
      const user = await createTestUser({ status: 'SUSPENDED' });
      const result = await callRoute(login, '/api/v1/auth/login', {
        method: 'POST',
        body: { email: user.email, password: user.password },
      });
      expect(result.status).toBe(403);
    });

    it('requires a TOTP code when two-factor is enabled', async () => {
      const user = await createTestUser({ twoFactor: true });

      const withoutCode = await callRoute(login, '/api/v1/auth/login', {
        method: 'POST',
        body: { email: user.email, password: user.password },
      });
      expect(withoutCode.status).toBe(401);
      expect(withoutCode.body.accessToken).toBeUndefined();

      const withCode = await callRoute(login, '/api/v1/auth/login', {
        method: 'POST',
        body: {
          email: user.email,
          password: user.password,
          totpCode: await generateTotpCode(user.totpSecret!),
        },
      });
      expect(withCode.status).toBe(200);
    });

    it('rejects a wrong TOTP code', async () => {
      const user = await createTestUser({ twoFactor: true });
      const result = await callRoute(login, '/api/v1/auth/login', {
        method: 'POST',
        body: { email: user.email, password: user.password, totpCode: '000000' },
      });
      expect(result.status).toBe(401);
    });

    it('refuses a STAFF account that has not enrolled two-factor', async () => {
      // Mandatory for staff: holding the role is not enough.
      const staff = await createTestUser({ roles: ['finance'], twoFactor: false });
      const result = await callRoute(login, '/api/v1/auth/login', {
        method: 'POST',
        body: { email: staff.email, password: staff.password },
      });
      expect(result.status).toBe(403);
      expect((result.body.error as { message: string }).message).toContain('Two-factor');
    });
  });

  describe('refresh rotation and reuse detection', () => {
    it('rotates the refresh token, invalidating the old one', async () => {
      const user = await createTestUser();

      const rotated = await callRoute(refresh, '/api/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken: user.refreshToken },
      });
      expect(rotated.status).toBe(200);
      expect(rotated.body.refreshToken).not.toBe(user.refreshToken);
    });

    it('REVOKES THE WHOLE FAMILY when a used token is presented again', async () => {
      const user = await createTestUser();

      const first = await callRoute(refresh, '/api/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken: user.refreshToken },
      });
      expect(first.status).toBe(200);
      const newToken = first.body.refreshToken as string;

      // Replay the original — this is the theft signal.
      const replay = await callRoute(refresh, '/api/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken: user.refreshToken },
      });
      expect(replay.status).toBe(401);

      // The token issued a moment ago is now dead too: we cannot tell the
      // attacker from the user, so both must sign in again.
      const afterBreach = await callRoute(refresh, '/api/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken: newToken },
      });
      expect(afterBreach.status).toBe(401);

      const live = await prisma.refreshToken.count({
        where: { familyId: user.familyId, revokedAt: null },
      });
      expect(live).toBe(0);

      const audit = await latestAuditLog('auth.token_reuse_detected');
      expect(audit).not.toBeNull();
    });

    it('does not reveal that reuse was detected', async () => {
      const user = await createTestUser();
      await callRoute(refresh, '/api/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken: user.refreshToken },
      });
      const replay = await callRoute(refresh, '/api/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken: user.refreshToken },
      });
      const unknown = await callRoute(refresh, '/api/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken: 'z'.repeat(43) },
      });
      // Identical to an unknown token: an attacker learns nothing.
      expect(replay.status).toBe(unknown.status);
      expect((replay.body.error as { message: string }).message).toBe(
        (unknown.body.error as { message: string }).message,
      );
    });

    it('refuses to refresh a session belonging to a suspended account', async () => {
      const user = await createTestUser();
      await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });

      const result = await callRoute(refresh, '/api/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken: user.refreshToken },
      });
      expect(result.status).toBe(401);
    });
  });

  describe('logout', () => {
    it('revokes the session family', async () => {
      const user = await createTestUser();
      const result = await callRoute(logout, '/api/v1/auth/logout', {
        method: 'POST',
        token: user.accessToken,
      });
      expect(result.status).toBe(200);

      const stillValid = await callRoute(refresh, '/api/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken: user.refreshToken },
      });
      expect(stillValid.status).toBe(401);
    });
  });

  describe('step-up authentication', () => {
    it('grants a stepped-up token for the correct password', async () => {
      const user = await createTestUser({ stepUp: false });
      const result = await callRoute(stepUp, '/api/v1/auth/step-up', {
        method: 'POST',
        token: user.accessToken,
        body: { password: user.password },
      });
      expect(result.status).toBe(200);
      expect(typeof result.body.accessToken).toBe('string');
      expect(typeof result.body.stepUpExpiresAt).toBe('string');
    });

    it('refuses the wrong password', async () => {
      const user = await createTestUser({ stepUp: false });
      const result = await callRoute(stepUp, '/api/v1/auth/step-up', {
        method: 'POST',
        token: user.accessToken,
        body: { password: 'not the password' },
      });
      expect(result.status).toBe(401);
    });

    it('requires a TOTP code as well when two-factor is enabled', async () => {
      const user = await createTestUser({ twoFactor: true, stepUp: false });

      const passwordOnly = await callRoute(stepUp, '/api/v1/auth/step-up', {
        method: 'POST',
        token: user.accessToken,
        body: { password: user.password },
      });
      expect(passwordOnly.status).toBe(401);

      const withCode = await callRoute(stepUp, '/api/v1/auth/step-up', {
        method: 'POST',
        token: user.accessToken,
        body: { password: user.password, totpCode: await generateTotpCode(user.totpSecret!) },
      });
      expect(withCode.status).toBe(200);
    });
  });

  describe('password change', () => {
    it('requires step-up', async () => {
      const user = await createTestUser({ stepUp: false });
      const result = await callRoute(changePassword, '/api/v1/auth/password', {
        method: 'POST',
        token: user.accessToken,
        body: { currentPassword: user.password, newPassword: 'a brand new passphrase here' },
      });
      expect(result.status).toBe(403);
      expect((result.body.error as { message: string }).message).toContain('Re-authenticate');
    });

    it('changes the password and revokes EVERY session', async () => {
      const user = await createTestUser({ stepUp: true });

      const result = await callRoute(changePassword, '/api/v1/auth/password', {
        method: 'POST',
        token: user.accessToken,
        body: { currentPassword: user.password, newPassword: 'a brand new passphrase here' },
      });
      expect(result.status).toBe(200);
      expect(result.body.sessionsRevoked).toBeGreaterThanOrEqual(1);

      // The caller's own session dies too: if the password was changed because
      // of a compromise, leaving the attacker signed in defeats the point.
      const stale = await callRoute(refresh, '/api/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken: user.refreshToken },
      });
      expect(stale.status).toBe(401);

      const withNew = await callRoute(login, '/api/v1/auth/login', {
        method: 'POST',
        body: { email: user.email, password: 'a brand new passphrase here' },
      });
      expect(withNew.status).toBe(200);
    });

    it('rejects a new password that fails policy', async () => {
      const user = await createTestUser({ stepUp: true });
      const result = await callRoute(changePassword, '/api/v1/auth/password', {
        method: 'POST',
        token: user.accessToken,
        body: { currentPassword: user.password, newPassword: 'short' },
      });
      expect(result.status).toBe(422);
    });
  });

  describe('token handling', () => {
    it('rejects a request with no token', async () => {
      const result = await callRoute(getMe, '/api/v1/me', {});
      expect(result.status).toBe(401);
    });

    it('rejects a forged token', async () => {
      const result = await callRoute(getMe, '/api/v1/me', {
        token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.not-a-real-signature',
      });
      expect(result.status).toBe(401);
    });

    it('rejects a token signed with the wrong key', async () => {
      const user = await createTestUser();
      const tampered = `${user.accessToken.slice(0, -4)}AAAA`;
      const result = await callRoute(getMe, '/api/v1/me', { token: tampered });
      expect(result.status).toBe(401);
    });

    it('rejects a valid token for a SUSPENDED account immediately', async () => {
      // Suspension must bite now, not when the access token expires.
      const user = await createTestUser();
      await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });

      const result = await callRoute(getMe, '/api/v1/me', { token: user.accessToken });
      expect(result.status).toBe(403);
    });
  });
});
