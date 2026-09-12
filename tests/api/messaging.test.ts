import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  GET as listConversations,
  POST as startConversation,
} from '../../app/api/v1/conversations/route';
import { GET as getConversation } from '../../app/api/v1/conversations/[id]/route';
import { POST as sendMessage } from '../../app/api/v1/conversations/[id]/messages/route';
import { POST as markRead } from '../../app/api/v1/conversations/[id]/read/route';
import { POST as reportConversation } from '../../app/api/v1/conversations/[id]/report/route';
import { GET as listOffers, POST as createOfferRoute } from '../../app/api/v1/offers/route';
import { GET as getOffer } from '../../app/api/v1/offers/[id]/route';
import { POST as transitionOfferRoute } from '../../app/api/v1/offers/[id]/status/route';
import { prisma } from '@/infra/db/client';
import {
  callRoute,
  clearRateLimits,
  createTestListing,
  createTestUser,
  hasDatabase,
  orphanId,
  type TestUser,
} from './harness';

/**
 * Messaging and offers, through the real routes.
 *
 * Two users exist throughout: `seller` owns a live listing, `buyer` enquires
 * about it. A third user, `stranger`, is a party to nothing and is used to
 * prove that being authenticated is not the same as being authorised.
 */
describe.skipIf(!hasDatabase)('messaging and offers', () => {
  let seller: TestUser;
  let buyer: TestUser;
  let stranger: TestUser;
  let listingId: string;

  beforeAll(async () => {
    seller = await createTestUser({ roles: ['seller'], withSellerProfile: true, stepUp: true });
    buyer = await createTestUser({ roles: ['buyer'], stepUp: true });
    stranger = await createTestUser({ roles: ['buyer'], stepUp: true });

    const listing = await createTestListing({
      ownerSellerProfileId: seller.sellerProfileId!,
      status: 'ACTIVE',
      withReadyImage: true,
      priceMinor: 100_000n,
      title: 'Messaging fixture listing',
    });
    listingId = listing.id;
  }, 120_000);

  /*
   * These tests exercise messaging far faster than a person would, so they
   * clear their OWN accounts' counters between cases. The limits themselves are
   * untouched and the application has no test bypass — `rate-limit.test.ts`
   * proves they still refuse a flood. Only these three users are cleared, so a
   * rate-limit test running in a parallel worker is not disturbed.
   */
  beforeEach(async () => {
    await clearRateLimits(seller.id, buyer.id, stranger.id);
  });

  /** Starts a fresh conversation and returns its id. */
  async function startThread(
    user: TestUser,
    body = 'Hello, is this still available?',
    subject: string = listingId,
  ) {
    const result = await callRoute(startConversation, '/api/v1/conversations', {
      method: 'POST',
      token: user.accessToken,
      body: { listingId: subject, body },
    });
    return result;
  }

  describe('starting a conversation', () => {
    it('lets a buyer contact a seller about a live listing', async () => {
      const result = await startThread(buyer);
      expect(result.status).toBe(201);
      expect(result.body.conversationId).toBeTruthy();
      expect(result.body.messageId).toBeTruthy();
    });

    it('reuses the thread rather than creating a duplicate', async () => {
      const first = await startThread(buyer, 'First enquiry');
      const second = await startThread(buyer, 'Second enquiry');
      expect(second.status).toBe(201);
      // One thread per (listing, buyer, seller): a fragmented history is
      // unusable for both parties and for support.
      expect(second.body.conversationId).toBe(first.body.conversationId);
    });

    it('refuses an unauthenticated caller', async () => {
      const result = await callRoute(startConversation, '/api/v1/conversations', {
        method: 'POST',
        body: { listingId, body: 'anonymous' },
      });
      expect(result.status).toBe(401);
    });

    it('404s a listing that is not live, exactly as it would a missing one', async () => {
      const draft = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        status: 'DRAFT',
      });
      const hidden = await callRoute(startConversation, '/api/v1/conversations', {
        method: 'POST',
        token: buyer.accessToken,
        body: { listingId: draft.id, body: 'Can I see this draft?' },
      });
      const absent = await callRoute(startConversation, '/api/v1/conversations', {
        method: 'POST',
        token: buyer.accessToken,
        body: { listingId: '01a09150-0000-7000-8000-000000000000', body: 'nothing here' },
      });
      expect(hidden.status).toBe(404);
      expect(absent.status).toBe(hidden.status);
    });

    it('refuses a seller messaging their own listing', async () => {
      const result = await callRoute(startConversation, '/api/v1/conversations', {
        method: 'POST',
        token: seller.accessToken,
        body: { listingId, body: 'talking to myself' },
      });
      expect(result.status).toBe(409);
    });
  });

  describe('message content', () => {
    it('stores a message verbatim rather than rewriting it', async () => {
      const thread = await startThread(buyer, 'Is  the   price negotiable?');
      const message = await prisma.message.findUniqueOrThrow({
        where: { id: thread.body.messageId as string },
        select: { body: true },
      });
      // Internal spacing is the sender's; we do not tidy someone's words.
      expect(message.body).toBe('Is  the   price negotiable?');
    });

    it('refuses an over-long message instead of truncating it', async () => {
      const thread = await startThread(buyer);
      const conversationId = thread.body.conversationId as string;

      const result = await callRoute(
        sendMessage,
        `/api/v1/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          token: buyer.accessToken,
          params: { id: conversationId },
          body: { body: 'x'.repeat(5000) },
        },
      );
      expect(result.status).toBe(422);
      const fields = (result.body.error as { fields: { message: string }[] }).fields;
      expect(fields[0]?.message).toBe('too_long');
    });

    it('refuses a whitespace-only message', async () => {
      const thread = await startThread(buyer);
      const conversationId = thread.body.conversationId as string;
      const result = await callRoute(
        sendMessage,
        `/api/v1/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          token: buyer.accessToken,
          params: { id: conversationId },
          body: { body: '   \n\n  ' },
        },
      );
      expect(result.status).toBe(422);
    });

    it('stores HTML as inert TEXT rather than stripping it', async () => {
      const thread = await startThread(buyer);
      const conversationId = thread.body.conversationId as string;

      const payload = '<script>alert(1)</script> still interested';
      const sent = await callRoute(
        sendMessage,
        `/api/v1/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          token: buyer.accessToken,
          params: { id: conversationId },
          body: { body: payload },
        },
      );
      expect(sent.status).toBe(201);

      const stored = await prisma.message.findUniqueOrThrow({
        where: { id: sent.body.messageId as string },
        select: { body: true, riskScore: true, moderationStatus: true },
      });
      /*
       * The text is kept EXACTLY as written. Safety comes from never parsing
       * it as markup — React escapes on output — not from stripping tags,
       * which is a blocklist and would also silently edit the user.
       */
      expect(stored.body).toBe(payload);
      expect(stored.riskScore).toBeGreaterThan(0);
    });

    it('flags a message that tries to move the deal off-platform, and still delivers it', async () => {
      const thread = await startThread(buyer);
      const conversationId = thread.body.conversationId as string;

      const sent = await callRoute(
        sendMessage,
        `/api/v1/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          token: buyer.accessToken,
          params: { id: conversationId },
          body: { body: 'email me at scam@example.com and pay by bank transfer' },
        },
      );
      expect(sent.status).toBe(201);
      expect(sent.body.flagged).toBe(true);

      const stored = await prisma.message.findUniqueOrThrow({
        where: { id: sent.body.messageId as string },
        select: { moderationStatus: true, riskScore: true },
      });
      // Marked for review, NOT hidden: silently dropping a message the sender
      // believes was sent is worse than delivering or refusing it.
      expect(stored.moderationStatus).toBe('PENDING');
      expect(stored.riskScore).toBeGreaterThanOrEqual(50);
    });
  });

  describe('reading a conversation', () => {
    it('returns history and marks who sent what', async () => {
      const thread = await startThread(buyer, 'Opening message');
      const conversationId = thread.body.conversationId as string;

      await callRoute(sendMessage, `/api/v1/conversations/${conversationId}/messages`, {
        method: 'POST',
        token: seller.accessToken,
        params: { id: conversationId },
        body: { body: 'Yes, still available.' },
      });

      const result = await callRoute(getConversation, `/api/v1/conversations/${conversationId}`, {
        token: buyer.accessToken,
        params: { id: conversationId },
      });
      expect(result.status).toBe(200);

      const messages = result.body.messages as { body: string; mine: boolean }[];
      expect(messages.length).toBeGreaterThanOrEqual(2);
      expect(messages.some((m) => m.mine === true)).toBe(true);
      expect(messages.some((m) => m.mine === false)).toBe(true);
    });

    it('paginates with a cursor rather than an offset', async () => {
      const thread = await startThread(buyer, 'Pagination thread');
      const conversationId = thread.body.conversationId as string;

      for (let i = 0; i < 8; i += 1) {
        await callRoute(sendMessage, `/api/v1/conversations/${conversationId}/messages`, {
          method: 'POST',
          token: buyer.accessToken,
          params: { id: conversationId },
          body: { body: `message ${i}` },
        });
      }

      const first = await callRoute(getConversation, `/api/v1/conversations/${conversationId}`, {
        token: buyer.accessToken,
        params: { id: conversationId },
        searchParams: { limit: '3' },
      });
      expect(first.status).toBe(200);
      const firstIds = (first.body.messages as { id: string }[]).map((m) => m.id);
      expect(firstIds).toHaveLength(3);

      const cursor = (first.body.page as { nextCursor: string | null }).nextCursor;
      expect(cursor).toBeTruthy();

      const second = await callRoute(getConversation, `/api/v1/conversations/${conversationId}`, {
        token: buyer.accessToken,
        params: { id: conversationId },
        searchParams: { limit: '3', cursor: cursor! },
      });
      const secondIds = (second.body.messages as { id: string }[]).map((m) => m.id);

      // No overlap and no skipped rows: the property offset pagination cannot
      // give you while messages are still arriving.
      expect(secondIds).toHaveLength(3);
      expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
    });

    it('tracks unread state per participant', async () => {
      const thread = await startThread(buyer, 'Unread probe');
      const conversationId = thread.body.conversationId as string;

      await callRoute(sendMessage, `/api/v1/conversations/${conversationId}/messages`, {
        method: 'POST',
        token: seller.accessToken,
        params: { id: conversationId },
        body: { body: 'A reply the buyer has not seen' },
      });

      const inbox = await callRoute(listConversations, '/api/v1/conversations', {
        token: buyer.accessToken,
      });
      const entry = (inbox.body.data as { id: string; unreadCount: number }[]).find(
        (row) => row.id === conversationId,
      );
      expect(entry?.unreadCount).toBeGreaterThan(0);

      await callRoute(markRead, `/api/v1/conversations/${conversationId}/read`, {
        method: 'POST',
        token: buyer.accessToken,
        params: { id: conversationId },
      });

      const after = await callRoute(listConversations, '/api/v1/conversations', {
        token: buyer.accessToken,
      });
      const cleared = (after.body.data as { id: string; unreadCount: number }[]).find(
        (row) => row.id === conversationId,
      );
      expect(cleared?.unreadCount).toBe(0);
    });

    it('never counts the sender’s own message as unread to them', async () => {
      const thread = await startThread(buyer, 'Own message probe');
      const conversationId = thread.body.conversationId as string;

      const inbox = await callRoute(listConversations, '/api/v1/conversations', {
        token: buyer.accessToken,
      });
      const entry = (inbox.body.data as { id: string; unreadCount: number }[]).find(
        (row) => row.id === conversationId,
      );
      expect(entry?.unreadCount).toBe(0);
    });
  });

  describe('IDOR against conversations', () => {
    let conversationId: string;

    beforeAll(async () => {
      const thread = await startThread(buyer, 'Private conversation contents');
      conversationId = thread.body.conversationId as string;
    });

    it('404s a stranger reading the thread, and leaks no content', async () => {
      const result = await callRoute(getConversation, `/api/v1/conversations/${conversationId}`, {
        token: stranger.accessToken,
        params: { id: conversationId },
      });
      expect(result.status).toBe(404);
      expect(result.raw).not.toContain('Private conversation contents');
    });

    it('gives a stranger the same answer for a real thread as for a fake id', async () => {
      const real = await callRoute(getConversation, `/api/v1/conversations/${conversationId}`, {
        token: stranger.accessToken,
        params: { id: conversationId },
      });
      const fake = await callRoute(
        getConversation,
        '/api/v1/conversations/01a09150-0000-7000-8000-000000000000',
        {
          token: stranger.accessToken,
          params: { id: '01a09150-0000-7000-8000-000000000000' },
        },
      );
      expect(real.status).toBe(fake.status);

      // Compared without `requestId`, which is unique per request by design.
      // Everything an attacker could read the difference from must match.
      const shape = (body: Record<string, unknown>) => {
        const error = body.error as { code: string; message: string };
        return { code: error.code, message: error.message };
      };
      expect(shape(real.body)).toEqual(shape(fake.body));
    });

    it('does not 500 on a malformed conversation id', async () => {
      const result = await callRoute(getConversation, '/api/v1/conversations/not-a-uuid', {
        token: stranger.accessToken,
        params: { id: 'not-a-uuid' },
      });
      expect(result.status).toBe(404);
    });

    it('refuses a stranger POSTING into the thread', async () => {
      const before = await prisma.message.count({ where: { conversationId } });

      const result = await callRoute(
        sendMessage,
        `/api/v1/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          token: stranger.accessToken,
          params: { id: conversationId },
          body: { body: 'injected by a stranger' },
        },
      );
      expect(result.status).toBe(404);

      // Nothing was written: participant injection is the attack this closes.
      expect(await prisma.message.count({ where: { conversationId } })).toBe(before);
    });

    it('refuses a stranger marking the thread read', async () => {
      const result = await callRoute(markRead, `/api/v1/conversations/${conversationId}/read`, {
        method: 'POST',
        token: stranger.accessToken,
        params: { id: conversationId },
      });
      expect(result.status).toBe(404);
    });

    it('refuses a stranger reporting the thread', async () => {
      // Otherwise reporting becomes a probe for which conversation ids exist.
      const result = await callRoute(
        reportConversation,
        `/api/v1/conversations/${conversationId}/report`,
        {
          method: 'POST',
          token: stranger.accessToken,
          params: { id: conversationId },
          body: { reasonCode: 'spam' },
        },
      );
      expect(result.status).toBe(404);
    });

    it('never shows a stranger’s inbox someone else’s thread', async () => {
      const inbox = await callRoute(listConversations, '/api/v1/conversations', {
        token: stranger.accessToken,
      });
      expect(inbox.status).toBe(200);
      const ids = (inbox.body.data as { id: string }[]).map((row) => row.id);
      expect(ids).not.toContain(conversationId);
    });
  });

  describe('reporting', () => {
    it('records a report and marks the thread without touching messages', async () => {
      const thread = await startThread(buyer, 'Reportable content here');
      const conversationId = thread.body.conversationId as string;
      const before = await prisma.message.count({ where: { conversationId } });

      const result = await callRoute(
        reportConversation,
        `/api/v1/conversations/${conversationId}/report`,
        {
          method: 'POST',
          token: seller.accessToken,
          params: { id: conversationId },
          body: { reasonCode: 'scam', details: 'Asked me to pay by bank transfer' },
        },
      );
      expect(result.status).toBe(201);

      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversationId },
        select: { status: true },
      });
      expect(conversation.status).toBe('REPORTED');

      // Evidence that vanishes when reported is useless.
      expect(await prisma.message.count({ where: { conversationId } })).toBe(before);
    });
  });

  /**
   * Offers.
   *
   * The state machine is the subject here, not the happy path. Most of these
   * tests are moves that must be REFUSED: a seller editing a buyer's offer, a
   * buyer reversing a seller's decision, a stranger touching either.
   *
   * Every offer below is made against `listingId`, priced at 100_000 minor
   * units (£1,000.00) in GBP.
   */
  describe('offers', () => {
    /** A fresh live listing owned by `seller`, priced at £1,000.00. */
    async function freshListing(): Promise<string> {
      const listing = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        status: 'ACTIVE',
        withReadyImage: true,
        priceMinor: 100_000n,
      });
      return listing.id;
    }

    /**
     * Submits an offer and returns its id, failing loudly if it did not.
     *
     * Each offer gets its OWN listing by default: the database permits a buyer
     * a single open offer per listing, so reusing one fixture would make every
     * test after the first collide on that rule rather than test its subject.
     */
    async function submitOffer(
      user: TestUser,
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      const subject = (overrides.listingId as string | undefined) ?? (await freshListing());
      const result = await callRoute(createOfferRoute, '/api/v1/offers', {
        method: 'POST',
        token: user.accessToken,
        body: { amountMinor: '90000', currency: 'GBP', ...overrides, listingId: subject },
      });
      if (result.status !== 201) {
        throw new Error(`offer creation failed: ${result.status} ${result.raw}`);
      }
      return result.body.id as string;
    }

    function move(user: TestUser, offerId: string, to: string, note?: string) {
      return callRoute(transitionOfferRoute, `/api/v1/offers/${offerId}/status`, {
        method: 'POST',
        token: user.accessToken,
        params: { id: offerId },
        body: { to, ...(note === undefined ? {} : { note }) },
      });
    }

    describe('making an offer', () => {
      it('lets a buyer make an offer on a live listing', async () => {
        const result = await callRoute(createOfferRoute, '/api/v1/offers', {
          method: 'POST',
          token: buyer.accessToken,
          body: {
            listingId,
            amountMinor: '90000',
            currency: 'GBP',
            message: 'Would you take this?',
          },
        });
        expect(result.status).toBe(201);
        // SUBMITTED, not PENDING: the status names an event, not a feeling.
        expect(result.body.status).toBe('SUBMITTED');

        const row = await prisma.offer.findUniqueOrThrow({
          where: { id: result.body.id as string },
          select: { amountMinor: true, currency: true, buyerId: true, submittedAt: true },
        });
        // Stored as an integer minor-unit BigInt, never a float (ADR-0006).
        expect(row.amountMinor).toBe(90_000n);
        expect(row.currency).toBe('GBP');
        // The buyer is the token subject, never a request field.
        expect(row.buyerId).toBe(buyer.id);
        expect(row.submittedAt).not.toBeNull();
      });

      it('returns the amount as a string, never a JSON number', async () => {
        const offerId = await submitOffer(buyer);
        const result = await callRoute(getOffer, `/api/v1/offers/${offerId}`, {
          token: buyer.accessToken,
          params: { id: offerId },
        });
        expect(result.status).toBe(200);
        const offer = result.body.offer as Record<string, unknown>;
        // A JSON number would silently lose precision past 2^53 (ADR-0004).
        expect(typeof offer.amountMinor).toBe('string');
        expect(offer.amountMinor).toBe('90000');
      });

      it('attaches the offer to a thread the buyer is actually in', async () => {
        const subject = await freshListing();
        const thread = await startThread(buyer, 'Opening an offer thread', subject);
        const conversationId = thread.body.conversationId as string;
        const before = await prisma.message.count({ where: { conversationId } });

        const offerId = await submitOffer(buyer, {
          listingId: subject,
          conversationId,
          message: 'Offering ninety per cent.',
        });

        const row = await prisma.offer.findUniqueOrThrow({
          where: { id: offerId },
          select: { conversationId: true },
        });
        expect(row.conversationId).toBe(conversationId);
        // The offer is visible in the thread rather than happening beside it.
        expect(await prisma.message.count({ where: { conversationId } })).toBe(before + 1);
      });

      it('refuses to attach an offer to someone else’s thread', async () => {
        const thread = await startThread(buyer, 'Private thread');
        const conversationId = thread.body.conversationId as string;

        // Participant injection: a third party naming a conversation they are
        // not in must not be able to post an offer into it.
        const result = await callRoute(createOfferRoute, '/api/v1/offers', {
          method: 'POST',
          token: stranger.accessToken,
          body: { listingId, amountMinor: '90000', currency: 'GBP', conversationId },
        });
        expect(result.status).toBe(404);
        expect(await prisma.offer.count({ where: { conversationId } })).toBe(
          await prisma.offer.count({ where: { conversationId, buyerId: buyer.id } }),
        );
      });

      it('refuses an offer on the caller’s own listing', async () => {
        const result = await callRoute(createOfferRoute, '/api/v1/offers', {
          method: 'POST',
          token: seller.accessToken,
          body: { listingId, amountMinor: '90000', currency: 'GBP' },
        });
        expect(result.status).toBe(409);
      });

      it('404s a listing that is not live, exactly as it would a missing one', async () => {
        const draft = await createTestListing({
          ownerSellerProfileId: seller.sellerProfileId!,
          status: 'DRAFT',
        });
        const hidden = await callRoute(createOfferRoute, '/api/v1/offers', {
          method: 'POST',
          token: buyer.accessToken,
          body: { listingId: draft.id, amountMinor: '9000', currency: 'GBP' },
        });
        const missing = await callRoute(createOfferRoute, '/api/v1/offers', {
          method: 'POST',
          token: buyer.accessToken,
          body: { listingId: orphanId(), amountMinor: '9000', currency: 'GBP' },
        });
        expect(hidden.status).toBe(404);
        expect(missing.status).toBe(404);
      });

      it('refuses a second open offer on the same listing', async () => {
        const subject = await freshListing();
        await submitOffer(buyer, { listingId: subject });

        const second = await callRoute(createOfferRoute, '/api/v1/offers', {
          method: 'POST',
          token: buyer.accessToken,
          body: { listingId: subject, amountMinor: '95000', currency: 'GBP' },
        });
        // The rule lives in the database (`offers_one_pending_per_buyer_listing`)
        // so a buyer cannot bury a seller under simultaneous bids. It must
        // surface as a 409, not as an unhandled unique violation.
        expect(second.status).toBe(409);
        expect(second.body.error).toMatchObject({ code: 'conflict' });
        expect(await prisma.offer.count({ where: { listingId: subject } })).toBe(1);
      });

      it('lets the buyer offer again once the first is resolved', async () => {
        const subject = await freshListing();
        const first = await submitOffer(buyer, { listingId: subject });
        expect((await move(seller, first, 'DECLINED')).status).toBe(200);

        // The index is partial on the open status, so a settled offer does not
        // lock the buyer out of the listing for ever.
        const again = await callRoute(createOfferRoute, '/api/v1/offers', {
          method: 'POST',
          token: buyer.accessToken,
          body: { listingId: subject, amountMinor: '95000', currency: 'GBP' },
        });
        expect(again.status).toBe(201);
      });

      it('refuses an unauthenticated caller', async () => {
        const result = await callRoute(createOfferRoute, '/api/v1/offers', {
          method: 'POST',
          body: { listingId, amountMinor: '90000', currency: 'GBP' },
        });
        expect(result.status).toBe(401);
        expect(result.body.error).toMatchObject({ code: 'unauthenticated' });
      });
    });

    describe('amount validation', () => {
      /*
       * The server re-derives every bound from the listing and its category
       * row. The request supplies a candidate number and nothing else.
       */
      const rejected: { name: string; amountMinor: unknown; currency?: string }[] = [
        { name: 'a decimal string (major units by mistake)', amountMinor: '900.50' },
        { name: 'scientific notation', amountMinor: '9e4' },
        { name: 'a negative amount', amountMinor: '-90000' },
        { name: 'a JSON number rather than a string', amountMinor: 90000 },
        { name: 'zero', amountMinor: '0' },
        { name: 'an amount past the hard ceiling', amountMinor: '99999999999999999' },
        { name: 'a different currency to the listing', amountMinor: '90000', currency: 'USD' },
      ];

      for (const testCase of rejected) {
        it(`refuses ${testCase.name}`, async () => {
          const before = await prisma.offer.count({ where: { buyerId: buyer.id } });
          const result = await callRoute(createOfferRoute, '/api/v1/offers', {
            method: 'POST',
            token: buyer.accessToken,
            body: {
              listingId,
              amountMinor: testCase.amountMinor,
              currency: testCase.currency ?? 'GBP',
            },
          });
          expect(result.status).toBe(422);
          // Nothing partial was written.
          expect(await prisma.offer.count({ where: { buyerId: buyer.id } })).toBe(before);
        });
      }

      it('accepts an offer above the asking price', async () => {
        // Deliberate: refusing a buyer who bids above asking would be the
        // marketplace deciding a seller should earn less.
        const result = await callRoute(createOfferRoute, '/api/v1/offers', {
          method: 'POST',
          token: buyer.accessToken,
          body: { listingId: await freshListing(), amountMinor: '150000', currency: 'GBP' },
        });
        expect(result.status).toBe(201);
      });
    });

    describe('the lifecycle', () => {
      it('lets the seller accept, and records both moves in order', async () => {
        const offerId = await submitOffer(buyer);
        const accepted = await move(seller, offerId, 'ACCEPTED', 'Happy with that.');
        expect(accepted.status).toBe(200);
        expect(accepted.body.status).toBe('ACCEPTED');

        const detail = await callRoute(getOffer, `/api/v1/offers/${offerId}`, {
          token: buyer.accessToken,
          params: { id: offerId },
        });
        const history = detail.body.history as Record<string, string>[];
        expect(history.map((event) => [event.fromStatus, event.toStatus])).toEqual([
          [null, 'SUBMITTED'],
          ['SUBMITTED', 'ACCEPTED'],
        ]);
        // The role on each event comes from the database, not the request.
        expect(history.map((event) => event.actorRole)).toEqual(['buyer', 'seller']);
      });

      it('lets the seller decline', async () => {
        const offerId = await submitOffer(buyer);
        const result = await move(seller, offerId, 'DECLINED');
        expect(result.status).toBe(200);
        expect(result.body.status).toBe('DECLINED');
      });

      it('lets the buyer withdraw before an answer', async () => {
        const offerId = await submitOffer(buyer);
        const result = await move(buyer, offerId, 'WITHDRAWN');
        expect(result.status).toBe(200);
        expect(result.body.status).toBe('WITHDRAWN');
      });

      it('offers each party only the moves the table gives their role', async () => {
        const offerId = await submitOffer(buyer);

        const asBuyer = await callRoute(getOffer, `/api/v1/offers/${offerId}`, {
          token: buyer.accessToken,
          params: { id: offerId },
        });
        const asSeller = await callRoute(getOffer, `/api/v1/offers/${offerId}`, {
          token: seller.accessToken,
          params: { id: offerId },
        });

        const moves = (result: typeof asBuyer) =>
          (result.body.availableTransitions as { to: string }[]).map((row) => row.to).sort();

        expect(moves(asBuyer)).toEqual(['WITHDRAWN']);
        expect(moves(asSeller)).toEqual(['ACCEPTED', 'DECLINED']);
        expect((asBuyer.body.offer as { viewerRole: string }).viewerRole).toBe('buyer');
        expect((asSeller.body.offer as { viewerRole: string }).viewerRole).toBe('seller');
      });
    });

    describe('moves that must be refused', () => {
      it('refuses a seller withdrawing the buyer’s offer', async () => {
        const offerId = await submitOffer(buyer);
        // WITHDRAWN belongs to the buyer. A seller cannot modify a buyer's
        // offer, and the transition table is what refuses it.
        const result = await move(seller, offerId, 'WITHDRAWN');
        expect(result.status).toBe(409);

        const row = await prisma.offer.findUniqueOrThrow({
          where: { id: offerId },
          select: { status: true },
        });
        expect(row.status).toBe('SUBMITTED');
      });

      it('refuses a buyer accepting their own offer', async () => {
        const offerId = await submitOffer(buyer);
        const result = await move(buyer, offerId, 'ACCEPTED');
        expect(result.status).toBe(409);
        expect((await prisma.offer.findUniqueOrThrow({ where: { id: offerId } })).status).toBe(
          'SUBMITTED',
        );
      });

      it('refuses a buyer reversing the seller’s decision', async () => {
        const offerId = await submitOffer(buyer);
        expect((await move(seller, offerId, 'DECLINED')).status).toBe(200);

        // DECLINED is final. The buyer cannot accept their way out of it, and
        // cannot withdraw it to pretend it never happened either.
        expect((await move(buyer, offerId, 'ACCEPTED')).status).toBe(409);
        expect((await move(buyer, offerId, 'WITHDRAWN')).status).toBe(409);
        expect((await move(buyer, offerId, 'SUBMITTED')).status).toBe(409);

        expect((await prisma.offer.findUniqueOrThrow({ where: { id: offerId } })).status).toBe(
          'DECLINED',
        );
      });

      it('refuses a seller re-deciding an accepted offer', async () => {
        const offerId = await submitOffer(buyer);
        expect((await move(seller, offerId, 'ACCEPTED')).status).toBe(200);
        expect((await move(seller, offerId, 'DECLINED')).status).toBe(409);
        expect((await prisma.offer.findUniqueOrThrow({ where: { id: offerId } })).status).toBe(
          'ACCEPTED',
        );
      });

      it('refuses a transition that is not in the table at all', async () => {
        const offerId = await submitOffer(buyer);
        const result = await callRoute(transitionOfferRoute, `/api/v1/offers/${offerId}/status`, {
          method: 'POST',
          token: seller.accessToken,
          params: { id: offerId },
          // COUNTERED is a reserved status with no transitions into it.
          body: { to: 'COUNTERED' },
        });
        expect(result.status).toBe(422);
      });

      it('refuses to accept an expired offer, and records the expiry', async () => {
        const offerId = await submitOffer(buyer);
        // Expiry is evaluated on read rather than by a sweeper that may not
        // have run, so backdating the window is enough to test it.
        await prisma.offer.update({
          where: { id: offerId },
          data: { expiresAt: new Date(Date.now() - 60_000) },
        });

        const result = await move(seller, offerId, 'ACCEPTED');
        expect(result.status).toBe(409);

        const row = await prisma.offer.findUniqueOrThrow({
          where: { id: offerId },
          select: { status: true },
        });
        expect(row.status).toBe('EXPIRED');

        const events = await prisma.offerEvent.findMany({
          where: { offerId },
          orderBy: { createdAt: 'asc' },
          select: { toStatus: true, actorRole: true, actorId: true },
        });
        const expiry = events.at(-1)!;
        expect(expiry.toStatus).toBe('EXPIRED');
        // A system move carries no actor; the database CHECK enforces it.
        expect(expiry.actorRole).toBe('system');
        expect(expiry.actorId).toBeNull();
      });
    });

    describe('IDOR against offers', () => {
      let offerId: string;

      beforeAll(async () => {
        offerId = await submitOffer(buyer);
      });

      it('gives a stranger the same 404 for a real offer as for a made-up id', async () => {
        const real = await callRoute(getOffer, `/api/v1/offers/${offerId}`, {
          token: stranger.accessToken,
          params: { id: offerId },
        });
        const fake = await callRoute(getOffer, `/api/v1/offers/${orphanId()}`, {
          token: stranger.accessToken,
          params: { id: orphanId() },
        });

        expect(real.status).toBe(404);
        expect(fake.status).toBe(404);

        // Compared without `requestId`, which is unique per request by design:
        // anything an attacker could read the difference from must match.
        const shape = (body: Record<string, unknown>) => {
          const error = body.error as { code: string; message: string };
          return { code: error.code, message: error.message };
        };
        expect(shape(real.body)).toEqual(shape(fake.body));
      });

      it('refuses a stranger moving someone else’s offer, and changes nothing', async () => {
        for (const to of ['ACCEPTED', 'DECLINED', 'WITHDRAWN', 'CANCELLED']) {
          const result = await move(stranger, offerId, to);
          // 404, never 403: a 403 would confirm the offer exists.
          expect(result.status).toBe(404);
        }

        const row = await prisma.offer.findUniqueOrThrow({
          where: { id: offerId },
          select: { status: true },
        });
        expect(row.status).toBe('SUBMITTED');
        expect(await prisma.offerEvent.count({ where: { offerId } })).toBe(1);
      });

      it('never lists someone else’s offer', async () => {
        for (const role of [undefined, 'buyer', 'seller']) {
          const result = await callRoute(listOffers, '/api/v1/offers', {
            token: stranger.accessToken,
            ...(role === undefined ? {} : { searchParams: { role } }),
          });
          expect(result.status).toBe(200);
          const ids = (result.body.data as { id: string }[]).map((row) => row.id);
          // No parameter widens the result beyond the caller's own offers.
          expect(ids).not.toContain(offerId);
        }
      });

      it('404s an unparseable id rather than leaking a database error', async () => {
        // Postgres throws on an invalid uuid; `isUuid` must catch it first.
        const detail = await callRoute(getOffer, '/api/v1/offers/not-a-uuid', {
          token: buyer.accessToken,
          params: { id: 'not-a-uuid' },
        });
        const transition = await callRoute(
          transitionOfferRoute,
          '/api/v1/offers/not-a-uuid/status',
          {
            method: 'POST',
            token: buyer.accessToken,
            params: { id: 'not-a-uuid' },
            body: { to: 'WITHDRAWN' },
          },
        );
        expect(detail.status).toBe(404);
        expect(transition.status).toBe(404);
      });
    });

    describe('the audit trail', () => {
      it('cannot be rewritten, even with direct database access', async () => {
        const offerId = await submitOffer(buyer);
        await move(seller, offerId, 'ACCEPTED');

        const event = await prisma.offerEvent.findFirstOrThrow({ where: { offerId } });

        // Append-only is enforced by a trigger, not only by our not writing
        // the update. A history that can be edited would be believed anyway.
        await expect(
          prisma.offerEvent.update({
            where: { id: event.id },
            data: { toStatus: 'DECLINED' },
          }),
        ).rejects.toThrow();

        await expect(prisma.offerEvent.delete({ where: { id: event.id } })).rejects.toThrow();

        expect(await prisma.offerEvent.count({ where: { offerId } })).toBe(2);
      });
    });

    describe('phase 6 moves no money', () => {
      it('creates no order, payment, ledger entry or payout when an offer is accepted', async () => {
        const before = {
          orders: await prisma.order.count(),
          payments: await prisma.payment.count(),
          ledger: await prisma.ledgerEntry.count(),
          payouts: await prisma.payout.count(),
        };

        const offerId = await submitOffer(buyer);
        expect((await move(seller, offerId, 'ACCEPTED')).status).toBe(200);

        // An accepted offer is a record of AGREEMENT. Charging anything
        // against it is Phase 7, and nothing here may anticipate it.
        expect(await prisma.order.count()).toBe(before.orders);
        expect(await prisma.payment.count()).toBe(before.payments);
        expect(await prisma.ledgerEntry.count()).toBe(before.ledger);
        expect(await prisma.payout.count()).toBe(before.payouts);
      });
    });
  });
});
