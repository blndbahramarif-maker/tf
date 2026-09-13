import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as reportListing } from '../../app/api/v1/listings/[id]/report/route';
import { POST as listingTransition } from '../../app/api/v1/listings/[id]/status/route';
import { prisma } from '@/infra/db/client';
import {
  callRoute,
  clearRateLimits,
  createTestListing,
  createTestUser,
  orphanId,
  type TestUser,
} from './harness';
import { hasDatabase } from './harness';

/**
 * The platform safety layer, through the real routes and the real database.
 *
 * Kurdora is a CONTACT-ONLY marketplace: it never sees the goods and never
 * meets the seller. Everything it can actually do about a dangerous listing is
 * here — screen the text, let people report it, let a moderator act, and keep
 * a record of who did what.
 *
 * None of it is a guarantee, and the tests are written so that nothing in this
 * file could be read as claiming otherwise.
 */

describe.skipIf(!hasDatabase)('platform safety', () => {
  let seller: TestUser;
  let reporter: TestUser;
  let moderator: TestUser;

  beforeAll(async () => {
    seller = await createTestUser({ roles: ['seller'], withSellerProfile: true, stepUp: true });
    reporter = await createTestUser({ roles: ['buyer'], stepUp: true });
    moderator = await createTestUser({
      roles: ['moderator'],
      twoFactor: true,
      stepUp: true,
    });
  });

  beforeEach(async () => {
    await clearRateLimits(seller.id, reporter.id, moderator.id);
  });

  async function activeListing(title = 'Perfectly ordinary jacket') {
    return createTestListing({
      ownerSellerProfileId: seller.sellerProfileId!,
      status: 'ACTIVE',
      title,
    });
  }

  describe('reporting a listing', () => {
    it('records a report without hiding the listing', async () => {
      const listing = await activeListing();

      const result = await callRoute(reportListing, `/api/v1/listings/${listing.id}/report`, {
        method: 'POST',
        token: reporter.accessToken,
        params: { id: listing.id },
        body: { reasonCode: 'prohibited_item', details: 'Looks like a weapon.' },
      });

      expect(result.status).toBe(202);
      expect(result.body).toMatchObject({ status: 'received' });

      const report = await prisma.report.findFirst({
        where: { targetType: 'LISTING', targetId: listing.id },
        select: { reasonCode: true, status: true, reporterId: true },
      });
      expect(report).toMatchObject({ reasonCode: 'prohibited_item', status: 'OPEN' });
      expect(report?.reporterId).toBe(reporter.id);

      /*
       * The listing is UNTOUCHED. A report is one person's claim; letting a
       * claim take a competitor's listing down would be a censorship button
       * with no cost to pull.
       */
      const after = await prisma.listing.findUniqueOrThrow({
        where: { id: listing.id },
        select: { status: true, deletedAt: true },
      });
      expect(after).toMatchObject({ status: 'ACTIVE', deletedAt: null });
    });

    it('absorbs a repeat report from the same person silently', async () => {
      const listing = await activeListing();
      const send = () =>
        callRoute(reportListing, `/api/v1/listings/${listing.id}/report`, {
          method: 'POST',
          token: reporter.accessToken,
          params: { id: listing.id },
          body: { reasonCode: 'scam' },
        });

      const first = await send();
      await clearRateLimits(reporter.id);
      const second = await send();

      // Same id back, and only one row: one person cannot manufacture the
      // appearance of a pile-on, which is the signal a moderator would act on.
      expect(second.body).toEqual(first.body);
      expect(
        await prisma.report.count({ where: { targetType: 'LISTING', targetId: listing.id } }),
      ).toBe(1);
    });

    it('will not confirm that an unpublished listing exists', async () => {
      // Otherwise reporting becomes an enumeration oracle for other people's
      // drafts.
      const draft = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        status: 'DRAFT',
      });

      const result = await callRoute(reportListing, `/api/v1/listings/${draft.id}/report`, {
        method: 'POST',
        token: reporter.accessToken,
        params: { id: draft.id },
        body: { reasonCode: 'scam' },
      });
      expect(result.status).toBe(404);

      const missing = await callRoute(reportListing, `/api/v1/listings/${orphanId()}/report`, {
        method: 'POST',
        token: reporter.accessToken,
        params: { id: orphanId() },
        body: { reasonCode: 'scam' },
      });
      // A draft and a listing that never existed are indistinguishable.
      expect(missing.status).toBe(404);
    });

    it('refuses an anonymous report', async () => {
      const listing = await activeListing();
      const result = await callRoute(reportListing, `/api/v1/listings/${listing.id}/report`, {
        method: 'POST',
        token: null,
        params: { id: listing.id },
        body: { reasonCode: 'scam' },
      });
      expect(result.status).toBe(401);
    });

    it('rejects a reason code that is not on the list', async () => {
      const listing = await activeListing();
      const result = await callRoute(reportListing, `/api/v1/listings/${listing.id}/report`, {
        method: 'POST',
        token: reporter.accessToken,
        params: { id: listing.id },
        body: { reasonCode: 'because_i_say_so' },
      });
      expect(result.status).toBe(422);
    });
  });

  describe('moderation', () => {
    it('lets a moderator remove a listing, and records who did it', async () => {
      const listing = await activeListing();
      await callRoute(reportListing, `/api/v1/listings/${listing.id}/report`, {
        method: 'POST',
        token: reporter.accessToken,
        params: { id: listing.id },
        body: { reasonCode: 'unsafe_or_illegal' },
      });

      const result = await callRoute(listingTransition, `/api/v1/listings/${listing.id}/status`, {
        method: 'POST',
        token: moderator.accessToken,
        params: { id: listing.id },
        body: { to: 'REMOVED', reason: 'Prohibited item.' },
      });
      expect(result.status).toBe(200);

      const after = await prisma.listing.findUniqueOrThrow({
        where: { id: listing.id },
        select: { status: true },
      });
      expect(after.status).toBe('REMOVED');

      // The moderation record: who, what, why. Written in the same
      // transaction, so there is no window where a listing is gone with no
      // record of who removed it.
      const action = await prisma.moderationAction.findFirst({
        where: { targetType: 'LISTING', targetId: listing.id },
        select: { moderatorId: true, action: true, reason: true },
      });
      expect(action).toMatchObject({
        moderatorId: moderator.id,
        action: 'remove',
        reason: 'Prohibited item.',
      });

      // And the open report is answered rather than left in the queue.
      const report = await prisma.report.findFirstOrThrow({
        where: { targetType: 'LISTING', targetId: listing.id },
        select: { status: true, assignedTo: true },
      });
      expect(report).toMatchObject({ status: 'ACTIONED', assignedTo: moderator.id });
    });

    it('refuses a rejection with no reason', async () => {
      // A moderation decision owes the seller a reason they can act on.
      const listing = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        status: 'PENDING_REVIEW',
      });

      const result = await callRoute(listingTransition, `/api/v1/listings/${listing.id}/status`, {
        method: 'POST',
        token: moderator.accessToken,
        params: { id: listing.id },
        body: { to: 'REJECTED' },
      });
      expect(result.status).toBe(422);
    });

    it('does not let a seller moderate their own listing back from REMOVED', async () => {
      const listing = await activeListing();
      await prisma.listing.update({
        where: { id: listing.id },
        data: { status: 'REMOVED', deletedAt: new Date() },
      });

      const result = await callRoute(listingTransition, `/api/v1/listings/${listing.id}/status`, {
        method: 'POST',
        token: seller.accessToken,
        params: { id: listing.id },
        body: { to: 'ACTIVE' },
      });

      /*
       * 404, and that is the right answer rather than 403.
       *
       * A REMOVED listing is soft-deleted, so the owner lookup does not find
       * it — it is indistinguishable from a listing that never existed. Self
       * service here would defeat moderation entirely, and answering 403 would
       * additionally confirm to the seller that the row is still there.
       */
      expect(result.status).toBe(404);
    });

    it('writes no moderation record for a seller managing their own listing', async () => {
      // Pausing your own listing is not moderation. Recording it would bury
      // the decisions that matter under routine seller activity.
      const listing = await activeListing();
      const before = await prisma.moderationAction.count({
        where: { targetType: 'LISTING', targetId: listing.id },
      });

      await callRoute(listingTransition, `/api/v1/listings/${listing.id}/status`, {
        method: 'POST',
        token: seller.accessToken,
        params: { id: listing.id },
        body: { to: 'PAUSED' },
      });

      expect(
        await prisma.moderationAction.count({
          where: { targetType: 'LISTING', targetId: listing.id },
        }),
      ).toBe(before);
    });
  });

  describe('prohibited-item screening, through the real publish path', () => {
    it('refuses to publish a listing whose text matches a BLOCK rule', async () => {
      /*
       * The seeded rule is `stolen` (BLOCK, everywhere). The listing is created
       * directly in the database so this exercises PUBLICATION screening
       * specifically — the case where a seller writes a clean draft and edits
       * it to something prohibited before going live.
       */
      const listing = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        status: 'DRAFT',
        title: 'Stolen iPhone, no questions asked',
        withReadyImage: true,
      });

      const result = await callRoute(listingTransition, `/api/v1/listings/${listing.id}/status`, {
        method: 'POST',
        token: seller.accessToken,
        params: { id: listing.id },
        body: { to: 'ACTIVE' },
      });

      expect(result.status).toBe(409);

      // Still a draft. Nothing prohibited reached the public site.
      const after = await prisma.listing.findUniqueOrThrow({
        where: { id: listing.id },
        select: { status: true },
      });
      expect(after.status).toBe('DRAFT');

      // And a moderator can see WHY it was refused.
      const action = await prisma.moderationAction.findFirst({
        where: { targetType: 'LISTING', targetId: listing.id },
        select: { action: true, moderatorId: true, reason: true },
      });
      expect(action?.action).toBe('auto_block');
      // No human made this call, so no moderator is named.
      expect(action?.moderatorId).toBeNull();
      expect(action?.reason).toContain('stolen');
    });

    it('publishes an ordinary listing without interference', async () => {
      // The other half of the claim: screening must not be so eager that an
      // honest seller cannot use the site.
      const listing = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        status: 'DRAFT',
        title: 'Blue wool coat, barely worn',
        withReadyImage: true,
      });

      const result = await callRoute(listingTransition, `/api/v1/listings/${listing.id}/status`, {
        method: 'POST',
        token: seller.accessToken,
        params: { id: listing.id },
        body: { to: 'ACTIVE' },
      });

      expect(result.status).toBe(200);
      const after = await prisma.listing.findUniqueOrThrow({
        where: { id: listing.id },
        select: { status: true, publishedAt: true },
      });
      expect(after.status).toBe('ACTIVE');
      expect(after.publishedAt).not.toBeNull();
    });

    it('diverts a FLAGGED listing to review instead of publishing it', async () => {
      /*
       * The seeded rule `unlocked imei` is FLAG: it does not block, but
       * publishing it with nobody looking would make FLAG meaningless. The
       * listing must land in PENDING_REVIEW — and must NOT carry the fields
       * that say it went live.
       */
      const listing = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        status: 'DRAFT',
        title: 'iPhone 13 unlocked imei clean',
        withReadyImage: true,
      });

      const result = await callRoute(listingTransition, `/api/v1/listings/${listing.id}/status`, {
        method: 'POST',
        token: seller.accessToken,
        params: { id: listing.id },
        body: { to: 'ACTIVE' },
      });
      expect(result.status).toBe(200);

      const after = await prisma.listing.findUniqueOrThrow({
        where: { id: listing.id },
        select: { status: true, publishedAt: true, expiresAt: true },
      });
      expect(after.status).toBe('PENDING_REVIEW');
      // Not "published" in any sense, including the columns.
      expect(after.publishedAt).toBeNull();
      expect(after.expiresAt).toBeNull();
    });
  });

  describe('suspended sellers', () => {
    it('cannot publish, and cannot act at all', async () => {
      const suspended = await createTestUser({
        roles: ['seller'],
        withSellerProfile: true,
        stepUp: true,
      });
      const listing = await createTestListing({
        ownerSellerProfileId: suspended.sellerProfileId!,
        status: 'DRAFT',
      });

      await prisma.user.update({ where: { id: suspended.id }, data: { status: 'SUSPENDED' } });

      const result = await callRoute(listingTransition, `/api/v1/listings/${listing.id}/status`, {
        method: 'POST',
        token: suspended.accessToken,
        params: { id: listing.id },
        body: { to: 'ACTIVE' },
      });

      /*
       * 403 from the GUARD, before any listing logic runs. Account status is
       * re-read from the database on every request rather than trusted from
       * the token, so suspension takes effect immediately and does not wait
       * for an access token to expire.
       */
      expect(result.status).toBe(403);

      const after = await prisma.listing.findUniqueOrThrow({
        where: { id: listing.id },
        select: { status: true },
      });
      expect(after.status).toBe('DRAFT');
    });
  });
});
