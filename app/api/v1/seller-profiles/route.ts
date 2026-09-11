import { randomBytes } from 'node:crypto';
import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp, requireAccess } from '@/lib/api/guards';
import { enforceRateLimit, noStore, parseBody } from '@/lib/api/route-helpers';
import { fail, ok, requestId } from '@/lib/api/respond';
import { createSellerProfileRequestSchema } from '@/shared/auth-contract';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/seller-profiles
 *
 * Creates the caller's seller profile. The owner is taken from the token — the
 * body has no `userId` field, so there is nothing to tamper with.
 */
export async function POST(request: Request) {
  const access = await requireAccess(request, { all: ['seller:create_profile'] });
  if (!access.ok) return access.response;

  const limited = await enforceRateLimit(
    request,
    RATE_LIMITS.writeApi,
    access.value.principal.userId,
  );
  if (!limited.ok) return limited.response;

  const body = await parseBody(request, createSellerProfileRequestSchema);
  if (!body.ok) return body.response;

  const existing = await prisma.sellerProfile.findUnique({
    where: { userId: access.value.principal.userId },
    select: { id: true },
  });
  if (existing) {
    return fail('conflict', 'This account already has a seller profile.', { request });
  }

  const country = await prisma.country.findUnique({
    where: { code: body.value.countryCode },
    select: { id: true, isActive: true },
  });
  if (!country || !country.isActive) {
    return fail('validation_failed', 'Selling is not available in that country yet.', {
      request,
      fields: [{ path: 'countryCode', message: 'unsupported_country' }],
    });
  }

  const slugBase =
    body.value.displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'seller';

  const sellerRole = await prisma.role.findUnique({
    where: { key: 'seller' },
    select: { id: true },
  });
  if (!sellerRole) throw new Error('Seed data missing: the "seller" role does not exist.');

  // Slug suffixes are random, NOT derived from the user id.
  //
  // A UUIDv7's leading hex characters are the high bits of a millisecond
  // timestamp, so every account created within the same ~65-second window
  // shares them — deriving a slug from them collided in testing and would
  // have 500'd in production for two similarly-named sellers registering a
  // minute apart. Random suffix plus a bounded retry instead.
  const created = await createWithUniqueSlug(
    async (slug) =>
      prisma.$transaction(async (tx) => {
        const profile = await tx.sellerProfile.create({
          data: {
            userId: access.value.principal.userId,
            sellerType: body.value.sellerType,
            slug,
            displayName: body.value.displayName,
            about: body.value.about ?? null,
            countryId: country.id,
          },
          select: { id: true, slug: true, displayName: true, verificationStatus: true },
        });

        await tx.userRole.upsert({
          where: {
            userId_roleId: { userId: access.value.principal.userId, roleId: sellerRole.id },
          },
          create: { userId: access.value.principal.userId, roleId: sellerRole.id },
          update: {},
        });

        return profile;
      }),
    slugBase,
  );

  await tryWriteAuditLog(prisma, {
    action: 'seller_profile.created',
    actorType: 'user',
    actorId: access.value.principal.userId,
    entityType: 'seller_profile',
    entityId: created.id,
    after: { slug: created.slug, displayName: created.displayName },
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    correlationId: requestId(request),
  });

  // The new `seller` role only takes effect on the next token, so say so
  // rather than letting the client wonder why permissions have not changed.
  return noStore(
    ok(
      { ...created, note: 'Refresh your session to pick up seller permissions.' },
      { status: 201 },
    ),
  );
}

/**
 * Creates a record with a random slug suffix, retrying on collision.
 *
 * The database's unique index is the arbiter; a check-then-insert would race.
 */
async function createWithUniqueSlug<T>(
  create: (slug: string) => Promise<T>,
  base: string,
  attempts = 5,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const slug = `${base}-${randomBytes(4).toString('hex')}`;
    try {
      return await create(slug);
    } catch (error) {
      // Checked structurally rather than with `instanceof`: error classes do
      // not reliably survive module boundaries once bundled, and a silently
      // failing instanceof here would turn a retryable collision into a 500.
      const known = error as { code?: unknown; meta?: { target?: unknown } } | null;
      const isSlugCollision =
        known?.code === 'P2002' && String(known.meta?.target ?? '').includes('slug');

      if (!isSlugCollision) throw error;
      lastError = error;
    }
  }

  throw lastError;
}
