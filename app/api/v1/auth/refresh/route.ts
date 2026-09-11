import { rotateSession } from '@/infra/auth/session-service';
import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp } from '@/lib/api/guards';
import { enforceRateLimit, noStore, parseBody } from '@/lib/api/route-helpers';
import { fail, ok, requestId } from '@/lib/api/respond';
import { refreshRequestSchema } from '@/shared/auth-contract';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/auth/refresh
 *
 * Rotates the refresh token. The presented token is revoked and a new one
 * issued, so each token works exactly once.
 *
 * Presenting an already-used token revokes the ENTIRE family: every session
 * from that login dies, the attacker's and the real user's alike. We cannot
 * tell which is which, so both must log in again.
 */
export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, RATE_LIMITS.refresh);
  if (!limited.ok) return limited.response;

  const body = await parseBody(request, refreshRequestSchema);
  if (!body.ok) return body.response;

  const result = await rotateSession(body.value.refreshToken, {
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
  });

  if (result.kind === 'reuse_detected') {
    await tryWriteAuditLog(prisma, {
      action: 'auth.token_reuse_detected',
      actorType: 'system',
      actorId: result.userId,
      entityType: 'refresh_token_family',
      entityId: null,
      after: { familyId: result.familyId, outcome: 'family_revoked' },
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      correlationId: requestId(request),
    });

    // Same generic response as any other rejection. Telling the caller "reuse
    // detected" would confirm to an attacker that they hold a real token.
    return fail('unauthenticated', 'Session is no longer valid. Sign in again.', {
      request,
      status: 401,
    });
  }

  if (result.kind === 'rejected') {
    return fail('unauthenticated', 'Session is no longer valid. Sign in again.', {
      request,
      status: 401,
    });
  }

  await tryWriteAuditLog(prisma, {
    action: 'auth.token_refreshed',
    actorType: 'user',
    entityType: 'refresh_token_family',
    entityId: null,
    after: { familyId: result.session.familyId },
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  return noStore(
    ok({
      accessToken: result.session.accessToken,
      accessTokenExpiresAt: result.session.accessTokenExpiresAt.toISOString(),
      refreshToken: result.session.refreshToken,
      refreshTokenExpiresAt: result.session.refreshTokenExpiresAt.toISOString(),
      tokenType: 'Bearer',
    }),
  );
}
