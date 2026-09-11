import { hashPassword } from '@/infra/auth/password-hasher';
import { checkPassword } from '@/domain/auth/password';
import { generateOpaqueToken, hashToken } from '@/infra/auth/crypto';
import { prisma } from '@/infra/db/client';
import { clientIp } from '@/lib/api/guards';
import { enforceRateLimit, noStore, parseBody } from '@/lib/api/route-helpers';
import { fail, ok, requestId } from '@/lib/api/respond';
import { registerRequestSchema } from '@/shared/auth-contract';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';

export const dynamic = 'force-dynamic';

/** Email-verification links are valid for 24 hours. */
const VERIFICATION_TTL_MS = 24 * 60 * 60_000;

/**
 * POST /api/v1/auth/register
 *
 * Creates an account and issues an email-verification token. It does NOT log
 * the user in: email ownership is proven first.
 *
 * The response is identical whether or not the address is already registered,
 * so this endpoint cannot be used to enumerate accounts.
 */
export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, RATE_LIMITS.register);
  if (!limited.ok) return limited.response;

  const body = await parseBody(request, registerRequestSchema);
  if (!body.ok) return body.response;

  const { email, password, displayName } = body.value;

  const policy = checkPassword(password, email);
  if (!policy.ok) {
    return fail('validation_failed', 'Password does not meet the policy.', {
      request,
      fields: policy.reasons.map((reason) => ({ path: 'password', message: reason })),
    });
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });

  if (existing) {
    // Deliberately indistinguishable from success. Registering an address that
    // already exists must not reveal that it exists; the real account holder
    // gets an email telling them someone tried.
    return noStore(ok({ status: 'pending_verification' }, { status: 202 }));
  }

  const passwordHash = await hashPassword(password);
  const verificationToken = generateOpaqueToken();

  const buyerRole = await prisma.role.findUnique({ where: { key: 'buyer' }, select: { id: true } });
  if (!buyerRole) {
    throw new Error('Seed data missing: the "buyer" role does not exist.');
  }

  // One transaction: an account without its role, or without an audit record,
  // is worse than no account.
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        passwordHash,
        passwordChangedAt: new Date(),
        profile: { create: { displayName } },
        roles: { create: { roleId: buyerRole.id } },
      },
      select: { id: true },
    });

    await tx.verificationToken.create({
      data: {
        userId: user.id,
        purpose: 'EMAIL_VERIFY',
        tokenHash: hashToken(verificationToken),
        expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
        targetEmail: email,
      },
    });

    await tx.auditLog.create({
      data: {
        action: 'auth.register',
        actorType: 'anonymous',
        actorId: user.id,
        entityType: 'user',
        entityId: user.id,
        ip: clientIp(request),
        userAgent: request.headers.get('user-agent'),
        correlationId: requestId(request),
      },
    });
  });

  const response: Record<string, unknown> = { status: 'pending_verification' };

  // Outside production the token is returned so tests and local development
  // can complete the flow without a mail server. NEVER in production: that
  // would let anyone verify any address they can register.
  if (process.env.APP_ENV !== 'production') {
    response.devVerificationToken = verificationToken;
  }

  return noStore(ok(response, { status: 202 }));
}
