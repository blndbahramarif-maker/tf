import { prisma } from '@/infra/db/client';
import { requireAccess } from '@/lib/api/guards';
import { noStore, parseBody } from '@/lib/api/route-helpers';
import { fail, ok } from '@/lib/api/respond';
import { updateMeRequestSchema } from '@/shared/auth-contract';

export const dynamic = 'force-dynamic';

/**
 * GET/PATCH /api/v1/me
 *
 * The current user, resolved from the bearer token ONLY. There is deliberately
 * no `/users/{id}` self-read: an endpoint that takes an id is an endpoint
 * someone will eventually pass someone else's id to.
 */
export async function GET(request: Request) {
  const access = await requireAccess(request, {
    all: ['account:read_self'],
    requireVerifiedEmail: false,
  });
  if (!access.ok) return access.response;

  const user = await prisma.user.findUnique({
    where: { id: access.value.principal.userId },
    select: {
      id: true,
      email: true,
      emailVerifiedAt: true,
      preferredLocale: true,
      timezone: true,
      status: true,
      twoFactorEnabledAt: true,
      createdAt: true,
      profile: { select: { displayName: true, avatarUrl: true } },
      sellerProfile: { select: { id: true, slug: true, verificationStatus: true } },
    },
  });

  if (!user) return fail('not_found', 'Not found.', { request });

  // Explicit allowlist. Adding a column to `users` must never be able to leak
  // it through this response.
  return noStore(
    ok({
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      displayName: user.profile?.displayName ?? null,
      avatarUrl: user.profile?.avatarUrl ?? null,
      preferredLocale: user.preferredLocale,
      timezone: user.timezone,
      status: user.status,
      twoFactorEnabled: user.twoFactorEnabledAt !== null,
      roles: access.value.principal.roles,
      permissions: [...access.value.principal.permissions],
      sellerProfile: user.sellerProfile,
      createdAt: user.createdAt.toISOString(),
    }),
  );
}

export async function PATCH(request: Request) {
  const access = await requireAccess(request, { all: ['account:update_self'] });
  if (!access.ok) return access.response;

  const body = await parseBody(request, updateMeRequestSchema);
  if (!body.ok) return body.response;

  const { displayName, preferredLocale, timezone } = body.value;

  await prisma.$transaction(async (tx) => {
    if (preferredLocale !== undefined || timezone !== undefined) {
      await tx.user.update({
        where: { id: access.value.principal.userId },
        data: {
          ...(preferredLocale === undefined ? {} : { preferredLocale }),
          ...(timezone === undefined ? {} : { timezone }),
        },
      });
    }
    if (displayName !== undefined) {
      await tx.profile.update({
        where: { userId: access.value.principal.userId },
        data: { displayName },
      });
    }
  });

  return noStore(ok({ status: 'updated' }));
}
