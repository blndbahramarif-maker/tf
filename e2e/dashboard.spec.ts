import { expect, test } from './fixtures';
import { e2ePrisma } from './database';
import { createSellerProfile, login, reauthenticate, registerAndVerify, tinyPng } from './helpers';

/**
 * Seller dashboard, end to end.
 *
 * Covers the listing lifecycle a seller actually performs in the browser:
 * create a draft, add a photo, publish, pause. Each step goes through the real
 * Server Action, the real CSRF check and the real ownership check.
 */

test.describe('dashboard access', () => {
  test('an anonymous visitor is sent to sign in', async ({ page }) => {
    await page.goto('/en/dashboard');
    await expect(page).toHaveURL(/\/en\/login/);
  });

  test('a signed-in user without a seller profile is told what to do', async ({ page }) => {
    const user = await registerAndVerify(page, 'nobiz');
    await login(page, user);
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await expect(page.getByText('You need a seller profile', { exact: false })).toBeVisible();
  });

  test('a seller sees their overview', async ({ page }) => {
    const user = await registerAndVerify(page, 'seller');
    await login(page, user);
    await createSellerProfile(page);
    await reauthenticate(page);

    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'New listing' }).first()).toBeVisible();
  });
});

test.describe('listing lifecycle', () => {
  test('creates a draft, adds a photo, publishes, then pauses', async ({ page }) => {
    const user = await registerAndVerify(page, 'lifecycle');
    await login(page, user);
    await createSellerProfile(page);
    await reauthenticate(page);

    // ── create ───────────────────────────────────────────────────────────
    await page.goto('/en/dashboard/listings/new');
    // Scoped to the page body: the site header carries the same category link.
    await page.getByRole('main').getByRole('link', { name: 'Mobile & Electronics' }).click();
    await expect(page).toHaveURL(/category=mobile-electronics/);

    await page.getByLabel('Title').fill('E2E iPhone 14 Pro');
    await page
      .getByLabel('Description')
      .fill('A description long enough to satisfy the minimum length rule for listings.');
    await page.getByLabel('Price', { exact: false }).first().fill('64999');
    await page.getByLabel('Brand *').fill('Apple');
    await page.getByLabel('Model *').fill('iPhone 14 Pro');
    await page.getByRole('button', { name: 'Create draft' }).click();

    await expect(page).toHaveURL(/\/en\/dashboard\/listings\/[0-9a-f-]{36}/);
    await expect(page.getByText('Draft', { exact: false }).first()).toBeVisible();
    const listingUrl = page.url();

    // ── publishing is refused with no photo ──────────────────────────────
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('check the details', { exact: false }).first()).toBeVisible();

    // ── add a photo ──────────────────────────────────────────────────────
    await page.getByLabel('Add a photo').setInputFiles({
      name: 'probe.png',
      mimeType: 'image/png',
      buffer: tinyPng(),
    });
    await page.getByRole('button', { name: 'Upload' }).click();
    // The FIRST image becomes primary automatically, so it renders as the main
    // photo rather than carrying a "Ready" status label.
    // Exact: getByText is substring and case-insensitive by default, so a
    // loose match also hits the "Use as the main photo" checkbox label.
    await expect(page.getByText('Main photo', { exact: true })).toBeVisible();
    await expect(page.getByTestId('form-error')).toHaveCount(0);

    // ── publish ──────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Live', { exact: false }).first()).toBeVisible();

    // ── a live listing cannot be edited in place ─────────────────────────
    await expect(page.getByText('Pause this listing to edit', { exact: false })).toBeVisible();

    // ── pause ────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText('Paused', { exact: false }).first()).toBeVisible();

    // ── edit, now that it is paused ──────────────────────────────────────
    await page.goto(listingUrl);
    await page.getByLabel('Title').fill('E2E iPhone 14 Pro — revised');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Changes saved', { exact: false })).toBeVisible();
  });

  test('shows validation errors rather than saving bad input', async ({ page }) => {
    const user = await registerAndVerify(page, 'validation');
    await login(page, user);
    await createSellerProfile(page);
    await reauthenticate(page);

    await page.goto('/en/dashboard/listings/new?category=mobile-electronics');
    await page.getByLabel('Title').fill('Valid title here');
    await page
      .getByLabel('Description')
      .fill('A description long enough to satisfy the minimum length rule for listings.');
    await page.getByLabel('Price', { exact: false }).first().fill('64999');
    await page.getByLabel('Brand *').fill('Apple');
    await page.getByLabel('Model *').fill('iPhone');
    // Out of range: storage_gb is capped at 8192 by its attribute definition.
    await page.getByLabel('Storage (GB)').fill('999999');
    await page.getByRole('button', { name: 'Create draft' }).click();

    await expect(page.getByTestId('form-error')).toBeVisible();
    // Still on the form — nothing was created.
    await expect(page).toHaveURL(/listings\/new/);
  });

  test('refuses an upload that is not an image', async ({ page }) => {
    const user = await registerAndVerify(page, 'badupload');
    await login(page, user);
    await createSellerProfile(page);
    await reauthenticate(page);

    await page.goto('/en/dashboard/listings/new?category=mobile-electronics');
    await page.getByLabel('Title').fill('Upload probe listing');
    await page
      .getByLabel('Description')
      .fill('A description long enough to satisfy the minimum length rule for listings.');
    await page.getByLabel('Price', { exact: false }).first().fill('1000');
    await page.getByLabel('Brand *').fill('Probe');
    await page.getByLabel('Model *').fill('Probe');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/listings\/[0-9a-f-]{36}/);

    // An SVG is a script container, not a photograph. The accept attribute is
    // a hint the browser applies; the SERVER is what must refuse it.
    await page.getByLabel('Add a photo').setInputFiles({
      name: 'evil.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
    });
    await page.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByTestId('form-error')).toBeVisible();
  });
});

test.describe('seller profile', () => {
  test('updates the display name', async ({ page }) => {
    const user = await registerAndVerify(page, 'profile');
    await login(page, user);
    await createSellerProfile(page);
    await reauthenticate(page);

    await page.goto('/en/dashboard/profile');
    await page.getByLabel('Display name').fill('Renamed Seller Co');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Profile saved', { exact: false })).toBeVisible();

    const prisma = await e2ePrisma();
    try {
      const profile = await prisma.sellerProfile.findFirst({
        where: { user: { email: user.email } },
        select: { displayName: true },
      });
      expect(profile?.displayName).toBe('Renamed Seller Co');
    } finally {
      await prisma.$disconnect();
    }
  });
});

test.describe('security page', () => {
  test('lists the current session and marks this device', async ({ page }) => {
    const user = await registerAndVerify(page, 'security');
    await login(page, user);

    await page.goto('/en/dashboard/security');
    await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible();
    await expect(page.getByText('This device')).toBeVisible();
    await expect(page.getByText('Email verified')).toBeVisible();
  });
});
