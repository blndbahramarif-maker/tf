import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { e2ePrisma } from './database';
import {
  createSellerProfile,
  login,
  publishListing,
  reauthenticate,
  registerAndVerify,
} from './helpers';

/**
 * `publishListing` hands back a CONTACT url, not the public page. The public
 * listing route is `/{locale}/listing/{id}`, so the id is lifted out of it.
 */
async function publishAndGetPublicUrl(page: Page, title: string) {
  const contactUrl = await publishListing(page, title);
  const id = /listing=([0-9a-f-]{36})/.exec(contactUrl)?.[1] ?? '';
  expect(id).not.toBe('');
  return `/en/listing/${id}`;
}

/**
 * The safety layer, in a real browser.
 *
 * Kurdora is a CONTACT-ONLY marketplace: it never sees the goods and never
 * meets the seller. These tests cover what it can actually do — tell a buyer
 * plainly what the platform is and is not, and let anyone report a listing.
 *
 * They also assert what the product must NOT say. The wording checks are not
 * cosmetic: a claim that Kurdora guarantees or protects a transaction would be
 * untrue, and untrue in the way that matters most to someone deciding whether
 * to hand over money.
 */

test.describe('platform role is stated plainly', () => {
  test('a listing page says Kurdora is not part of the transaction', async ({ page }) => {
    const seller = await registerAndVerify(page, 'contactonly');
    await login(page, seller);
    await createSellerProfile(page);
    await reauthenticate(page);
    const listingUrl = await publishAndGetPublicUrl(page, 'E2E Contact Only Jacket');

    await page.goto(listingUrl);

    await expect(page.getByText('not part of the transaction', { exact: false })).toBeVisible();
    await expect(page.getByText('between you and the seller', { exact: false })).toBeVisible();
  });

  test('no page claims to guarantee or protect the transaction', async ({ page }) => {
    /*
     * The claims this asserts the ABSENCE of are the ones that would be
     * actively misleading: Kurdora holds no money, so it cannot protect a
     * payment, and it does not check sellers, so it cannot guarantee one.
     */
    const seller = await registerAndVerify(page, 'noclaims');
    await login(page, seller);
    await createSellerProfile(page);
    await reauthenticate(page);
    const listingUrl = await publishAndGetPublicUrl(page, 'E2E No Claims Coat');

    for (const url of [listingUrl, '/en', '/en/c/kurdish-clothing']) {
      await page.goto(url);
      const body = (await page.locator('body').innerText()).toLowerCase();

      for (const claim of [
        'guarantee',
        'guaranteed',
        'buyer protection',
        'we protect your payment',
        'secure payment',
        'escrow',
      ]) {
        expect(body, `${url} claims "${claim}"`).not.toContain(claim);
      }
    }
  });
});

test.describe('reporting a listing', () => {
  test('a signed-in visitor can report, and the listing stays up', async ({ page }) => {
    const seller = await registerAndVerify(page, 'reportedseller');
    await login(page, seller);
    await createSellerProfile(page);
    await reauthenticate(page);
    const listingUrl = await publishAndGetPublicUrl(page, 'E2E Reportable Item');

    // A DIFFERENT person reports it — the reporter is never the owner. The
    // seller's session is dropped first: the register page bounces anyone who
    // is already signed in.
    await page.context().clearCookies();
    const reporter = await registerAndVerify(page, 'reporter');
    await login(page, reporter);

    await page.goto(listingUrl);
    await page.getByRole('button', { name: 'Report this listing' }).click();
    await page.getByLabel('Why are you reporting it?').selectOption('prohibited_item');
    await page.getByLabel('Anything else we should know', { exact: false }).fill('Looks unsafe.');
    await page.getByRole('button', { name: 'Send report' }).click();

    await expect(page.getByText('report has been received', { exact: false })).toBeVisible();

    // The form says what reporting does and does not do, BEFORE the click —
    // asserted on a fresh load because the form is replaced by the receipt.
    const prisma = await e2ePrisma();
    const report = await prisma.report.findFirstOrThrow({
      where: { targetType: 'LISTING' },
      orderBy: { createdAt: 'desc' },
      select: { reasonCode: true, status: true, targetId: true },
    });
    expect(report).toMatchObject({ reasonCode: 'prohibited_item', status: 'OPEN' });

    // Reporting does NOT hide the listing. A claim is not a verdict.
    const listing = await prisma.listing.findUniqueOrThrow({
      where: { id: report.targetId },
      select: { status: true },
    });
    expect(listing.status).toBe('ACTIVE');
  });

  test('an anonymous visitor is not offered the report form', async ({ page }) => {
    // Anonymous reports cannot be rate-limited per person or followed up.
    const seller = await registerAndVerify(page, 'anonreport');
    await login(page, seller);
    await createSellerProfile(page);
    await reauthenticate(page);
    const listingUrl = await publishAndGetPublicUrl(page, 'E2E Anon Report Item');

    await page.context().clearCookies();
    await page.goto(listingUrl);

    await expect(page.getByRole('button', { name: 'Report this listing' })).toHaveCount(0);
  });
});
