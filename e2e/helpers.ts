import { expect, type Page, type BrowserContext } from '@playwright/test';

/**
 * Shared E2E helpers.
 *
 * Every helper drives the REAL UI — filling the real form, clicking the real
 * button. None of them reach into the database to fabricate a session, because
 * a fabricated session would skip exactly the code these tests exist to prove.
 */

export const PASSWORD = 'correct horse battery staple';

export function uniqueEmail(prefix = 'e2e'): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
}

export interface RegisteredUser {
  readonly email: string;
  readonly password: string;
}

/**
 * Registers through the UI and completes email verification.
 *
 * The verification token is surfaced by the register endpoint outside
 * production, which is how the flow completes without a mailbox. The test
 * reads it from the page exactly as a developer would.
 */
export async function registerAndVerify(page: Page, prefix = 'e2e'): Promise<RegisteredUser> {
  const email = uniqueEmail(prefix);

  await page.goto('/en/register');
  await page.getByLabel('Your name').fill('E2E Seller');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: false }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();

  const token = page.getByTestId('dev-verification-token');
  await expect(token).toBeVisible();
  const verificationToken = (await token.textContent())?.trim() ?? '';
  expect(verificationToken.length).toBeGreaterThan(10);

  await page.goto(`/en/verify-email?token=${encodeURIComponent(verificationToken)}`);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/en\/login\?verified=1/);

  return { email, password: PASSWORD };
}

export async function login(page: Page, user: RegisteredUser, next?: string): Promise<void> {
  await page.goto(next ? `/en/login?next=${encodeURIComponent(next)}` : '/en/login');
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: false }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  /*
   * Wait for a definite outcome before returning. Without this the helper
   * races the server action: the caller runs while the Set-Cookie response is
   * still in flight, and the next request goes out unauthenticated. That
   * produced a 401 that looked like an auth bug and was a test bug.
   *
   * A failed login is a legitimate outcome here too, so this waits for EITHER
   * the redirect away from the login page or a rendered error.
   */
  await Promise.race([
    page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 }),
    page.getByTestId('form-error').waitFor({ state: 'visible', timeout: 15_000 }),
  ]);
}

/** Reads a cookie by name from the browser context. */
export async function cookie(context: BrowserContext, name: string) {
  const cookies = await context.cookies();
  return cookies.find((entry) => entry.name === name);
}

/**
 * Gives the signed-in user a seller profile, through the real API.
 *
 * Registration creates a buyer. Becoming a seller is a separate, deliberate
 * step, and Phase 5 does not ship a browser flow for it — so the test uses the
 * documented API endpoint with the browser's own cookie, which is exactly what
 * a seller would do today.
 */
export async function createSellerProfile(
  page: Page,
  displayName = 'E2E Seller Co',
): Promise<void> {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'kurdora_csrf')?.value ?? '';

  const response = await page.request.post('/api/v1/seller-profiles', {
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrf,
      // Same-origin, so the CSRF origin and Sec-Fetch-Site checks both pass.
      origin: new URL(page.url()).origin,
      'sec-fetch-site': 'same-origin',
    },
    data: { displayName, sellerType: 'INDIVIDUAL', countryCode: 'GB' },
  });
  expect(response.status(), await response.text()).toBe(201);

  // The seller role is granted at profile creation, so the session must be
  // refreshed before its token carries the new permissions.
  await page.goto('/en/dashboard');
}

/**
 * Refreshes the session so the access token picks up newly granted roles.
 *
 * Dropping the access cookie forces the refresh bounce, and `createSession`
 * re-reads roles and permissions from the database when it rotates — so the
 * new token carries `listing:create` without a sign-out/sign-in round trip.
 *
 * Signing out and back in also works but races the logout redirect, and the
 * login page redirects an authenticated visitor straight back to the
 * dashboard, so the race fails confusingly.
 */
export async function reauthenticate(page: Page): Promise<void> {
  const context = page.context();
  const kept = (await context.cookies()).filter((entry) => entry.name !== 'kurdora_at');
  await context.clearCookies();
  await context.addCookies(kept);

  await page.goto('/en/dashboard');
  await page.waitForURL(/\/en\/dashboard/);
}

/** A minimal PNG, generated in-process so no fixture file is needed. */
export function tinyPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
}

/**
 * Creates and PUBLISHES a listing, through the real dashboard.
 *
 * Messaging and offers both need a live listing to act on, and "live" is a
 * state the seller reaches by going through the whole flow — draft, photo,
 * publish. Fabricating the row would skip the publish guard these tests sit
 * on top of.
 *
 * Returns the listing's public URL, because that is where a buyer starts.
 */
export async function publishListing(page: Page, title: string): Promise<string> {
  await page.goto('/en/dashboard/listings/new?category=mobile-electronics');
  await page.getByLabel('Title').fill(title);
  await page
    .getByLabel('Description')
    .fill('A description long enough to satisfy the minimum length rule for listings.');
  await page.getByLabel('Price', { exact: false }).first().fill('100000');
  await page.getByLabel('Brand *').fill('Apple');
  await page.getByLabel('Model *').fill('iPhone 15');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/en\/dashboard\/listings\/[0-9a-f-]{36}/);

  const listingId = /listings\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
  expect(listingId).not.toBe('');

  await page.getByLabel('Add a photo').setInputFiles({
    name: 'probe.png',
    mimeType: 'image/png',
    buffer: tinyPng(),
  });
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByText('Main photo', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Live', { exact: false }).first()).toBeVisible();

  return `/en/dashboard/messages/new?listing=${listingId}`;
}

/** Signs out, clearing every session cookie the browser holds. */
export async function signOut(page: Page): Promise<void> {
  await page.goto('/en/dashboard');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL((url) => !url.pathname.includes('/dashboard'), { timeout: 15_000 });
}
