import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { e2ePrisma } from './database';
import { createSellerProfile, login, reauthenticate, registerAndVerify } from './helpers';

/**
 * Browser-level security.
 *
 * These are the deliberate attacks: one signed-in seller trying to reach
 * another's listing, a forged CSRF token, a suspended account still holding a
 * valid-looking cookie. The API suites prove the guards in isolation; these
 * prove they survive a real browser and a real session.
 */

/** Creates a seller with one draft listing and returns its id. */
async function sellerWithListing(page: Page, prefix: string) {
  const user = await registerAndVerify(page, prefix);
  await login(page, user);
  await createSellerProfile(page, `${prefix} Co`);
  await reauthenticate(page);

  await page.goto('/en/dashboard/listings/new?category=mobile-electronics');
  await page.getByLabel('Title').fill(`${prefix} private listing`);
  await page
    .getByLabel('Description')
    .fill('A description long enough to satisfy the minimum length rule for listings.');
  await page.getByLabel('Price', { exact: false }).first().fill('12345');
  await page.getByLabel('Brand *').fill('Secret');
  await page.getByLabel('Model *').fill('Secret');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await page.waitForURL(/\/listings\/[0-9a-f-]{36}/);

  const listingId = page.url().split('/').pop()!;
  return { user, listingId };
}

test.describe('IDOR against another seller', () => {
  test("cannot open another seller's draft, and gets the same answer as a fake id", async ({
    browser,
  }) => {
    const victimContext = await browser.newContext();
    const victimPage = await victimContext.newPage();
    const victim = await sellerWithListing(victimPage, 'victim');
    await victimContext.close();

    const attackerContext = await browser.newContext();
    const attackerPage = await attackerContext.newPage();
    const attackerUser = await registerAndVerify(attackerPage, 'attacker');
    await login(attackerPage, attackerUser);
    await createSellerProfile(attackerPage, 'Attacker Co');
    await reauthenticate(attackerPage);

    // The victim's real listing id.
    const foreign = await attackerPage.goto(`/en/dashboard/listings/${victim.listingId}`);
    expect(foreign?.status()).toBe(404);
    expect(await attackerPage.content()).not.toContain('victim private listing');

    // A well-formed id that belongs to nobody.
    const absent = await attackerPage.goto(
      '/en/dashboard/listings/01a09150-0000-7000-8000-000000000000',
    );
    // Identical answer: the dashboard must not be an existence oracle.
    expect(absent?.status()).toBe(foreign?.status());

    await attackerContext.close();
  });

  test("cannot edit another seller's listing, by any route", async ({ browser }) => {
    const victimContext = await browser.newContext();
    const victimPage = await victimContext.newPage();
    const victim = await sellerWithListing(victimPage, 'victim2');
    await victimContext.close();

    const attackerContext = await browser.newContext();
    const attackerPage = await attackerContext.newPage();
    const attackerUser = await registerAndVerify(attackerPage, 'attacker2');
    await login(attackerPage, attackerUser);
    await createSellerProfile(attackerPage, 'Attacker2 Co');
    await reauthenticate(attackerPage);

    // ── attack 1: the API, with the attacker's real session and a VALID
    // CSRF token. This is the strongest form of the attack — everything is
    // legitimate except who owns the listing.
    const csrf =
      (await attackerContext.cookies()).find((c) => c.name === 'kurdora_csrf')?.value ?? '';
    const origin = new URL(attackerPage.url()).origin;

    const viaApi = await attackerPage.request.patch(`/api/v1/listings/${victim.listingId}`, {
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        origin,
        'sec-fetch-site': 'same-origin',
      },
      data: { title: 'HIJACKED VIA API' },
    });
    // 404, never 403: a 403 would confirm the listing exists.
    expect(viaApi.status()).toBe(404);

    // ── attack 2: rewrite the hidden listingId in the dashboard form.
    await attackerPage.goto('/en/dashboard/listings/new?category=mobile-electronics');
    await attackerPage.getByLabel('Title').fill('Attacker listing');
    await attackerPage
      .getByLabel('Description')
      .fill('A description long enough to satisfy the minimum length rule for listings.');
    await attackerPage.getByLabel('Price', { exact: false }).first().fill('100');
    await attackerPage.getByLabel('Brand *').fill('A');
    await attackerPage.getByLabel('Model *').fill('B');
    await attackerPage.getByRole('button', { name: 'Create draft' }).click();
    await attackerPage.waitForURL(/\/listings\/[0-9a-f-]{36}/);

    await attackerPage.evaluate((victimId) => {
      const input = document.querySelector<HTMLInputElement>('input[name="listingId"]');
      if (input) input.value = victimId;
    }, victim.listingId);

    await attackerPage.getByLabel('Title').fill('HIJACKED VIA FORM');
    await attackerPage.getByRole('button', { name: 'Save changes' }).click();
    // Either outcome is safe: the action refuses, or React restored the field
    // and the attacker merely edited their own listing. What matters is the
    // victim, asserted below — so this test cannot pass by accident.
    await attackerPage.waitForTimeout(1000);

    const prisma = await e2ePrisma();
    try {
      const row = await prisma.listing.findUnique({
        where: { id: victim.listingId },
        select: { title: true },
      });
      expect(row?.title).toBe('victim2 private listing');
    } finally {
      await prisma.$disconnect();
    }

    await attackerContext.close();
  });
});

test.describe('CSRF', () => {
  test('refuses a dashboard action when the CSRF token is tampered with', async ({ page }) => {
    const user = await registerAndVerify(page, 'csrf');
    await login(page, user);
    await createSellerProfile(page);
    await reauthenticate(page);

    await page.goto('/en/dashboard/profile');
    await page.getByLabel('Display name').fill('Should Not Save');

    // Rewrite the hidden CSRF field to a value that is not bound to this
    // session. Plain double-submit would accept a matching pair; the HMAC
    // binding is what refuses it.
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('input[name="_csrf"]');
      if (input) input.value = 'forged.token';
    });

    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByTestId('form-error')).toBeVisible();

    const prisma = await e2ePrisma();
    try {
      const profile = await prisma.sellerProfile.findFirst({
        where: { user: { email: user.email } },
        select: { displayName: true },
      });
      expect(profile?.displayName).not.toBe('Should Not Save');
    } finally {
      await prisma.$disconnect();
    }
  });

  test('refuses a cookie-authenticated API mutation with no CSRF token', async ({ page }) => {
    const user = await registerAndVerify(page, 'csrfapi');
    await login(page, user);

    // Cookies are attached automatically; the CSRF header is deliberately not.
    const response = await page.request.patch('/api/v1/me', {
      headers: { 'content-type': 'application/json' },
      data: { displayName: 'No CSRF' },
    });
    expect(response.status()).toBe(403);
  });
});

test.describe('suspended account', () => {
  test('is locked out of the dashboard immediately, not at token expiry', async ({ page }) => {
    const user = await registerAndVerify(page, 'suspended');
    await login(page, user);
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

    // Suspend the account behind the user's back, leaving their cookies valid
    // and unexpired. Account status is re-read from the database on every
    // request precisely so this takes effect at once.
    const prisma = await e2ePrisma();
    try {
      await prisma.user.update({ where: { email: user.email }, data: { status: 'SUSPENDED' } });
    } finally {
      await prisma.$disconnect();
    }

    await page.goto('/en/dashboard');
    await expect(page).toHaveURL(/\/en\/login/);
  });
});
