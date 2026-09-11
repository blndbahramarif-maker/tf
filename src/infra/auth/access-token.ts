import { errors, jwtVerify, SignJWT } from 'jose';
import { ACCESS_TOKEN_TTL_MS } from '@/domain/auth/refresh-tokens';

/**
 * Access tokens: signed JWTs, 15 minutes.
 *
 * Short-lived because they are NOT checked against the database on every
 * request — revocation happens at refresh. Fifteen minutes is the maximum
 * window in which a stolen access token remains useful.
 *
 * The step-up timestamp travels as a claim so sensitive routes can check
 * freshness without a database round trip. Step-up therefore mints a NEW
 * access token rather than mutating the current one.
 */

const ISSUER = 'kurdora';
const AUDIENCE = 'kurdora-api';

export interface AccessTokenClaims {
  readonly sub: string;
  /** Refresh-token family, so a session can be identified and revoked. */
  readonly fam: string;
  readonly roles: readonly string[];
  readonly perms: readonly string[];
  readonly ev: boolean;
  readonly tfa: boolean;
  /** Epoch seconds of the last step-up, when one has occurred. */
  readonly sua?: number;
}

function signingKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET is not set, or is shorter than 32 characters.');
  }
  return new TextEncoder().encode(secret);
}

export async function issueAccessToken(
  claims: AccessTokenClaims,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);

  const token = await new SignJWT({
    fam: claims.fam,
    roles: [...claims.roles],
    perms: [...claims.perms],
    ev: claims.ev,
    tfa: claims.tfa,
    ...(claims.sua === undefined ? {} : { sua: claims.sua }),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(signingKey());

  return { token, expiresAt };
}

export type AccessTokenVerification =
  | { readonly ok: true; readonly claims: AccessTokenClaims }
  | { readonly ok: false; readonly reason: 'expired' | 'invalid' };

export async function verifyAccessToken(token: string): Promise<AccessTokenVerification> {
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });

    if (typeof payload.sub !== 'string' || typeof payload.fam !== 'string') {
      return { ok: false, reason: 'invalid' };
    }

    return {
      ok: true,
      claims: {
        sub: payload.sub,
        fam: payload.fam,
        roles: Array.isArray(payload.roles) ? (payload.roles as string[]) : [],
        perms: Array.isArray(payload.perms) ? (payload.perms as string[]) : [],
        ev: payload.ev === true,
        tfa: payload.tfa === true,
        ...(typeof payload.sua === 'number' ? { sua: payload.sua } : {}),
      },
    };
  } catch (error) {
    if (error instanceof errors.JWTExpired) return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'invalid' };
  }
}
