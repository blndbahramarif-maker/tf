import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { clientIp, isUuid, notFound, requireAccess } from '@/lib/api/guards';
import { enforceRateLimit, parseBody } from '@/lib/api/route-helpers';
import { ok, requestId } from '@/lib/api/respond';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';
import { listingReportSchema } from '@/shared/listing-contract';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/listings/{id}/report — report a listing.
 *
 * Kurdora does not inspect goods and does not meet sellers. The people who see
 * a prohibited or fraudulent listing first are the people looking at it, so
 * this is the most valuable safety control the platform has — more so than
 * keyword screening, which only knows the words somebody thought to add.
 *
 * **Reporting does NOT hide the listing.** A report is one person's claim, and
 * letting a claim take a competitor's listing down would build a censorship
 * button with no cost to pull. It records the report and marks the listing for
 * a human. Only a moderator changes what the public sees.
 *
 * Any signed-in user may report ANY visible listing — this is deliberately not
 * ownership-scoped, because the reporter is by definition not the owner.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAccess(request, { all: ['report:create'] });
  if (!access.ok) return access.response;

  const reporterId = access.value.principal.userId;

  // Keyed on the ACCOUNT. Mass-reporting is an attack on a seller, and a limit
  // that followed the IP would give a script a fresh allowance per address.
  const limited = await enforceRateLimit(request, RATE_LIMITS.writeApi, reporterId, {
    keyBy: 'subject',
  });
  if (!limited.ok) return limited.response;

  const { id } = await context.params;
  if (!isUuid(id)) return notFound(request);

  /*
   * Only a listing the reporter could actually SEE. Reporting a draft or a
   * removed listing would otherwise confirm that the id exists and turn this
   * endpoint into an enumeration oracle for other people's unpublished work.
   */
  const listing = await prisma.listing.findFirst({
    where: { id, status: { in: ['ACTIVE', 'PENDING_REVIEW'] }, deletedAt: null },
    select: { id: true, sellerProfile: { select: { userId: true } } },
  });
  if (listing === null) return notFound(request);

  const body = await parseBody(request, listingReportSchema);
  if (!body.ok) return body.response;

  /*
   * One OPEN report per person per listing. Without it, a single reporter can
   * manufacture the appearance of a pile-on, which is exactly the signal a
   * moderator would reasonably act on. A second report from the SAME person is
   * absorbed silently — telling them "you already reported this" only invites
   * them to try from another account.
   */
  const existing = await prisma.report.findFirst({
    where: { reporterId, targetType: 'LISTING', targetId: id, status: 'OPEN' },
    select: { id: true },
  });

  const reportId =
    existing?.id ??
    (
      await prisma.report.create({
        data: {
          reporterId,
          targetType: 'LISTING',
          targetId: id,
          reasonCode: body.value.reasonCode,
          details: body.value.details ?? null,
          status: 'OPEN',
        },
        select: { id: true },
      })
    ).id;

  if (existing === null) {
    await tryWriteAuditLog(prisma, {
      action: 'listing.reported',
      actorType: 'user',
      actorId: reporterId,
      entityType: 'listing',
      entityId: id,
      // The reason, never the reporter's free text: `details` can name a third
      // party, and an audit table is read far more widely than a report queue.
      after: { reportId, reasonCode: body.value.reasonCode },
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      correlationId: requestId(request),
    });
  }

  // 202: received, and a human will look. Deliberately NOT a promise that
  // anything will be removed.
  return ok({ reportId, status: 'received' }, { status: 202 });
}
