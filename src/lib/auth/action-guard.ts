import { cookies, headers } from 'next/headers';
import { checkCsrf } from '@/domain/auth/csrf';
import { checkAccess, type AccessRequirement, type Principal } from '@/domain/rbac/authorize';
import { STEP_UP_WINDOW_MS } from '@/domain/auth/step-up';
import { CSRF_COOKIE, CSRF_FIELD, verifyCsrfToken } from '@/infra/auth/session-cookies';
import { serverEnv } from '@/infra/env';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { prisma } from '@/infra/db/client';
import { readSessionState } from './server-session';

/**
 * The guard every Server Action runs before it touches anything.
 *
 * Server Actions are POST endpoints with a generated URL. They are reachable
 * by anything that can make a request, so "it's an action, not a route" is not
 * a security property. Each one therefore repeats the full check:
 *
 *   1. a valid session, read from the HttpOnly cookie — never from the form;
 *   2. the account is still ACTIVE, re-read from the database every time;
 *   3. a CSRF token that is bound to THIS session;
 *   4. the permissions the action declares, deny-by-default.
 *
 * Ownership is NOT checked here, because it depends on the resource. Each
 * action loads its resource and compares against `principal.userId`, which
 * comes from the token — never from a form field.
 */

export type ActionGuardResult =
  | { readonly ok: true; readonly principal: Principal; readonly familyId: string }
  | { readonly ok: false; readonly error: ActionError };

export type ActionError =
  | 'unauthenticated'
  | 'session_expired'
  | 'suspended'
  | 'csrf'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'unknown';

export async function requireActionAccess(
  form: FormData,
  requirement: AccessRequirement,
): Promise<ActionGuardResult> {
  const state = await readSessionState();

  if (state.kind === 'suspended') return { ok: false, error: 'suspended' };
  if (state.kind === 'refreshable') return { ok: false, error: 'session_expired' };
  if (state.kind !== 'authenticated') return { ok: false, error: 'unauthenticated' };

  const { principal, familyId } = state.session;

  const presented = form.get(CSRF_FIELD);
  const presentedToken = typeof presented === 'string' ? presented : null;
  const jar = await cookies();
  const incoming = await headers();

  const csrf = checkCsrf({
    // A Server Action is always a POST; naming it explicitly keeps this from
    // silently becoming a safe-method no-op if that ever changes.
    method: 'POST',
    presentedToken,
    cookieToken: jar.get(CSRF_COOKIE)?.value ?? null,
    signatureValid: verifyCsrfToken(presentedToken, familyId),
    origin: incoming.get('origin'),
    expectedOrigin: new URL(serverEnv().APP_URL).origin,
    secFetchSite: incoming.get('sec-fetch-site'),
  });

  if (!csrf.ok) {
    await tryWriteAuditLog(prisma, {
      action: 'authz.csrf_rejected',
      actorType: 'user',
      actorId: principal.userId,
      entityType: 'server_action',
      entityId: null,
      after: { reason: csrf.reason },
      ip: incoming.get('x-forwarded-for'),
      userAgent: incoming.get('user-agent'),
      correlationId: null,
    });
    return { ok: false, error: 'csrf' };
  }

  const decision = checkAccess(principal, requirement, {
    now: new Date(),
    stepUpWindowMs: STEP_UP_WINDOW_MS,
  });

  if (!decision.allowed) {
    await tryWriteAuditLog(prisma, {
      action: 'authz.denied',
      actorType: 'user',
      actorId: principal.userId,
      entityType: 'server_action',
      entityId: null,
      after: { reason: decision.reason, missing: decision.missing ?? null },
      ip: incoming.get('x-forwarded-for'),
      userAgent: incoming.get('user-agent'),
      correlationId: null,
    });
    return { ok: false, error: 'forbidden' };
  }

  return { ok: true, principal, familyId };
}
