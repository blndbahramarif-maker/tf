import { describe, expect, it } from 'vitest';
import { checkAccess, checkPermissions, type Principal } from '@/domain/rbac/authorize';
import { checkOwnership } from '@/domain/rbac/ownership';

const NOW = new Date('2026-09-11T12:00:00Z');
const CONTEXT = { now: NOW, stepUpWindowMs: 15 * 60_000 };

function principal(over: Partial<Principal> = {}): Principal {
  return {
    userId: 'user-1',
    roles: ['buyer'],
    permissions: new Set(['order:read_own']),
    emailVerified: true,
    twoFactorEnabled: false,
    requiresTwoFactor: false,
    stepUpAt: null,
    ...over,
  };
}

describe('deny by default', () => {
  it('denies an unauthenticated caller', () => {
    const decision = checkAccess(null, { all: ['order:read_own'] }, CONTEXT);
    expect(decision).toEqual({ allowed: false, reason: 'unauthenticated' });
  });

  it('DENIES when a route declares no requirement at all', () => {
    // The deny-by-default rule made literal: a route that forgets to say what
    // it needs must fail closed, never open.
    const decision = checkAccess(principal(), {}, CONTEXT);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('missing_permission');
  });

  it('denies an empty permission list', () => {
    expect(checkPermissions(principal(), { all: [], any: [] }).allowed).toBe(false);
  });
});

describe('permission checks', () => {
  it('requires every permission in `all`', () => {
    const p = principal({ permissions: new Set(['a', 'b']) });
    expect(checkPermissions(p, { all: ['a', 'b'] }).allowed).toBe(true);
    const decision = checkPermissions(p, { all: ['a', 'c'] });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.missing).toBe('c');
  });

  it('requires at least one permission in `any`', () => {
    const p = principal({ permissions: new Set(['b']) });
    expect(checkPermissions(p, { any: ['a', 'b'] }).allowed).toBe(true);
    expect(checkPermissions(p, { any: ['x', 'y'] }).allowed).toBe(false);
  });

  it('does not treat a permission it lacks as granted', () => {
    expect(checkPermissions(principal(), { all: ['payout:release'] }).allowed).toBe(false);
  });
});

describe('identity gates precede permission gates', () => {
  it('reports an unverified email rather than a missing permission', () => {
    // Telling someone "you lack permission X" when the real answer is "verify
    // your email" sends them chasing the wrong problem.
    const decision = checkAccess(
      principal({ emailVerified: false, permissions: new Set() }),
      { all: ['order:read_own'] },
      CONTEXT,
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('email_unverified');
  });

  it('allows routes that opt out of email verification', () => {
    const decision = checkAccess(
      principal({ emailVerified: false }),
      { all: ['order:read_own'], requireVerifiedEmail: false },
      CONTEXT,
    );
    expect(decision.allowed).toBe(true);
  });
});

describe('mandatory two-factor for staff', () => {
  it('refuses a staff principal without two-factor enrolled', () => {
    const decision = checkAccess(
      principal({
        roles: ['finance'],
        permissions: new Set(['payout:release']),
        requiresTwoFactor: true,
        twoFactorEnabled: false,
      }),
      { all: ['payout:release'] },
      CONTEXT,
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('two_factor_required');
  });

  it('allows the same principal once enrolled', () => {
    const decision = checkAccess(
      principal({
        roles: ['finance'],
        permissions: new Set(['payout:release']),
        requiresTwoFactor: true,
        twoFactorEnabled: true,
      }),
      { all: ['payout:release'] },
      CONTEXT,
    );
    expect(decision.allowed).toBe(true);
  });

  it('does not require two-factor of ordinary users', () => {
    expect(checkAccess(principal(), { all: ['order:read_own'] }, CONTEXT).allowed).toBe(true);
  });
});

describe('step-up requirement', () => {
  it('denies when the session has never stepped up', () => {
    const decision = checkAccess(
      principal(),
      { all: ['order:read_own'], requireStepUp: true },
      CONTEXT,
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('step_up_required');
  });

  it('allows a recent step-up', () => {
    const decision = checkAccess(
      principal({ stepUpAt: new Date(NOW.getTime() - 60_000) }),
      { all: ['order:read_own'], requireStepUp: true },
      CONTEXT,
    );
    expect(decision.allowed).toBe(true);
  });

  it('denies a stale step-up', () => {
    const decision = checkAccess(
      principal({ stepUpAt: new Date(NOW.getTime() - 16 * 60_000) }),
      { all: ['order:read_own'], requireStepUp: true },
      CONTEXT,
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('step_up_required');
  });

  it('denies a step-up timestamp from the future', () => {
    const decision = checkAccess(
      principal({ stepUpAt: new Date(NOW.getTime() + 60_000) }),
      { all: ['order:read_own'], requireStepUp: true },
      CONTEXT,
    );
    expect(decision.allowed).toBe(false);
  });
});

describe('ownership', () => {
  const owner = principal({ userId: 'owner-1' });

  it('allows the owner', () => {
    expect(checkOwnership(owner, { ownerUserId: 'owner-1' }).allowed).toBe(true);
  });

  it('denies a different user', () => {
    const decision = checkOwnership(owner, { ownerUserId: 'someone-else' });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('not_owner');
  });

  it('gives a MISSING resource the same verdict as someone else’s', () => {
    // Both map to 404, so the endpoint cannot be used to discover which ids
    // are real.
    const missing = checkOwnership(owner, null);
    const foreign = checkOwnership(owner, { ownerUserId: 'someone-else' });
    expect(missing).toEqual(foreign);
  });

  it('allows an explicit override permission', () => {
    const staff = principal({ userId: 'staff-1', permissions: new Set(['user:read']) });
    expect(
      checkOwnership(staff, { ownerUserId: 'owner-1' }, { overridePermission: 'user:read' })
        .allowed,
    ).toBe(true);
  });

  it('ignores an override the principal does not hold', () => {
    expect(
      checkOwnership(owner, { ownerUserId: 'other' }, { overridePermission: 'user:read' }).allowed,
    ).toBe(false);
  });

  it('requires the override to be declared by the route', () => {
    // Holding `user:read` must not grant access where the route did not offer
    // an override — otherwise support staff could silently write anything.
    const staff = principal({ userId: 'staff-1', permissions: new Set(['user:read']) });
    expect(checkOwnership(staff, { ownerUserId: 'owner-1' }).allowed).toBe(false);
  });
});
