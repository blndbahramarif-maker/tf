import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as getMe, PATCH as patchMe } from '../../app/api/v1/me/route';
import { GET as listSessions } from '../../app/api/v1/sessions/route';
import { DELETE as revokeSession } from '../../app/api/v1/sessions/[id]/route';
import { POST as createSellerProfile } from '../../app/api/v1/seller-profiles/route';
import {
  GET as getSellerProfile,
  PATCH as patchSellerProfile,
} from '../../app/api/v1/seller-profiles/[id]/route';
import { prisma } from '@/infra/db/client';
import {
  callRoute,
  clearRateLimits,
  createTestUser,
  disconnect,
  hasDatabase,
  orphanId,
  type TestUser,
} from './harness';

/**
 * DELIBERATE IDOR ATTEMPTS.
 *
 * Every test here is an authenticated user attacking another user's resources
 * by supplying their identifiers. Each asserts three things:
 *
 *   1. the correct status (404 where existence must not be disclosed,
 *      403 where the caller lacks the permission outright);
 *   2. that NO field of the victim's data appears in the response body;
 *   3. that the victim's data is UNCHANGED afterwards.
 *
 * Assertion 2 matters as much as assertion 1: a 404 that still echoes the
 * resource in its body has leaked it anyway.
 */

describe.skipIf(!hasDatabase)('IDOR — horizontal privilege escalation', () => {
  let attacker: TestUser;
  let victim: TestUser;
  let victimSessionId: string;
  let victimProfileBefore: { displayName: string; about: string | null };

  beforeAll(async () => {
    await clearRateLimits();
    attacker = await createTestUser({ roles: ['seller'], withSellerProfile: true, stepUp: true });
    victim = await createTestUser({ roles: ['seller'], withSellerProfile: true, stepUp: true });

    await prisma.sellerProfile.update({
      where: { id: victim.sellerProfileId! },
      data: { displayName: 'Victim Trading Ltd', about: 'Victim private notes' },
    });

    const profile = await prisma.sellerProfile.findUniqueOrThrow({
      where: { id: victim.sellerProfileId! },
      select: { displayName: true, about: true },
    });
    victimProfileBefore = profile;

    const session = await prisma.refreshToken.findFirstOrThrow({
      where: { userId: victim.id, revokedAt: null },
      select: { id: true },
    });
    victimSessionId = session.id;
  }, 120_000);

  afterAll(async () => {
    await disconnect();
  });

  describe("seller profile — reading another user's", () => {
    it('returns 404 and leaks nothing', async () => {
      const result = await callRoute(getSellerProfile, '/api/v1/seller-profiles/x', {
        token: attacker.accessToken,
        params: { id: victim.sellerProfileId! },
      });

      expect(result.status).toBe(404);
      // Nothing about the victim may appear anywhere in the response.
      expect(result.raw).not.toContain('Victim Trading Ltd');
      expect(result.raw).not.toContain('Victim private notes');
      expect(result.raw).not.toContain(victim.sellerProfileId!);
      expect(result.raw).not.toContain(victim.id);
      expect(result.raw).not.toContain(victim.email);
    });

    it('is INDISTINGUISHABLE from a resource that does not exist', async () => {
      // If these differed, the endpoint would be an oracle for discovering
      // which ids are real.
      const foreign = await callRoute(getSellerProfile, '/api/v1/seller-profiles/x', {
        token: attacker.accessToken,
        params: { id: victim.sellerProfileId! },
      });
      const nonexistent = await callRoute(getSellerProfile, '/api/v1/seller-profiles/x', {
        token: attacker.accessToken,
        params: { id: orphanId() },
      });

      expect(foreign.status).toBe(nonexistent.status);
      expect((foreign.body.error as { code: string }).code).toBe(
        (nonexistent.body.error as { code: string }).code,
      );
      expect((foreign.body.error as { message: string }).message).toBe(
        (nonexistent.body.error as { message: string }).message,
      );
    });

    it('does not 500 on a malformed id', async () => {
      // A stack trace is a disclosure too.
      for (const id of ['not-a-uuid', '', '../../etc/passwd', "' OR 1=1 --", '00000000']) {
        const result = await callRoute(getSellerProfile, '/api/v1/seller-profiles/x', {
          token: attacker.accessToken,
          params: { id },
        });
        expect(result.status).toBe(404);
        expect(result.raw).not.toMatch(/prisma|stack|at Object|node_modules/i);
      }
    });

    it('lets the OWNER read their own profile', async () => {
      // The control: the guard is refusing the attacker, not everybody.
      const result = await callRoute(getSellerProfile, '/api/v1/seller-profiles/x', {
        token: victim.accessToken,
        params: { id: victim.sellerProfileId! },
      });
      expect(result.status).toBe(200);
      expect(result.body.displayName).toBe('Victim Trading Ltd');
    });
  });

  describe("seller profile — writing another user's", () => {
    it('returns 404 and does NOT modify the victim', async () => {
      const result = await callRoute(patchSellerProfile, '/api/v1/seller-profiles/x', {
        method: 'PATCH',
        token: attacker.accessToken,
        params: { id: victim.sellerProfileId! },
        body: { displayName: 'Owned By Attacker', about: 'pwned' },
      });

      expect(result.status).toBe(404);

      const after = await prisma.sellerProfile.findUniqueOrThrow({
        where: { id: victim.sellerProfileId! },
        select: { displayName: true, about: true },
      });
      expect(after).toEqual(victimProfileBefore);
    });

    it('cannot be bypassed by also sending the victim id in the BODY', async () => {
      const result = await callRoute(patchSellerProfile, '/api/v1/seller-profiles/x', {
        method: 'PATCH',
        token: attacker.accessToken,
        params: { id: attacker.sellerProfileId! },
        body: {
          displayName: 'Renamed',
          // Extra fields an attacker might hope are trusted.
          id: victim.sellerProfileId,
          userId: victim.id,
          ownerUserId: victim.id,
        },
      });

      // The attacker updates their OWN profile; the injected ids are ignored.
      expect(result.status).toBe(200);
      const victimAfter = await prisma.sellerProfile.findUniqueOrThrow({
        where: { id: victim.sellerProfileId! },
        select: { displayName: true, about: true },
      });
      expect(victimAfter).toEqual(victimProfileBefore);
    });

    it('refuses even for staff holding the read override', async () => {
      // `user:read` allows READING another profile; it must never allow writing.
      const support = await createTestUser({ roles: ['support'], twoFactor: true, stepUp: true });
      const result = await callRoute(patchSellerProfile, '/api/v1/seller-profiles/x', {
        method: 'PATCH',
        token: support.accessToken,
        params: { id: victim.sellerProfileId! },
        body: { displayName: 'Support Was Here' },
      });

      // 403: support lacks seller:update_own_profile entirely.
      expect(result.status).toBe(403);
      const after = await prisma.sellerProfile.findUniqueOrThrow({
        where: { id: victim.sellerProfileId! },
        select: { displayName: true, about: true },
      });
      expect(after).toEqual(victimProfileBefore);
    });
  });

  describe("sessions — revoking another user's", () => {
    it('returns 404 and leaves the victim signed in', async () => {
      const result = await callRoute(revokeSession, '/api/v1/sessions/x', {
        method: 'DELETE',
        token: attacker.accessToken,
        params: { id: victimSessionId },
      });

      expect(result.status).toBe(404);

      // Session hijacking prevention: the victim must still be signed in.
      const stillActive = await prisma.refreshToken.findUniqueOrThrow({
        where: { id: victimSessionId },
        select: { revokedAt: true },
      });
      expect(stillActive.revokedAt).toBeNull();
    });

    it('lets the owner revoke their own session', async () => {
      const own = await prisma.refreshToken.findFirstOrThrow({
        where: { userId: attacker.id, revokedAt: null },
        select: { id: true },
      });
      const result = await callRoute(revokeSession, '/api/v1/sessions/x', {
        method: 'DELETE',
        token: attacker.accessToken,
        params: { id: own.id },
      });
      expect(result.status).toBe(200);
    });
  });

  describe('session listing cannot be widened', () => {
    it('returns only the caller’s own sessions', async () => {
      const result = await callRoute(listSessions, '/api/v1/sessions', {
        token: victim.accessToken,
        // Parameters an attacker might hope are honoured.
        searchParams: { userId: attacker.id, user_id: attacker.id, all: 'true' },
      });

      expect(result.status).toBe(200);
      const data = result.body.data as Array<{ id: string }>;
      const ids = data.map((session) => session.id);

      const attackerSessions = await prisma.refreshToken.findMany({
        where: { userId: attacker.id },
        select: { id: true },
      });
      for (const session of attackerSessions) {
        expect(ids).not.toContain(session.id);
      }
    });
  });

  describe('account identity cannot be supplied by the client', () => {
    it('GET /me always resolves from the token, never a parameter', async () => {
      const result = await callRoute(getMe, '/api/v1/me', {
        token: attacker.accessToken,
        searchParams: { userId: victim.id, id: victim.id, sub: victim.id },
      });

      expect(result.status).toBe(200);
      expect(result.body.id).toBe(attacker.id);
      expect(result.body.id).not.toBe(victim.id);
      expect(result.raw).not.toContain(victim.email);
    });

    it('PATCH /me cannot be redirected at another account', async () => {
      const before = await prisma.profile.findUniqueOrThrow({
        where: { userId: victim.id },
        select: { displayName: true },
      });

      const result = await callRoute(patchMe, '/api/v1/me', {
        method: 'PATCH',
        token: attacker.accessToken,
        body: { displayName: 'Injected', userId: victim.id, id: victim.id },
      });
      expect(result.status).toBe(200);

      const victimProfile = await prisma.profile.findUniqueOrThrow({
        where: { userId: victim.id },
        select: { displayName: true },
      });
      expect(victimProfile.displayName).toBe(before.displayName);

      const attackerProfile = await prisma.profile.findUniqueOrThrow({
        where: { userId: attacker.id },
        select: { displayName: true },
      });
      expect(attackerProfile.displayName).toBe('Injected');
    });

    it('POST /seller-profiles creates for the TOKEN subject, not a supplied id', async () => {
      const fresh = await createTestUser({ roles: ['buyer'], stepUp: true });

      const result = await callRoute(createSellerProfile, '/api/v1/seller-profiles', {
        method: 'POST',
        token: fresh.accessToken,
        body: {
          displayName: 'Impersonation Attempt',
          countryCode: 'GB',
          userId: victim.id,
          sellerProfileId: victim.sellerProfileId,
        },
      });

      expect(result.status).toBe(201);
      const created = await prisma.sellerProfile.findUniqueOrThrow({
        where: { id: result.body.id as string },
        select: { userId: true },
      });
      expect(created.userId).toBe(fresh.id);
      expect(created.userId).not.toBe(victim.id);
    });
  });

  describe('vertical privilege escalation', () => {
    it('a buyer cannot grant themselves permissions through the request', async () => {
      const buyer = await createTestUser({ roles: ['buyer'], stepUp: true });
      const result = await callRoute(patchMe, '/api/v1/me', {
        method: 'PATCH',
        token: buyer.accessToken,
        body: {
          displayName: 'Escalation',
          roles: ['admin'],
          permissions: ['user:ban', 'payout:release'],
          status: 'ACTIVE',
        },
      });
      expect(result.status).toBe(200);

      const roles = await prisma.userRole.findMany({
        where: { userId: buyer.id },
        select: { role: { select: { key: true } } },
      });
      expect(roles.map((entry) => entry.role.key)).toEqual(['buyer']);
    });
  });
});
