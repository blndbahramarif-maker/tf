import { NextResponse } from 'next/server';
import { rotateSession } from '@/infra/auth/session-service';
import {
  REFRESH_COOKIE,
  clearSessionCookies,
  readCookie,
  setSessionCookies,
} from '@/infra/auth/session-cookies';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { prisma } from '@/infra/db/client';
import { clientIp } from '@/lib/api/guards';
import { requestId } from '@/lib/api/respond';
import { serverEnv } from '@/infra/env';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/auth/session — browser silent refresh.
 *
 * A Server Component can read cookies but cannot write them, so a page whose
 * access cookie has expired cannot rotate the session itself. It redirects
 * here instead; this handler rotates, writes the new cookies, and sends the
 * reader back to where they were going.
 *
 * Why a GET is acceptable for something that changes state:
 *
 *   The refresh cookie is `SameSite=Strict` and scoped to `/api/v1/auth`, so a
 *   cross-site request cannot carry it at all — the browser simply will not
 *   attach it. A CSRF attempt against this endpoint arrives with no refresh
 *   token and rotates nothing. There is also nothing to steal: the response is
 *   a redirect with `Set-Cookie`, and an attacker's page can read neither.
 *
 *   The worst an attacker achieves by forcing a same-site navigation here is
 *   making the victim's session rotate, which is a no-op for the victim.
 *
 * Reuse detection is UNCHANGED: this calls the same `rotateSession` the API
 * uses, so presenting an already-rotated token still revokes the whole family.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const target = safeNext(url.searchParams.get('next'));

  const presented = readCookie(request, REFRESH_COOKIE);
  if (!presented) {
    return clearSessionCookies(NextResponse.redirect(new URL(target, url.origin), 303));
  }

  const result = await rotateSession(presented, {
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
  });

  if (result.kind === 'reuse_detected') {
    await tryWriteAuditLog(prisma, {
      action: 'auth.token_reuse_detected',
      actorType: 'user',
      actorId: result.userId,
      entityType: 'refresh_token_family',
      entityId: null,
      after: { familyId: result.familyId, via: 'browser_session_refresh' },
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      correlationId: requestId(request),
    });
    // The family is already revoked by rotateSession. Clear the browser too,
    // so the victim lands on a signed-out state rather than a redirect loop.
    return clearSessionCookies(NextResponse.redirect(new URL(target, url.origin), 303));
  }

  if (result.kind !== 'rotated') {
    return clearSessionCookies(NextResponse.redirect(new URL(target, url.origin), 303));
  }

  await tryWriteAuditLog(prisma, {
    action: 'auth.token_refreshed',
    actorType: 'user',
    actorId: null,
    entityType: 'refresh_token_family',
    entityId: null,
    after: { familyId: result.session.familyId, via: 'browser_session_refresh' },
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  return setSessionCookies(NextResponse.redirect(new URL(target, url.origin), 303), result.session);
}

/**
 * Constrains the post-refresh redirect to our own site.
 *
 * `next` comes from the URL, so it is attacker-controlled. Without this the
 * endpoint is an open redirect that a phishing page can point anywhere —
 * and one that hands the victim a freshly rotated session on the way out.
 *
 * A protocol-relative `//evil.test` is rejected as well as an absolute URL:
 * the browser reads `//host` as "same scheme, that host".
 */
export function safeNext(value: string | null): string {
  const fallback = '/';
  if (!value) return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//')) return fallback;
  // A backslash is normalised to a forward slash by some browsers, so `/\evil`
  // would escape the origin.
  if (value.includes('\\')) return fallback;

  try {
    // Resolve against our own origin and confirm it stays there.
    const resolved = new URL(value, serverEnv().APP_URL);
    if (resolved.origin !== new URL(serverEnv().APP_URL).origin) return fallback;
    return `${resolved.pathname}${resolved.search}`;
  } catch {
    return fallback;
  }
}
