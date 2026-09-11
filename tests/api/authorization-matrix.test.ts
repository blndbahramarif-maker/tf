import { mkdirSync, writeFileSync } from 'node:fs';
import nodePath from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as getMe, PATCH as patchMe } from '../../app/api/v1/me/route';
import { DELETE as revokeAll, GET as listSessions } from '../../app/api/v1/sessions/route';
import { DELETE as revokeSession } from '../../app/api/v1/sessions/[id]/route';
import { POST as createSellerProfile } from '../../app/api/v1/seller-profiles/route';
import {
  GET as getSellerProfile,
  PATCH as patchSellerProfile,
} from '../../app/api/v1/seller-profiles/[id]/route';
import { GET as listAdminUsers } from '../../app/api/v1/admin/users/route';
import { POST as createListing } from '../../app/api/v1/listings/route';
import {
  DELETE as deleteListing,
  PATCH as patchListing,
} from '../../app/api/v1/listings/[id]/route';
import { POST as listingTransition } from '../../app/api/v1/listings/[id]/status/route';
import { POST as startImageUpload } from '../../app/api/v1/listings/[id]/images/route';
import { POST as logout } from '../../app/api/v1/auth/logout/route';
import { POST as stepUp } from '../../app/api/v1/auth/step-up/route';
import { POST as changePassword } from '../../app/api/v1/auth/password/route';
import { POST as totpEnroll } from '../../app/api/v1/auth/totp/enroll/route';
import { POST as totpVerify } from '../../app/api/v1/auth/totp/verify/route';
import {
  callRoute,
  clearRateLimits,
  createTestListing,
  createTestUser,
  disconnect,
  hasDatabase,
  type TestUser,
} from './harness';

/**
 * THE AUTHORIZATION MATRIX.
 *
 * Every role is exercised against every protected route in Phase 3. The
 * expectation for each cell is declared as data and asserted against the real
 * handler, so the matrix in the report is generated from executed results
 * rather than written by hand and hoped for.
 *
 * Expected status meanings:
 *   200/201/204 — allowed
 *   401         — not authenticated
 *   403         — authenticated but refused (permission, 2FA, step-up)
 *   404         — refused, and the resource's existence is not disclosed
 *   409/422     — allowed through authorization, then rejected on business
 *                 grounds (e.g. profile already exists, invalid TOTP code).
 *                 These still prove the guard PASSED.
 */

type RoleKey =
  | 'guest'
  | 'buyer'
  | 'seller'
  | 'business_seller'
  | 'moderator'
  | 'support'
  | 'finance'
  | 'admin'
  | 'super_admin';

const ROLES: RoleKey[] = [
  'guest',
  'buyer',
  'seller',
  'business_seller',
  'moderator',
  'support',
  'finance',
  'admin',
  'super_admin',
];

/** Staff roles must have TOTP enrolled or nothing is granted. */
const STAFF: ReadonlySet<RoleKey> = new Set([
  'moderator',
  'support',
  'finance',
  'admin',
  'super_admin',
]);

interface RouteCase {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly permission: string;
  readonly ownership: string;
  /** Status per role. Any role omitted defaults to `denied`. */
  readonly expect: Partial<Record<RoleKey, number>>;
  readonly denied: number;
  /**
   * Create a brand-new user for each cell.
   *
   * Required for cases that MUTATE account state (creating a seller profile,
   * enrolling two-factor). Sharing a user across those would make the result
   * depend on the order tests happen to run in, which is not a property any
   * authorization assertion should have.
   *
   * `plain` — no seller profile, for cases that CREATE one.
   * `with-seller-profile` — selling roles already have one, so a refusal
   *   reflects PERMISSION rather than a missing prerequisite.
   */
  readonly freshUser?: 'plain' | 'with-seller-profile';
  run(user: TestUser | null, actors: Actors): Promise<{ status: number }>;
}

interface Actors {
  /** A seller profile owned by someone else entirely. */
  foreignProfileId: string;
  foreignSessionId: string;
  /**
   * Creates a FRESH listing owned by a third party.
   *
   * A factory rather than a fixed id because transition cases mutate the
   * listing; sharing one would make the result depend on test order.
   */
  makeForeignListing: (status?: 'DRAFT' | 'ACTIVE') => Promise<string>;
}

const ALLOWED_ALL: Partial<Record<RoleKey, number>> = {
  buyer: 200,
  seller: 200,
  business_seller: 200,
  moderator: 200,
  support: 200,
  finance: 200,
  admin: 200,
  super_admin: 200,
};

const CASES: RouteCase[] = [
  {
    id: 'GET /api/v1/me',
    method: 'GET',
    path: '/api/v1/me',
    permission: 'account:read_self',
    ownership: 'implicit — token subject only',
    expect: ALLOWED_ALL,
    denied: 401,
    run: (user) => callRoute(getMe, '/api/v1/me', { token: user?.accessToken ?? null }),
  },
  {
    id: 'PATCH /api/v1/me',
    method: 'PATCH',
    path: '/api/v1/me',
    permission: 'account:update_self',
    ownership: 'implicit — token subject only',
    expect: ALLOWED_ALL,
    denied: 401,
    run: (user) =>
      callRoute(patchMe, '/api/v1/me', {
        method: 'PATCH',
        token: user?.accessToken ?? null,
        body: { timezone: 'Europe/London' },
      }),
  },
  {
    id: 'GET /api/v1/sessions',
    method: 'GET',
    path: '/api/v1/sessions',
    permission: 'account:read_self',
    ownership: 'implicit — query scoped to token subject',
    expect: ALLOWED_ALL,
    denied: 401,
    run: (user) =>
      callRoute(listSessions, '/api/v1/sessions', { token: user?.accessToken ?? null }),
  },
  {
    id: 'DELETE /api/v1/sessions (revoke all)',
    method: 'DELETE',
    path: '/api/v1/sessions',
    permission: 'account:manage_security + STEP-UP',
    ownership: 'implicit',
    expect: ALLOWED_ALL,
    denied: 401,
    run: (user) =>
      callRoute(revokeAll, '/api/v1/sessions', {
        method: 'DELETE',
        token: user?.accessToken ?? null,
      }),
  },
  {
    id: "DELETE /api/v1/sessions/{id} (another user's)",
    method: 'DELETE',
    path: '/api/v1/sessions/{id}',
    permission: 'account:manage_security',
    ownership: 'explicit — owner only, no override',
    // Every role, staff included, gets 404 for a session that is not theirs.
    expect: {
      buyer: 404,
      seller: 404,
      business_seller: 404,
      moderator: 404,
      support: 404,
      finance: 404,
      admin: 404,
      super_admin: 404,
    },
    denied: 401,
    run: (user, actors) =>
      callRoute(revokeSession, '/api/v1/sessions/x', {
        method: 'DELETE',
        token: user?.accessToken ?? null,
        params: { id: actors.foreignSessionId },
      }),
  },
  {
    id: 'POST /api/v1/seller-profiles',
    method: 'POST',
    path: '/api/v1/seller-profiles',
    permission: 'seller:create_profile',
    ownership: 'implicit — owner is the token subject',
    // Staff accounts are for platform operations, not commerce, so they do
    // NOT hold seller:create_profile. super_admin holds every permission.
    expect: { buyer: 201, seller: 201, business_seller: 201, super_admin: 201 },
    denied: 401,
    freshUser: 'plain',
    run: (user) =>
      callRoute(createSellerProfile, '/api/v1/seller-profiles', {
        method: 'POST',
        token: user?.accessToken ?? null,
        body: { displayName: 'Matrix Seller', countryCode: 'GB' },
      }),
  },
  {
    id: "GET /api/v1/seller-profiles/{id} (another user's)",
    method: 'GET',
    path: '/api/v1/seller-profiles/{id}',
    permission: 'account:read_self',
    ownership: 'explicit — owner, or override user:read',
    // Roles holding user:read may read another seller's profile for support.
    expect: {
      buyer: 404,
      seller: 404,
      business_seller: 404,
      moderator: 200,
      support: 200,
      admin: 200,
      super_admin: 200,
      finance: 404,
    },
    denied: 401,
    run: (user, actors) =>
      callRoute(getSellerProfile, '/api/v1/seller-profiles/x', {
        token: user?.accessToken ?? null,
        params: { id: actors.foreignProfileId },
      }),
  },
  {
    id: "PATCH /api/v1/seller-profiles/{id} (another user's)",
    method: 'PATCH',
    path: '/api/v1/seller-profiles/{id}',
    permission: 'seller:update_own_profile',
    ownership: 'explicit — owner only, NO override',
    // Nobody writes someone else's profile. Roles without the permission are
    // refused at 403 before ownership is even consulted.
    expect: {
      buyer: 403,
      moderator: 403,
      support: 403,
      finance: 403,
      admin: 403,
      seller: 404,
      business_seller: 404,
      super_admin: 404,
    },
    denied: 401,
    run: (user, actors) =>
      callRoute(patchSellerProfile, '/api/v1/seller-profiles/x', {
        method: 'PATCH',
        token: user?.accessToken ?? null,
        params: { id: actors.foreignProfileId },
        body: { displayName: 'Hijacked' },
      }),
  },
  {
    id: 'GET /api/v1/admin/users',
    method: 'GET',
    path: '/api/v1/admin/users',
    permission: 'user:read',
    ownership: 'n/a — staff surface',
    // Finance is excluded on purpose: the role that moves money does not get
    // to browse the user base.
    expect: {
      buyer: 403,
      seller: 403,
      business_seller: 403,
      finance: 403,
      moderator: 200,
      support: 200,
      admin: 200,
      super_admin: 200,
    },
    denied: 401,
    run: (user) =>
      callRoute(listAdminUsers, '/api/v1/admin/users', { token: user?.accessToken ?? null }),
  },
  {
    id: 'POST /api/v1/auth/logout',
    method: 'POST',
    path: '/api/v1/auth/logout',
    permission: 'account:read_self',
    ownership: 'implicit',
    expect: ALLOWED_ALL,
    denied: 401,
    run: (user) =>
      callRoute(logout, '/api/v1/auth/logout', {
        method: 'POST',
        token: user?.accessToken ?? null,
      }),
  },
  {
    id: 'POST /api/v1/auth/step-up',
    method: 'POST',
    path: '/api/v1/auth/step-up',
    permission: 'account:read_self',
    ownership: 'implicit',
    // Staff have TOTP enrolled, so password alone is refused at 401.
    expect: {
      buyer: 200,
      seller: 200,
      business_seller: 200,
      moderator: 401,
      support: 401,
      finance: 401,
      admin: 401,
      super_admin: 401,
    },
    denied: 401,
    run: (user) =>
      callRoute(stepUp, '/api/v1/auth/step-up', {
        method: 'POST',
        token: user?.accessToken ?? null,
        body: { password: user?.password ?? 'x' },
      }),
  },
  {
    id: 'POST /api/v1/auth/password',
    method: 'POST',
    path: '/api/v1/auth/password',
    permission: 'account:manage_security + STEP-UP',
    ownership: 'implicit',
    // 422 = guard passed, then the deliberately weak new password was refused.
    expect: {
      buyer: 422,
      seller: 422,
      business_seller: 422,
      moderator: 422,
      support: 422,
      finance: 422,
      admin: 422,
      super_admin: 422,
    },
    denied: 401,
    run: (user) =>
      callRoute(changePassword, '/api/v1/auth/password', {
        method: 'POST',
        token: user?.accessToken ?? null,
        body: { currentPassword: user?.password ?? 'x', newPassword: 'short' },
      }),
  },
  {
    id: 'POST /api/v1/auth/totp/enroll',
    method: 'POST',
    path: '/api/v1/auth/totp/enroll',
    permission: 'account:manage_security',
    ownership: 'implicit',
    // Staff already have TOTP, so 409; everyone else enrols successfully.
    expect: {
      buyer: 200,
      seller: 200,
      business_seller: 200,
      moderator: 409,
      support: 409,
      finance: 409,
      admin: 409,
      super_admin: 409,
    },
    denied: 401,
    freshUser: 'plain',
    run: (user) =>
      callRoute(totpEnroll, '/api/v1/auth/totp/enroll', {
        method: 'POST',
        token: user?.accessToken ?? null,
      }),
  },
  {
    id: 'POST /api/v1/auth/totp/verify',
    method: 'POST',
    path: '/api/v1/auth/totp/verify',
    permission: 'account:manage_security',
    ownership: 'implicit',
    // 409 for staff (already enabled) and for everyone else (enrolment not
    // started). Both prove the authorization guard passed.
    expect: {
      buyer: 409,
      seller: 409,
      business_seller: 409,
      moderator: 409,
      support: 409,
      finance: 409,
      admin: 409,
      super_admin: 409,
    },
    denied: 401,
    freshUser: 'plain',
    run: (user) =>
      callRoute(totpVerify, '/api/v1/auth/totp/verify', {
        method: 'POST',
        token: user?.accessToken ?? null,
        body: { code: '000000' },
      }),
  },
  {
    id: 'POST /api/v1/listings',
    method: 'POST',
    path: '/api/v1/listings',
    permission: 'listing:create',
    ownership: 'implicit — seller is the token subject',
    // Holding the permission is not enough: a seller profile must exist, which
    // is why super_admin (who holds every permission) is refused at 403.
    expect: { seller: 201, business_seller: 201 },
    denied: 401,
    freshUser: 'with-seller-profile',
    run: (user) =>
      callRoute(createListing, '/api/v1/listings', {
        method: 'POST',
        token: user?.accessToken ?? null,
        body: {
          categorySlug: 'mobile-electronics',
          title: 'Matrix Test Listing',
          description: 'A description that is definitely long enough to validate.',
          priceMinor: '25000',
          countryCode: 'GB',
          attributes: { brand: 'Matrix', model: 'One' },
        },
      }),
  },
  {
    id: "PATCH /api/v1/listings/{id} (another seller's)",
    method: 'PATCH',
    path: '/api/v1/listings/{id}',
    permission: 'listing:update_own',
    ownership: 'explicit — owner only, NO override',
    expect: {
      buyer: 403,
      moderator: 403,
      support: 403,
      finance: 403,
      admin: 403,
      seller: 404,
      business_seller: 404,
      super_admin: 404,
    },
    denied: 401,
    run: async (user, actors) =>
      callRoute(patchListing, '/api/v1/listings/x', {
        method: 'PATCH',
        token: user?.accessToken ?? null,
        params: { id: await actors.makeForeignListing() },
        body: { title: 'Hijacked by the matrix' },
      }),
  },
  {
    id: "DELETE /api/v1/listings/{id} (another seller's)",
    method: 'DELETE',
    path: '/api/v1/listings/{id}',
    permission: 'listing:delete_own',
    ownership: 'explicit — owner only, NO override',
    expect: {
      buyer: 403,
      moderator: 403,
      support: 403,
      finance: 403,
      admin: 403,
      seller: 404,
      business_seller: 404,
      super_admin: 404,
    },
    denied: 401,
    run: async (user, actors) =>
      callRoute(deleteListing, '/api/v1/listings/x', {
        method: 'DELETE',
        token: user?.accessToken ?? null,
        params: { id: await actors.makeForeignListing() },
      }),
  },
  {
    id: "POST /api/v1/listings/{id}/status (remove another seller's)",
    method: 'POST',
    path: '/api/v1/listings/{id}/status',
    permission: 'listing:publish OR listing:moderate',
    ownership: 'owner, or listing:moderate',
    // Moderation is exactly what SHOULD reach another seller's listing, so
    // roles holding listing:moderate succeed where sellers get 404.
    expect: {
      buyer: 403,
      support: 403,
      finance: 403,
      seller: 404,
      business_seller: 404,
      moderator: 200,
      admin: 200,
      super_admin: 200,
    },
    denied: 401,
    run: async (user, actors) =>
      callRoute(listingTransition, '/api/v1/listings/x/status', {
        method: 'POST',
        token: user?.accessToken ?? null,
        params: { id: await actors.makeForeignListing('ACTIVE') },
        body: { to: 'REMOVED' },
      }),
  },
  {
    id: "POST /api/v1/listings/{id}/images (another seller's)",
    method: 'POST',
    path: '/api/v1/listings/{id}/images',
    permission: 'listing:update_own',
    ownership: 'explicit — owner only, NO override',
    expect: {
      buyer: 403,
      moderator: 403,
      support: 403,
      finance: 403,
      admin: 403,
      seller: 404,
      business_seller: 404,
      super_admin: 404,
    },
    denied: 401,
    run: async (user, actors) =>
      callRoute(startImageUpload, '/api/v1/listings/x/images', {
        method: 'POST',
        token: user?.accessToken ?? null,
        params: { id: await actors.makeForeignListing() },
        body: {},
      }),
  },
];

/** Printed at the end of the run so the report's matrix is generated, not typed. */
const observed: Array<{ route: string; role: RoleKey; expected: number; actual: number }> = [];

describe.skipIf(!hasDatabase)('authorization matrix', () => {
  const users = new Map<RoleKey, TestUser>();
  const actors: Actors = {
    foreignProfileId: '',
    foreignSessionId: '',
    makeForeignListing: async () => '',
  };

  beforeAll(async () => {
    await clearRateLimits();

    // A third party whose resources nobody in the matrix owns.
    const stranger = await createTestUser({ roles: ['seller'], withSellerProfile: true });
    actors.foreignProfileId = stranger.sellerProfileId!;
    const session = await import('@/infra/db/client').then((m) =>
      m.prisma.refreshToken.findFirstOrThrow({ where: { userId: stranger.id } }),
    );
    actors.foreignSessionId = session.id;
    actors.makeForeignListing = async (status = 'DRAFT') => {
      const listing = await createTestListing({
        ownerSellerProfileId: stranger.sellerProfileId!,
        status,
        withReadyImage: status === 'ACTIVE',
      });
      return listing.id;
    };

    for (const role of ROLES) {
      if (role === 'guest') continue;
      users.set(
        role,
        await createTestUser({
          roles: [role],
          twoFactor: STAFF.has(role),
          stepUp: true,
          withSellerProfile: role === 'seller' || role === 'business_seller',
        }),
      );
    }
  }, 180_000);

  afterAll(async () => {
    // Write the EXECUTED matrix to disk so the report is generated from real
    // results rather than transcribed by hand.
    const width = Math.max(...CASES.map((c) => c.id.length), 5);
    const header = `${'ROUTE'.padEnd(width)} | ${ROLES.map((r) => r.padStart(15)).join(' |')}`;
    const rows = CASES.map((routeCase) => {
      const cells = ROLES.map((role) => {
        const hit = observed.find((o) => o.route === routeCase.id && o.role === role);
        const cell = hit ? `${hit.actual}${hit.actual === hit.expected ? '' : ' MISMATCH'}` : '-';
        return cell.padStart(15);
      });
      return `${routeCase.id.padEnd(width)} | ${cells.join(' |')}`;
    });

    const requirements = CASES.map(
      (c) =>
        `${c.method.padEnd(6)} ${c.path.padEnd(40)} perm=${c.permission.padEnd(40)} ownership=${c.ownership}`,
    );

    const mismatches = observed.filter((o) => o.actual !== o.expected);
    const output = [
      'EXECUTED AUTHORIZATION MATRIX',
      `generated ${new Date().toISOString()}`,
      `cells: ${observed.length}   mismatches: ${mismatches.length}`,
      '',
      header,
      '-'.repeat(header.length),
      ...rows,
      '',
      'ROUTE REQUIREMENTS',
      ...requirements,
      '',
    ].join('\n');

    const dir = nodePath.join(process.cwd(), 'test-results');
    mkdirSync(dir, { recursive: true });
    writeFileSync(nodePath.join(dir, 'authorization-matrix.txt'), output, 'utf8');

    await disconnect();
  });

  for (const routeCase of CASES) {
    describe(routeCase.id, () => {
      for (const role of ROLES) {
        const expected = role === 'guest' ? routeCase.denied : (routeCase.expect[role] ?? 403);
        it(`${role} → ${expected}`, async () => {
          let user: TestUser | null = null;
          if (role !== 'guest') {
            user = routeCase.freshUser
              ? await createTestUser({
                  roles: [role],
                  twoFactor: STAFF.has(role),
                  stepUp: true,
                  withSellerProfile:
                    routeCase.freshUser === 'with-seller-profile' &&
                    (role === 'seller' || role === 'business_seller'),
                })
              : (users.get(role) ?? null);
          }
          const result = await routeCase.run(user, actors);
          observed.push({ route: routeCase.id, role, expected, actual: result.status });
          expect(result.status).toBe(expected);
        });
      }
    });
  }
});
