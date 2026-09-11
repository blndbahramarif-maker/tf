import { beforeAll, describe, expect, it } from 'vitest';
import { PATCH as updateMe, GET as getMe } from '../../app/api/v1/me/route';
import { POST as createListing } from '../../app/api/v1/listings/route';
import { GET as refreshSession, safeNext } from '../../app/api/v1/auth/session/route';
import {
  ACCESS_COOKIE,
  CSRF_COOKIE,
  REFRESH_COOKIE,
  issueCsrfToken,
  verifyCsrfToken,
} from '@/infra/auth/session-cookies';
import { prisma } from '@/infra/db/client';
import { callRoute, createTestUser, hasDatabase, type TestUser } from './harness';

/**
 * Browser session transport.
 *
 * These tests exercise the COOKIE path specifically. The bearer path is
 * covered by the Phase 3 suites and must keep working unchanged — several
 * tests here assert exactly that, because the easiest way to break API clients
 * is to "add CSRF" to everything.
 */
describe.skipIf(!hasDatabase)('cookie session transport', () => {
  let user: TestUser;
  let csrf: string;

  beforeAll(async () => {
    user = await createTestUser({ roles: ['seller'], withSellerProfile: true, stepUp: true });
    csrf = issueCsrfToken(user.familyId);
  }, 60_000);

  describe('authentication by cookie', () => {
    it('authenticates a GET using the access cookie alone', async () => {
      const result = await callRoute(getMe, '/api/v1/me', {
        cookies: { [ACCESS_COOKIE]: user.accessToken },
      });
      expect(result.status).toBe(200);
      expect(result.body.id).toBe(user.id);
    });

    it('rejects a request with no cookie and no bearer token', async () => {
      const result = await callRoute(getMe, '/api/v1/me', {});
      expect(result.status).toBe(401);
    });

    it('rejects a forged access cookie', async () => {
      const result = await callRoute(getMe, '/api/v1/me', {
        cookies: { [ACCESS_COOKIE]: 'not.a.jwt' },
      });
      expect(result.status).toBe(401);
    });

    it('prefers the Authorization header when both are present', async () => {
      // A caller that sets a header means it; silently falling back to a stale
      // cookie would make the transport — and therefore the CSRF rule —
      // ambiguous.
      const other = await createTestUser({ roles: ['buyer'] });
      const result = await callRoute(getMe, '/api/v1/me', {
        token: user.accessToken,
        cookies: { [ACCESS_COOKIE]: other.accessToken },
      });
      expect(result.status).toBe(200);
      expect(result.body.id).toBe(user.id);
    });
  });

  describe('CSRF on cookie-authenticated mutations', () => {
    it('refuses a cookie-authenticated POST with NO csrf token', async () => {
      const result = await callRoute(updateMe, '/api/v1/me', {
        method: 'PATCH',
        cookies: { [ACCESS_COOKIE]: user.accessToken, [CSRF_COOKIE]: csrf },
        body: { displayName: 'CSRF probe' },
      });
      expect(result.status).toBe(403);
      expect((result.body.error as { code: string }).code).toBe('forbidden');
    });

    it('accepts a cookie-authenticated POST WITH a matching signed token', async () => {
      const result = await callRoute(updateMe, '/api/v1/me', {
        method: 'PATCH',
        cookies: { [ACCESS_COOKIE]: user.accessToken, [CSRF_COOKIE]: csrf },
        csrfHeader: csrf,
        headers: { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' },
        body: { displayName: 'CSRF accepted' },
      });
      expect(result.status).toBe(200);
    });

    it('refuses when header and cookie disagree', async () => {
      const result = await callRoute(updateMe, '/api/v1/me', {
        method: 'PATCH',
        cookies: { [ACCESS_COOKIE]: user.accessToken, [CSRF_COOKIE]: csrf },
        csrfHeader: issueCsrfToken(user.familyId),
        body: { displayName: 'mismatch' },
      });
      expect(result.status).toBe(403);
    });

    it('refuses a token minted for a DIFFERENT session, even when both halves match', async () => {
      // The attack plain double-submit cannot stop: the attacker controls both
      // halves. Only the HMAC binding to the victim's family refuses it.
      const attacker = await createTestUser({ roles: ['buyer'] });
      const foreign = issueCsrfToken(attacker.familyId);

      const result = await callRoute(updateMe, '/api/v1/me', {
        method: 'PATCH',
        cookies: { [ACCESS_COOKIE]: user.accessToken, [CSRF_COOKIE]: foreign },
        csrfHeader: foreign,
        headers: { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' },
        body: { displayName: 'planted' },
      });
      expect(result.status).toBe(403);
    });

    it('refuses a cross-site request even with a valid token', async () => {
      const result = await callRoute(updateMe, '/api/v1/me', {
        method: 'PATCH',
        cookies: { [ACCESS_COOKIE]: user.accessToken, [CSRF_COOKIE]: csrf },
        csrfHeader: csrf,
        headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.test' },
        body: { displayName: 'cross site' },
      });
      expect(result.status).toBe(403);
    });

    it('refuses a mismatched Origin', async () => {
      const result = await callRoute(updateMe, '/api/v1/me', {
        method: 'PATCH',
        cookies: { [ACCESS_COOKIE]: user.accessToken, [CSRF_COOKIE]: csrf },
        csrfHeader: csrf,
        headers: { origin: 'https://evil.test', 'sec-fetch-site': 'same-origin' },
        body: { displayName: 'bad origin' },
      });
      expect(result.status).toBe(403);
    });

    it('does not require CSRF for a safe method', async () => {
      const result = await callRoute(getMe, '/api/v1/me', {
        cookies: { [ACCESS_COOKIE]: user.accessToken },
      });
      expect(result.status).toBe(200);
    });

    it('leaves the BEARER transport completely unaffected', async () => {
      // If this ever fails, every API and mobile client is broken.
      const result = await callRoute(updateMe, '/api/v1/me', {
        method: 'PATCH',
        token: user.accessToken,
        body: { displayName: 'bearer still works' },
      });
      expect(result.status).toBe(200);
    });

    it('protects listing creation, not just account routes', async () => {
      const denied = await callRoute(createListing, '/api/v1/listings', {
        method: 'POST',
        cookies: { [ACCESS_COOKIE]: user.accessToken, [CSRF_COOKIE]: csrf },
        body: {
          categorySlug: 'mobile-electronics',
          title: 'CSRF probe listing',
          description: 'A description long enough to satisfy the minimum length rule.',
          countryCode: 'GB',
          priceMinor: '1000',
          attributes: { brand: 'X', model: 'Y' },
        },
      });
      expect(denied.status).toBe(403);
    });

    it('writes an audit record when a CSRF check refuses a request', async () => {
      await callRoute(updateMe, '/api/v1/me', {
        method: 'PATCH',
        cookies: { [ACCESS_COOKIE]: user.accessToken, [CSRF_COOKIE]: csrf },
        body: { displayName: 'audited refusal' },
      });
      const row = await prisma.auditLog.findFirst({
        where: { action: 'authz.csrf_rejected', actorId: user.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(row).not.toBeNull();
    });
  });

  describe('CSRF token binding', () => {
    it('verifies a token against the family it was minted for', () => {
      expect(verifyCsrfToken(csrf, user.familyId)).toBe(true);
    });

    it('refuses the same token against another family', () => {
      expect(verifyCsrfToken(csrf, 'a-different-family')).toBe(false);
    });

    it('refuses a tampered signature', () => {
      const [nonce] = csrf.split('.');
      expect(verifyCsrfToken(`${nonce}.tampered`, user.familyId)).toBe(false);
    });

    it('refuses structurally malformed tokens', () => {
      expect(verifyCsrfToken('no-separator', user.familyId)).toBe(false);
      expect(verifyCsrfToken('', user.familyId)).toBe(false);
      expect(verifyCsrfToken(null, user.familyId)).toBe(false);
      expect(verifyCsrfToken('.onlysig', user.familyId)).toBe(false);
    });
  });

  describe('browser silent refresh', () => {
    it('rotates the session and redirects back', async () => {
      const fresh = await createTestUser({ roles: ['buyer'] });
      const response = await refreshSession(
        new Request('http://localhost:3000/api/v1/auth/session?next=%2Fen%2Fdashboard', {
          headers: { cookie: `${REFRESH_COOKIE}=${fresh.refreshToken}` },
        }),
      );
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toContain('/en/dashboard');

      const setCookie = response.headers.getSetCookie().join('\n');
      expect(setCookie).toContain(ACCESS_COOKIE);
      expect(setCookie).toContain('HttpOnly');
    });

    it('preserves reuse detection: a replayed token kills the family', async () => {
      const victim = await createTestUser({ roles: ['buyer'] });
      const cookie = `${REFRESH_COOKIE}=${victim.refreshToken}`;
      const url = 'http://localhost:3000/api/v1/auth/session';

      await refreshSession(new Request(url, { headers: { cookie } }));
      // Second use of the same token is the signature of a stolen session.
      await refreshSession(new Request(url, { headers: { cookie } }));

      const live = await prisma.refreshToken.count({
        where: { familyId: victim.familyId, revokedAt: null },
      });
      expect(live).toBe(0);
    });

    it('clears cookies when no refresh token is presented', async () => {
      const response = await refreshSession(
        new Request('http://localhost:3000/api/v1/auth/session'),
      );
      expect(response.status).toBe(303);
      const setCookie = response.headers.getSetCookie().join('\n');
      expect(setCookie).toContain(ACCESS_COOKIE);
    });
  });

  describe('open redirect protection on the refresh bounce', () => {
    it('keeps a relative path', () => {
      expect(safeNext('/en/dashboard')).toBe('/en/dashboard');
      expect(safeNext('/en/dashboard?tab=live')).toBe('/en/dashboard?tab=live');
    });

    it('refuses an absolute URL to another site', () => {
      expect(safeNext('https://evil.test/steal')).toBe('/');
    });

    it('refuses a protocol-relative URL', () => {
      // `//evil.test` is read by the browser as "same scheme, that host".
      expect(safeNext('//evil.test/steal')).toBe('/');
    });

    it('refuses a backslash-escaped path', () => {
      expect(safeNext('/\\evil.test')).toBe('/');
      expect(safeNext('\\\\evil.test')).toBe('/');
    });

    it('falls back for empty or absent input', () => {
      expect(safeNext(null)).toBe('/');
      expect(safeNext('')).toBe('/');
    });
  });
});
