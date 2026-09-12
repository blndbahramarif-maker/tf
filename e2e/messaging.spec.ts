import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { e2ePrisma } from './database';
import {
  createSellerProfile,
  login,
  publishListing,
  reauthenticate,
  registerAndVerify,
  signOut,
} from './helpers';

/**
 * Messaging and offers, end to end.
 *
 * Every one of these drives the real browser through the real Server Actions,
 * with the real CSRF check and the real participation check. Nothing is
 * fabricated in the database except the reads used to ASSERT an outcome.
 *
 * The tests that matter most are the ones where somebody is refused: a
 * stranger reaching for a thread, a seller trying to withdraw a buyer's offer,
 * a buyer trying to reverse a decision. Those are the reason this phase exists.
 */

/**
 * The message list of an open thread.
 *
 * Scoped deliberately: the inbox renders each preview TWICE — once in the
 * stacked card layout for phones and once in the table for desktop — so an
 * unscoped `getByText` matches both and fails on strict mode. Asserting inside
 * the thread's own list also proves the reader is actually on the thread.
 */
function messages(page: Page) {
  return page.getByTestId('message-list');
}

/** Clicks a link and waits for the navigation it starts. */
async function openThread(page: Page, name: RegExp): Promise<void> {
  await page.getByRole('link', { name }).first().click();
  await page.waitForURL(/\/en\/dashboard\/messages\/[0-9a-f-]{36}/);
}

/** A seller with a live listing, and a separate buyer, in one browser each. */
async function seedSellerAndListing(page: Page, prefix: string) {
  const seller = await registerAndVerify(page, `${prefix}-seller`);
  await login(page, seller);
  await createSellerProfile(page, `${prefix} Seller Co`);
  await reauthenticate(page);
  const contactUrl = await publishListing(page, `E2E ${prefix} listing`);
  return { seller, contactUrl };
}

test.describe('contacting a seller', () => {
  test('a buyer opens a thread and both sides can read it', async ({ page, browser }) => {
    const { contactUrl } = await seedSellerAndListing(page, 'contact');
    const sellerCookies = await page.context().cookies();
    await signOut(page);

    // ── the buyer writes ──────────────────────────────────────────────────
    const buyer = await registerAndVerify(page, 'contact-buyer');
    await login(page, buyer);

    await page.goto(contactUrl);
    await page.getByRole('heading', { name: 'Contact the seller' }).waitFor();
    await page.getByLabel('Your message').fill('Hello, is this still available?');
    await page.getByRole('button', { name: 'Send message' }).click();

    await expect(page).toHaveURL(/\/en\/dashboard\/messages\/[0-9a-f-]{36}/);
    await expect(messages(page).getByText('Hello, is this still available?')).toBeVisible();
    const threadUrl = page.url();

    // ── the seller replies, in their own browser context ─────────────────
    const sellerContext = await browser.newContext();
    await sellerContext.addCookies(sellerCookies);
    const sellerPage = await sellerContext.newPage();

    await sellerPage.goto('/en/dashboard/messages');
    await expect(sellerPage.getByRole('heading', { name: 'Messages' })).toBeVisible();
    await openThread(sellerPage, /E2E contact listing/);

    await expect(messages(sellerPage).getByText('Hello, is this still available?')).toBeVisible();
    await sellerPage.getByLabel('Your message').fill('Yes it is, happy to answer questions.');
    await sellerPage.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(
      messages(sellerPage).getByText('Yes it is, happy to answer questions.'),
    ).toBeVisible();

    // ── the buyer sees the reply ─────────────────────────────────────────
    await page.goto(threadUrl);
    await expect(messages(page).getByText('Yes it is, happy to answer questions.')).toBeVisible();

    await sellerContext.close();
  });

  test('contacting the same listing twice reuses the thread', async ({ page }) => {
    const { contactUrl } = await seedSellerAndListing(page, 'reuse');
    await signOut(page);

    const buyer = await registerAndVerify(page, 'reuse-buyer');
    await login(page, buyer);

    await page.goto(contactUrl);
    await page.getByLabel('Your message').fill('First enquiry');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page).toHaveURL(/\/messages\/[0-9a-f-]{36}/);
    const first = page.url();

    // A second visit offers the existing thread rather than a second form:
    // one thread per (listing, buyer, seller).
    await page.goto(contactUrl);
    await page.getByRole('link', { name: /already have a conversation/ }).click();
    await page.waitForURL(/\/en\/dashboard\/messages\/[0-9a-f-]{36}/);
    expect(page.url()).toBe(first);
  });

  test('a seller cannot open a conversation with themselves', async ({ page }) => {
    const { contactUrl } = await seedSellerAndListing(page, 'selfchat');

    await page.goto(contactUrl);
    await expect(page.getByText('This is your own listing.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send message' })).toHaveCount(0);
  });

  test('an anonymous visitor is offered sign-in, and comes back here', async ({ page }) => {
    const { contactUrl } = await seedSellerAndListing(page, 'anon');
    const listingId = /listing=([0-9a-f-]{36})/.exec(contactUrl)?.[1] ?? '';
    await signOut(page);

    await page.goto(`/en/listing/${listingId}`);
    await page.getByRole('link', { name: 'Sign in to contact the seller' }).click();
    await expect(page).toHaveURL(/\/en\/login\?next=/);
    // The destination is carried through, rather than dumping them on a
    // dashboard home they did not ask for.
    expect(decodeURIComponent(page.url())).toContain(
      `/dashboard/messages/new?listing=${listingId}`,
    );
  });
});

test.describe('message content safety', () => {
  test('stores markup as text and never executes it', async ({ page }) => {
    const { contactUrl } = await seedSellerAndListing(page, 'markup');
    await signOut(page);

    const buyer = await registerAndVerify(page, 'markup-buyer');
    await login(page, buyer);

    const payload =
      '<img src=x onerror="window.__pwned = true"><script>window.__pwned = true</script>';
    await page.goto(contactUrl);
    await page.getByLabel('Your message').fill(payload);
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page).toHaveURL(/\/messages\/[0-9a-f-]{36}/);

    // Rendered VERBATIM, as text. It is not stripped, because the defence is
    // never parsing it — and it did not run.
    await expect(messages(page).getByText(payload, { exact: false })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBe(
      undefined,
    );
    // No element was created from it either.
    expect(await page.locator('img[src="x"]').count()).toBe(0);
  });

  test('refuses an empty message rather than creating a silent thread', async ({ page }) => {
    const { contactUrl } = await seedSellerAndListing(page, 'empty');
    await signOut(page);

    const buyer = await registerAndVerify(page, 'empty-buyer');
    await login(page, buyer);

    await page.goto(contactUrl);
    await page.getByLabel('Your message').fill('   ');
    await page.getByRole('button', { name: 'Send message' }).click();

    // Still on the form. The browser's own `required` does not catch spaces,
    // so this is the server refusing.
    await expect(page).toHaveURL(/\/messages\/new/);
    await expect(page.getByTestId('form-error')).toBeVisible();
  });

  test('delivers a risky message and marks it for review rather than dropping it', async ({
    page,
  }) => {
    const { contactUrl } = await seedSellerAndListing(page, 'risky');
    await signOut(page);

    const buyer = await registerAndVerify(page, 'risky-buyer');
    await login(page, buyer);

    await page.goto(contactUrl);
    await page
      .getByLabel('Your message')
      .fill('Urgent — pay by bank transfer to me at scammer@example.com right now');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page).toHaveURL(/\/messages\/[0-9a-f-]{36}/);

    // Delivered AND flagged. Silently swallowing a message the sender believes
    // was sent is worse than either delivering it or refusing it.
    await expect(messages(page).getByText('pay by bank transfer', { exact: false })).toBeVisible();
    await expect(page.getByText('Awaiting review')).toBeVisible();
  });
});

test.describe('browser IDOR against conversations', () => {
  test('a stranger gets 404 for someone else’s thread', async ({ page, browser }) => {
    const { contactUrl } = await seedSellerAndListing(page, 'idor');
    await signOut(page);

    const buyer = await registerAndVerify(page, 'idor-buyer');
    await login(page, buyer);
    await page.goto(contactUrl);
    await page.getByLabel('Your message').fill('A private conversation');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page).toHaveURL(/\/messages\/[0-9a-f-]{36}/);
    const threadUrl = new URL(page.url()).pathname;
    const threadId = threadUrl.split('/').pop() ?? '';

    // ── a third party, in a clean browser ────────────────────────────────
    const context = await browser.newContext();
    const stranger = await context.newPage();
    const intruder = await registerAndVerify(stranger, 'idor-stranger');
    await login(stranger, intruder);

    const response = await stranger.goto(threadUrl);
    // 404, not 403: a 403 would confirm the thread exists.
    expect(response?.status()).toBe(404);
    await expect(stranger.getByText('A private conversation')).toHaveCount(0);

    // The inbox never lists it either.
    await stranger.goto('/en/dashboard/messages');
    await expect(stranger.getByRole('link', { name: /E2E idor listing/ })).toHaveCount(0);

    // ── and posting into it directly is refused ──────────────────────────
    const csrf =
      (await context.cookies()).find((entry) => entry.name === 'kurdora_csrf')?.value ?? '';
    const injected = await stranger.request.post(`/api/v1/conversations/${threadId}/messages`, {
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        origin: new URL(stranger.url()).origin,
        'sec-fetch-site': 'same-origin',
      },
      data: { body: 'Injected by a stranger' },
    });
    expect(injected.status()).toBe(404);

    const prisma = await e2ePrisma();
    try {
      // Nothing was written: participant injection is the attack this closes.
      const count = await prisma.message.count({
        where: { conversationId: threadId, body: 'Injected by a stranger' },
      });
      expect(count).toBe(0);
    } finally {
      await prisma.$disconnect();
    }

    await context.close();
  });
});

test.describe('offers', () => {
  test('a buyer offers, the seller accepts, and no money moves', async ({ page, browser }) => {
    const { contactUrl } = await seedSellerAndListing(page, 'offer');
    const sellerCookies = await page.context().cookies();
    await signOut(page);

    const buyer = await registerAndVerify(page, 'offer-buyer');
    await login(page, buyer);

    // ── the buyer makes an offer ─────────────────────────────────────────
    await page.goto(contactUrl);
    await page.getByLabel('Your offer in GBP').fill('900');
    await page.getByRole('button', { name: 'Send offer' }).click();

    await expect(page).toHaveURL(/\/en\/dashboard\/offers\/[0-9a-f-]{36}/);
    await expect(page.getByText('Awaiting the seller').first()).toBeVisible();
    // £900.00 typed as major units, stored and shown as minor units.
    await expect(page.getByText('£900.00')).toBeVisible();
    const offerId = page.url().split('/').pop() ?? '';

    // A buyer may withdraw, and may NOT accept their own offer.
    await expect(page.getByRole('button', { name: 'Withdraw' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0);

    // ── the seller accepts ───────────────────────────────────────────────
    const sellerContext = await browser.newContext();
    await sellerContext.addCookies(sellerCookies);
    const sellerPage = await sellerContext.newPage();

    await sellerPage.goto('/en/dashboard/offers');
    await sellerPage
      .getByRole('link', { name: /E2E offer listing/ })
      .first()
      .click();
    await expect(sellerPage.getByRole('button', { name: 'Accept' })).toBeVisible();
    // The seller is not offered the buyer's move.
    await expect(sellerPage.getByRole('button', { name: 'Withdraw' })).toHaveCount(0);

    await sellerPage.getByRole('button', { name: 'Accept' }).click();
    await expect(sellerPage.getByText('Accepted').first()).toBeVisible();

    const prisma = await e2ePrisma();
    try {
      const offer = await prisma.offer.findUniqueOrThrow({
        where: { id: offerId },
        select: { status: true, amountMinor: true, currency: true },
      });
      expect(offer.status).toBe('ACCEPTED');
      // Integer minor units, never a float.
      expect(offer.amountMinor).toBe(90_000n);
      expect(offer.currency).toBe('GBP');

      // Phase 6 collects no money. Accepting an offer records agreement and
      // nothing else — no order, no payment, no ledger entry, no payout.
      const events = await prisma.offerEvent.findMany({
        where: { offerId },
        orderBy: { createdAt: 'asc' },
        select: { fromStatus: true, toStatus: true, actorRole: true },
      });
      expect(events.map((event) => [event.fromStatus, event.toStatus])).toEqual([
        [null, 'SUBMITTED'],
        ['SUBMITTED', 'ACCEPTED'],
      ]);
      expect(events.map((event) => event.actorRole)).toEqual(['buyer', 'seller']);

      expect(
        await prisma.order.count({ where: { listing: { offers: { some: { id: offerId } } } } }),
      ).toBe(0);
    } finally {
      await prisma.$disconnect();
    }

    await sellerContext.close();
  });

  test('a seller cannot withdraw the buyer’s offer, even by forging the form', async ({
    page,
    browser,
  }) => {
    const { contactUrl } = await seedSellerAndListing(page, 'forge');
    const sellerCookies = await page.context().cookies();
    await signOut(page);

    const buyer = await registerAndVerify(page, 'forge-buyer');
    await login(page, buyer);
    await page.goto(contactUrl);
    await page.getByLabel('Your offer in GBP').fill('850');
    await page.getByRole('button', { name: 'Send offer' }).click();
    await expect(page).toHaveURL(/\/offers\/[0-9a-f-]{36}/);
    const offerId = page.url().split('/').pop() ?? '';

    const sellerContext = await browser.newContext();
    await sellerContext.addCookies(sellerCookies);
    const sellerPage = await sellerContext.newPage();
    await sellerPage.goto(`/en/dashboard/offers/${offerId}`);

    // The UI does not offer WITHDRAWN to a seller, so this goes at the API
    // with the seller's real session — the same thing a forged hidden field
    // would reach. The transition table refuses it, not the rendering.
    const csrf =
      (await sellerContext.cookies()).find((entry) => entry.name === 'kurdora_csrf')?.value ?? '';
    const forged = await sellerPage.request.post(`/api/v1/offers/${offerId}/status`, {
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        origin: new URL(sellerPage.url()).origin,
        'sec-fetch-site': 'same-origin',
      },
      data: { to: 'WITHDRAWN' },
    });
    expect(forged.status()).toBe(409);

    const prisma = await e2ePrisma();
    try {
      const offer = await prisma.offer.findUniqueOrThrow({ where: { id: offerId } });
      expect(offer.status).toBe('SUBMITTED');
    } finally {
      await prisma.$disconnect();
    }

    await sellerContext.close();
  });

  test('a buyer cannot reverse the seller’s decision', async ({ page, browser }) => {
    const { contactUrl } = await seedSellerAndListing(page, 'reverse');
    const sellerCookies = await page.context().cookies();
    await signOut(page);

    const buyer = await registerAndVerify(page, 'reverse-buyer');
    await login(page, buyer);
    await page.goto(contactUrl);
    await page.getByLabel('Your offer in GBP').fill('700');
    await page.getByRole('button', { name: 'Send offer' }).click();
    await expect(page).toHaveURL(/\/offers\/[0-9a-f-]{36}/);
    const offerUrl = new URL(page.url()).pathname;
    const offerId = offerUrl.split('/').pop() ?? '';

    // ── the seller declines ──────────────────────────────────────────────
    const sellerContext = await browser.newContext();
    await sellerContext.addCookies(sellerCookies);
    const sellerPage = await sellerContext.newPage();
    await sellerPage.goto(offerUrl);
    await sellerPage.getByRole('button', { name: 'Decline' }).click();
    await expect(sellerPage.getByText('Declined').first()).toBeVisible();

    // ── the buyer has nothing left to do ─────────────────────────────────
    await page.goto(offerUrl);
    await expect(page.getByText('Declined').first()).toBeVisible();
    await expect(page.getByText('There is nothing to do on this offer.')).toBeVisible();

    const csrf =
      (await page.context().cookies()).find((entry) => entry.name === 'kurdora_csrf')?.value ?? '';
    for (const to of ['ACCEPTED', 'SUBMITTED', 'WITHDRAWN']) {
      const attempt = await page.request.post(`/api/v1/offers/${offerId}/status`, {
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrf,
          origin: new URL(page.url()).origin,
          'sec-fetch-site': 'same-origin',
        },
        data: { to },
      });
      // DECLINED is terminal. The decision was the seller's and it stands.
      expect(attempt.status(), `buyer moving a declined offer to ${to}`).toBe(409);
    }

    const prisma = await e2ePrisma();
    try {
      expect((await prisma.offer.findUniqueOrThrow({ where: { id: offerId } })).status).toBe(
        'DECLINED',
      );
    } finally {
      await prisma.$disconnect();
    }

    await sellerContext.close();
  });

  test('a stranger gets 404 for someone else’s offer', async ({ page, browser }) => {
    const { contactUrl } = await seedSellerAndListing(page, 'offeridor');
    await signOut(page);

    const buyer = await registerAndVerify(page, 'offeridor-buyer');
    await login(page, buyer);
    await page.goto(contactUrl);
    await page.getByLabel('Your offer in GBP').fill('600');
    await page.getByRole('button', { name: 'Send offer' }).click();
    await expect(page).toHaveURL(/\/offers\/[0-9a-f-]{36}/);
    const offerUrl = new URL(page.url()).pathname;

    const context = await browser.newContext();
    const stranger = await context.newPage();
    const intruder = await registerAndVerify(stranger, 'offeridor-stranger');
    await login(stranger, intruder);

    const response = await stranger.goto(offerUrl);
    expect(response?.status()).toBe(404);
    await expect(stranger.getByText('£600.00')).toHaveCount(0);

    await stranger.goto('/en/dashboard/offers');
    await expect(stranger.getByRole('link', { name: /E2E offeridor listing/ })).toHaveCount(0);

    await context.close();
  });

  test('refuses an amount that is not money', async ({ page }) => {
    const { contactUrl } = await seedSellerAndListing(page, 'badamount');
    await signOut(page);

    const buyer = await registerAndVerify(page, 'badamount-buyer');
    await login(page, buyer);

    await page.goto(contactUrl);
    // Three decimal places is not a price, and the server says so rather than
    // rounding it into one.
    await page.getByLabel('Your offer in GBP').fill('900.999');
    await page.getByRole('button', { name: 'Send offer' }).click();

    await expect(page).toHaveURL(/\/messages\/new/);
    await expect(page.getByTestId('form-error')).toBeVisible();

    await page.getByLabel('Your offer in GBP').fill('0');
    await page.getByRole('button', { name: 'Send offer' }).click();
    await expect(page.getByTestId('form-error')).toBeVisible();
  });

  test('refuses a second open offer on the same listing', async ({ page }) => {
    const { contactUrl } = await seedSellerAndListing(page, 'double');
    await signOut(page);

    const buyer = await registerAndVerify(page, 'double-buyer');
    await login(page, buyer);

    await page.goto(contactUrl);
    await page.getByLabel('Your offer in GBP').fill('500');
    await page.getByRole('button', { name: 'Send offer' }).click();
    await expect(page).toHaveURL(/\/offers\/[0-9a-f-]{36}/);

    await page.goto(contactUrl);
    await page.getByLabel('Your offer in GBP').fill('550');
    await page.getByRole('button', { name: 'Send offer' }).click();

    // The rule lives in the database, and surfaces as a readable refusal
    // rather than a server error.
    await expect(page.getByTestId('form-error')).toBeVisible();
    await expect(page.getByText('already have an open offer', { exact: false })).toBeVisible();
  });
});

test.describe('reporting', () => {
  test('reports a thread without deleting anything', async ({ page }) => {
    const { contactUrl } = await seedSellerAndListing(page, 'report');
    await signOut(page);

    const buyer = await registerAndVerify(page, 'report-buyer');
    await login(page, buyer);

    await page.goto(contactUrl);
    await page.getByLabel('Your message').fill('Something suspicious happened here');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page).toHaveURL(/\/messages\/[0-9a-f-]{36}/);
    const threadId = new URL(page.url()).pathname.split('/').pop() ?? '';

    await page.getByText('Report this conversation').click();
    await page.getByLabel('What is wrong?').selectOption('scam');
    await page.getByLabel('Anything else we should know?').fill('Asked me to pay by transfer.');
    await page.getByRole('button', { name: 'Report' }).click();

    await expect(page.getByText('A reviewer will look at this', { exact: false })).toBeVisible();
    // The evidence is still there. A report that deletes the messages is
    // useless to the reviewer it was raised for.
    await expect(messages(page).getByText('Something suspicious happened here')).toBeVisible();

    const prisma = await e2ePrisma();
    try {
      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { id: threadId },
        select: { status: true, _count: { select: { messages: true } } },
      });
      expect(conversation.status).toBe('REPORTED');
      expect(conversation._count.messages).toBeGreaterThan(0);
    } finally {
      await prisma.$disconnect();
    }
  });
});
