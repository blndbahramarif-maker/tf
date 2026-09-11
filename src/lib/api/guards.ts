import type { NextResponse } from 'next/server';
import {
  checkAccess,
  type AccessRequirement,
  type DenialReason,
  type Principal,
} from '@/domain/rbac/authorize';
import {
  checkOwnership,
  type OwnedResource,
  type OwnershipRequirement,
} from '@/domain/rbac/ownership';
import { STEP_UP_WINDOW_MS } from '@/domain/auth/step-up';
import { resolvePrincipal, type ResolvedPrincipal } from './principal';
import { enforceCsrf } from './csrf-guard';
import { fail, requestId } from './respond';
import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';

/**
 * Route guards.
 *
 * Every protected route runs the same two checks, in this order:
 *
 *   1. checkAccess    — authenticated, verified, two-factor where required,
 *                       holds the permission, stepped up where required.
 *   2. requireOwner   — this particular resource belongs to the caller, or
 *                       they hold an explicit override permission.
 *
 * Authorization is enforced HERE, server-side, before any data is read or
 * written. Nothing about the decision comes from the client beyond the bearer
 * token itself.
 */

/**
 * How each denial is reported.
 *
 * `not_owner` maps to 404, NOT 403. Returning 403 would confirm the resource
 * exists, turning the endpoint into an oracle for enumerating other people's
 * ids. A non-owner gets exactly the response they would get for a made-up id.
 *
 * Every other denial maps to 403, because the resource's existence is not the
 * secret — the caller's lack of privilege is the point.
 */
const STATUS_BY_REASON: Record<DenialReason, number> = {
  unauthenticated: 401,
  email_unverified: 403,
  two_factor_required: 403,
  missing_permission: 403,
  not_owner: 404,
  step_up_required: 403,
  account_suspended: 403,
};

const MESSAGE_BY_REASON: Record<DenialReason, string> = {
  unauthenticated: 'Authentication required.',
  email_unverified: 'Verify your email address before using this feature.',
  two_factor_required: 'Two-factor authentication must be enabled for this role.',
  missing_permission: 'You do not have permission to perform this action.',
  not_owner: 'Not found.',
  step_up_required: 'Re-authenticate to perform this action.',
  account_suspended: 'This account is not active.',
};

export type GuardResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly response: NextResponse };

function denialResponse(request: Request, reason: DenialReason, missing?: string): NextResponse {
  const status = STATUS_BY_REASON[reason];
  const code =
    reason === 'not_owner'
      ? 'not_found'
      : reason === 'unauthenticated'
        ? 'unauthenticated'
        : 'forbidden';

  const response = fail(code, MESSAGE_BY_REASON[reason], { request, status });
  // The specific missing permission is useful to a developer and harmless to
  // an attacker who already knows they were refused; it never appears for
  // not_owner, where silence is the point.
  if (missing !== undefined && reason === 'missing_permission') {
    response.headers.set('x-denied-permission', missing);
  }
  return response;
}

/**
 * Authenticates and authorizes a request.
 *
 * `requirement` MUST declare at least one permission (`all` or `any`).
 * An empty requirement is denied by `checkAccess`, so a route that forgets to
 * say what it needs fails closed.
 */
export async function requireAccess(
  request: Request,
  requirement: AccessRequirement,
  options: { now?: Date; csrfFormToken?: string | null } = {},
): Promise<GuardResult<ResolvedPrincipal>> {
  const now = options.now ?? new Date();
  const resolution = await resolvePrincipal(request);

  if (!resolution.ok) {
    const reason: DenialReason =
      resolution.reason === 'suspended' ? 'account_suspended' : 'unauthenticated';
    return { ok: false, response: denialResponse(request, reason) };
  }

  /*
   * CSRF is enforced HERE rather than per route, for the same reason
   * permissions are: a route that forgets to ask must fail closed, not open.
   * It is a no-op for bearer callers and for safe methods, so API clients are
   * unaffected — but no cookie-authenticated mutation can reach a handler
   * without a valid token, whatever the handler remembered to do.
   */
  const csrf = enforceCsrf(request, {
    transport: resolution.value.transport,
    familyId: resolution.value.familyId,
    formToken: options.csrfFormToken,
  });
  if (!csrf.ok) {
    await tryWriteAuditLog(prisma, {
      action: 'authz.csrf_rejected',
      actorType: 'user',
      actorId: resolution.value.principal.userId,
      entityType: 'route',
      entityId: null,
      after: { method: request.method, path: new URL(request.url).pathname },
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      correlationId: requestId(request),
    });
    return { ok: false, response: csrf.response };
  }

  const decision = checkAccess(resolution.value.principal, requirement, {
    now,
    stepUpWindowMs: STEP_UP_WINDOW_MS,
  });

  if (!decision.allowed) {
    await tryWriteAuditLog(prisma, {
      action: 'authz.denied',
      actorType: 'user',
      actorId: resolution.value.principal.userId,
      entityType: 'route',
      entityId: null,
      after: {
        reason: decision.reason,
        missing: decision.missing ?? null,
        method: request.method,
        path: new URL(request.url).pathname,
      },
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      correlationId: requestId(request),
    });

    return { ok: false, response: denialResponse(request, decision.reason, decision.missing) };
  }

  return { ok: true, value: resolution.value };
}

/**
 * Verifies that a resource belongs to the principal.
 *
 * Takes a LOADER rather than a resource, so the resource is fetched exactly
 * once and the caller cannot accidentally act on it before the check. Both
 * "does not exist" and "belongs to someone else" produce an identical 404.
 */
export async function requireOwner<T extends OwnedResource>(
  request: Request,
  principal: Principal,
  load: () => Promise<T | null>,
  requirement: OwnershipRequirement = {},
): Promise<GuardResult<T>> {
  const resource = await load();
  const decision = checkOwnership(principal, resource, requirement);

  if (!decision.allowed) {
    return { ok: false, response: denialResponse(request, decision.reason) };
  }

  // checkOwnership only returns allowed for a non-null resource.
  return { ok: true, value: resource as T };
}

/**
 * The single 404 used for "does not exist" and "not yours" alike.
 *
 * Every caller must go through this so the two remain byte-identical; a
 * divergence would re-open the existence oracle that the ownership rule
 * exists to close.
 */
export function notFound(request: Request): NextResponse {
  return denialResponse(request, 'not_owner');
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates an id from the URL before it reaches the database.
 *
 * Without this, a non-UUID path segment makes Postgres reject the query and
 * the handler returns a 500 carrying a database error message — both a
 * robustness bug and a disclosure. An unparseable id simply cannot name a
 * resource, so it is treated as not-found.
 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;
  return request.headers.get('x-real-ip');
}
