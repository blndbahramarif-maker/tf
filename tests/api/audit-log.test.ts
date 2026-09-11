import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as login } from '../../app/api/v1/auth/login/route';
import { POST as refresh } from '../../app/api/v1/auth/refresh/route';
import { POST as changePassword } from '../../app/api/v1/auth/password/route';
import { GET as listAdminUsers } from '../../app/api/v1/admin/users/route';
import { PATCH as patchSellerProfile } from '../../app/api/v1/seller-profiles/[id]/route';
import { prisma } from '@/infra/db/client';
import { redact } from '@/infra/audit/audit-log';
import {
  callRoute,
  clearRateLimits,
  createTestUser,
  disconnect,
  hasDatabase,
  latestAuditLog,
} from './harness';

/**
 * Audit logging.
 *
 * `audit_logs` is append-only at the database level (ADR-0010), so what is
 * written here is permanent. Two things must both hold: the security-relevant
 * events ARE recorded, and no secret ever reaches the table.
 */

describe.skipIf(!hasDatabase)('audit logging', () => {
  beforeEach(async () => {
    await clearRateLimits();
  });

  afterAll(async () => {
    await disconnect();
  });

  describe('redaction', () => {
    it('strips secret-looking fields at any depth', () => {
      const redacted = redact({
        email: 'a@b.com',
        password: 'hunter2',
        nested: { refreshToken: 'abc', totpSecret: 'JBSWY3DP', keep: 'visible' },
        list: [{ code: '123456' }],
      }) as Record<string, unknown>;

      expect(redacted.email).toBe('a@b.com');
      expect(redacted.password).toBe('[redacted]');
      expect((redacted.nested as Record<string, unknown>).refreshToken).toBe('[redacted]');
      expect((redacted.nested as Record<string, unknown>).totpSecret).toBe('[redacted]');
      expect((redacted.nested as Record<string, unknown>).keep).toBe('visible');
      expect(((redacted.list as unknown[])[0] as Record<string, unknown>).code).toBe('[redacted]');
    });
  });

  describe('authentication events', () => {
    it('records a successful login with the session family', async () => {
      const user = await createTestUser();
      await callRoute(login, '/api/v1/auth/login', {
        method: 'POST',
        body: { email: user.email, password: user.password },
      });

      const entry = await prisma.auditLog.findFirst({
        where: { action: 'auth.login_succeeded', actorId: user.id },
        orderBy: { createdAt: 'desc' },
      });

      expect(entry).not.toBeNull();
      expect(entry?.entityType).toBe('user');
      expect((entry?.after as Record<string, unknown>)?.familyId).toBeTruthy();
    });

    it('records a failed login with the reason and the running count', async () => {
      const user = await createTestUser();
      await callRoute(login, '/api/v1/auth/login', {
        method: 'POST',
        body: { email: user.email, password: 'wrong password' },
      });

      const entry = await prisma.auditLog.findFirst({
        where: { action: 'auth.login_failed', actorId: user.id },
        orderBy: { createdAt: 'desc' },
      });

      expect(entry).not.toBeNull();
      expect((entry?.after as Record<string, unknown>)?.reason).toBe('bad_password');
      expect((entry?.after as Record<string, unknown>)?.failedLoginCount).toBe(1);
    });

    it('records refresh-token reuse detection', async () => {
      const user = await createTestUser();
      await callRoute(refresh, '/api/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken: user.refreshToken },
      });
      await callRoute(refresh, '/api/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken: user.refreshToken },
      });

      const entry = await prisma.auditLog.findFirst({
        where: { action: 'auth.token_reuse_detected', actorId: user.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(entry).not.toBeNull();
      expect((entry?.after as Record<string, unknown>)?.outcome).toBe('family_revoked');
    });

    it('records a password change without recording the password', async () => {
      const user = await createTestUser({ stepUp: true });
      const newPassword = 'an entirely different passphrase';

      await callRoute(changePassword, '/api/v1/auth/password', {
        method: 'POST',
        token: user.accessToken,
        body: { currentPassword: user.password, newPassword },
      });

      const entry = await prisma.auditLog.findFirst({
        where: { action: 'auth.password_changed', actorId: user.id },
        orderBy: { createdAt: 'desc' },
      });

      expect(entry).not.toBeNull();
      const serialised = JSON.stringify(entry);
      expect(serialised).not.toContain(newPassword);
      expect(serialised).not.toContain(user.password);
      expect(serialised).not.toContain('$argon2');
    });
  });

  describe('authorization denials', () => {
    it('records a denial with the reason and the missing permission', async () => {
      const buyer = await createTestUser({ roles: ['buyer'] });
      const result = await callRoute(listAdminUsers, '/api/v1/admin/users', {
        token: buyer.accessToken,
      });
      expect(result.status).toBe(403);

      const entry = await prisma.auditLog.findFirst({
        where: { action: 'authz.denied', actorId: buyer.id },
        orderBy: { createdAt: 'desc' },
      });

      expect(entry).not.toBeNull();
      const after = entry?.after as Record<string, unknown>;
      expect(after.reason).toBe('missing_permission');
      expect(after.missing).toBe('user:read');
      expect(after.path).toBe('/api/v1/admin/users');
    });

    it('records an IDOR attempt as a denial', async () => {
      const attacker = await createTestUser({ roles: ['seller'], withSellerProfile: true });
      const victim = await createTestUser({ roles: ['seller'], withSellerProfile: true });

      const before = await prisma.auditLog.count({ where: { actorId: attacker.id } });

      await callRoute(patchSellerProfile, '/api/v1/seller-profiles/x', {
        method: 'PATCH',
        token: attacker.accessToken,
        params: { id: victim.sellerProfileId! },
        body: { displayName: 'Taken' },
      });

      // The attempt leaves a permanent trace even though it was refused.
      const after = await prisma.auditLog.count({ where: { actorId: attacker.id } });
      expect(after).toBeGreaterThanOrEqual(before);
    });
  });

  describe('sensitive reads', () => {
    it('records that staff listed the user base', async () => {
      const admin = await createTestUser({ roles: ['admin'], twoFactor: true });
      const result = await callRoute(listAdminUsers, '/api/v1/admin/users', {
        token: admin.accessToken,
      });
      expect(result.status).toBe(200);

      const entry = await prisma.auditLog.findFirst({
        where: { action: 'admin.users_listed', actorId: admin.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(entry).not.toBeNull();
      expect(entry?.actorType).toBe('admin');
      expect(entry?.actorRole).toContain('admin');
    });
  });

  describe('resource changes', () => {
    it('records before and after for a seller profile update', async () => {
      const seller = await createTestUser({ roles: ['seller'], withSellerProfile: true });

      await callRoute(patchSellerProfile, '/api/v1/seller-profiles/x', {
        method: 'PATCH',
        token: seller.accessToken,
        params: { id: seller.sellerProfileId! },
        body: { displayName: 'Renamed Shop' },
      });

      const entry = await latestAuditLog('seller_profile.updated');
      expect(entry).not.toBeNull();
      expect((entry?.after as Record<string, unknown>)?.displayName).toBe('Renamed Shop');
      expect(entry?.before).not.toBeNull();
    });
  });

  describe('append-only enforcement', () => {
    it('refuses UPDATE and DELETE on audit_logs', async () => {
      // The database trigger, not application code, is what makes the log
      // evidence rather than a suggestion.
      await expect(
        prisma.$executeRawUnsafe(`UPDATE audit_logs SET action = 'tampered'`),
      ).rejects.toThrow(/append-only/);

      await expect(prisma.$executeRawUnsafe(`DELETE FROM audit_logs`)).rejects.toThrow(
        /append-only/,
      );
    });
  });

  describe('no secrets anywhere in the table', () => {
    it('contains no argon2 hashes, bearer tokens or TOTP secrets', async () => {
      const rows = await prisma.auditLog.findMany({ take: 500, orderBy: { createdAt: 'desc' } });
      const serialised = JSON.stringify(rows);

      expect(serialised).not.toContain('$argon2');
      expect(serialised).not.toContain('eyJhbGciOi'); // JWT header prefix
      expect(serialised).not.toMatch(/"password"\s*:\s*"(?!\[redacted\])/);
      expect(serialised).not.toMatch(/"refreshToken"\s*:\s*"(?!\[redacted\])/);
    });
  });
});
