'use server';

import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import { requireActionAccess } from '@/lib/auth/action-guard';
import { listingReportSchema } from '@/shared/listing-contract';
import type { ActionState } from '../dashboard/action-state';

/**
 * Reporting a listing from the public listing page.
 *
 * A Server Action is a public POST endpoint, so this repeats the full guard
 * and then re-reads the listing from the database. The listing id arrives in a
 * form field, which makes it a claim: it is used only as a LOOKUP KEY, and the
 * lookup is restricted to listings the reporter could already see.
 *
 * **Reporting does not hide anything.** It records a claim and marks the
 * listing for a human. Only a moderator changes what the public sees.
 */
export async function reportListingAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireActionAccess(form, { all: ['report:create'] });
  if (!guard.ok) return { error: guard.error };

  const listingId = typeof form.get('listingId') === 'string' ? String(form.get('listingId')) : '';
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(listingId)
  ) {
    // An unparseable id makes Postgres raise, and it cannot name a listing.
    return { error: 'not_found' };
  }

  const parsed = listingReportSchema.safeParse({
    reasonCode: form.get('reasonCode'),
    details: form.get('details') || undefined,
  });
  if (!parsed.success) return { error: 'validation', fieldErrors: { reasonCode: 'invalid' } };

  // Only a listing this person could already see. Anything else is 'not_found',
  // so this cannot be used to discover other people's drafts.
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, status: { in: ['ACTIVE', 'PENDING_REVIEW'] }, deletedAt: null },
    select: { id: true },
  });
  if (listing === null) return { error: 'not_found' };

  // One OPEN report per person per listing, so a single reporter cannot
  // manufacture the appearance of a pile-on.
  const existing = await prisma.report.findFirst({
    where: {
      reporterId: guard.principal.userId,
      targetType: 'LISTING',
      targetId: listing.id,
      status: 'OPEN',
    },
    select: { id: true },
  });

  if (existing === null) {
    const created = await prisma.report.create({
      data: {
        reporterId: guard.principal.userId,
        targetType: 'LISTING',
        targetId: listing.id,
        reasonCode: parsed.data.reasonCode,
        details: parsed.data.details ?? null,
        status: 'OPEN',
      },
      select: { id: true },
    });

    await tryWriteAuditLog(prisma, {
      action: 'listing.reported',
      actorType: 'user',
      actorId: guard.principal.userId,
      entityType: 'listing',
      entityId: listing.id,
      // The reason code, never the free text: `details` can name a third
      // party, and the audit log is read more widely than the report queue.
      after: { reportId: created.id, reasonCode: parsed.data.reasonCode },
    });
  }

  // The same answer either way — telling a repeat reporter that we already
  // have their report only invites them to try from another account.
  return { error: null, ok: true };
}
