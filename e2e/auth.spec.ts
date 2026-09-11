import { expect, test } from './fixtures';
import { cookie, login, registerAndVerify, uniqueEmail, PASSWORD } from './helpers';
import { e2ePrisma } from './database';

/**
 * Authentication, end to end in a real browser.
 *
 * The security assertions here are the ones that cannot be made anywhere else:
 * a unit test can prove a cookie is built with `HttpOnly`, but only a browser
 * can prove that `document.cookie` genuinely cannot see it.
 */

test.describe('registration and verification', () => {
  test('registers, verifies, and can then sign in', async ({ page }) => {
    const user = await registerAndVerify(page, 'reg');
    await login(page, user);
    await expect(page).toHaveURL(/\/en\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  });

  test('a duplicate registration is indistinguishable and creates no second account', async ({
    page,
  }) => {
    const user = await registerAndVerify(page, 'dupe');

    await page.goto('/en/register');
    await page.getByLabel('Your name').fill('Impostor');
    await page.getByLabel('Email address').fill(user.email);
    await page.getByLabel('Password', { exact: false }).fill(PASSWORD);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Create account' }).click();

    /*
     * The response is deliberately the SAME "check your email" screen a new
     * address gets, and carries no verification token. Showing "that email is
     * taken" would turn registration into an account-enumeration oracle, so
     * the absence of an error here is the correct behaviour, not a gap.
     */
    await expect(page.getByText('Check your email', { exact: false })).toBeVisible();
    await expect(page.getByTestId('dev-verification-token')).toHaveCount(0);

    // What must NOT happen: a second account, or the impostor's password
    // replacing the real one.
    const prisma = await e2ePrisma();
    try {
      const accounts = await prisma.user.count({ where: { email: user.email } });
      expect(accounts).toBe(1);
    } finally {
      await prisma.$disconnect();
    }
  });

  test('rejects a bad verification token', async ({ page }) => {
    await page.goto('/en/verify-email?token=not-a-real-token');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByTestId('form-error')).toBeVisible();
  });
});

test.describe('login', () => {
  test('rejects a wrong password without revealing whether the account exists', async ({
    page,
  }) => {
    const user = await registerAndVerify(page, 'wrongpw');

    await page.goto('/en/login');
    await page.getByLabel('Email address').fill(user.email);
    await page.getByLabel('Password', { exact: false }).fill('completely wrong password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Wait for the alert to actually render before reading it; reading
    // immediately after the click races the server action's response.
    await expect(page.getByTestId('form-error')).toBeVisible();
    const knownAccount = (await page.getByTestId('form-error').textContent())?.trim();
    expect(knownAccount).toBeTruthy();

    await page.goto('/en/login');
    await page.getByLabel('Email address').fill(uniqueEmail('nobody'));
    await page.getByLabel('Password', { exact: false }).fill('completely wrong password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByTestId('form-error')).toBeVisible();
    const unknownAccount = (await page.getByTestId('form-error').textContent())?.trim();

    // The same message for "wrong password" and "no such account". A different
    // one would let anyone enumerate which addresses are registered.
    expect(unknownAccount).toBe(knownAccount);
  });

  test('honours a safe next parameter', async ({ page }) => {
    const user = await registerAndVerify(page, 'next');
    await login(page, user, '/en/dashboard/listings');
    await expect(page).toHaveURL(/\/en\/dashboard\/listings/);
  });

  test('refuses to redirect off-site after login', async ({ page }) => {
    const user = await registerAndVerify(page, 'openredir');
    await page.goto(`/en/login?next=${encodeURIComponent('https://evil.test/steal')}`);
    await page.getByLabel('Email address').fill(user.email);
    await page.getByLabel('Password', { exact: false }).fill(user.password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Lands on our own dashboard, never on evil.test.
    await expect(page).toHaveURL(/localhost.*\/en\/dashboard/);
  });
});

test.describe('session cookies', () => {
  test('stores NOTHING in localStorage or sessionStorage', async ({ page }) => {
    const user = await registerAndVerify(page, 'storage');
    await login(page, user);
    await expect(page).toHaveURL(/\/en\/dashboard/);

    const storage = await page.evaluate(() => ({
      local: Object.entries({ ...window.localStorage }),
      session: Object.entries({ ...window.sessionStorage }),
    }));

    // The entire point of the cookie transport. If this ever fails, an XSS
    // anywhere on the origin becomes a permanent account takeover.
    expect(storage.local).toEqual([]);
    expect(storage.session).toEqual([]);
  });

  test('marks the access and refresh cookies HttpOnly, invisible to script', async ({
    page,
    context,
  }) => {
    const user = await registerAndVerify(page, 'httponly');
    await login(page, user);
    await expect(page).toHaveURL(/\/en\/dashboard/);

    const access = await cookie(context, 'kurdora_at');
    const refresh = await cookie(context, 'kurdora_rt');
    const csrf = await cookie(context, 'kurdora_csrf');

    expect(access?.httpOnly).toBe(true);
    expect(refresh?.httpOnly).toBe(true);
    // The CSRF token is deliberately readable — it is echoed back by forms and
    // is not a credential.
    expect(csrf?.httpOnly).toBe(false);

    expect(access?.sameSite).toBe('Lax');
    // The refresh token is the valuable one: never sent cross-site at all.
    expect(refresh?.sameSite).toBe('Strict');
    // And scoped to the only path that consumes it.
    expect(refresh?.path).toBe('/api/v1/auth');

    const visible = await page.evaluate(() => document.cookie);
    expect(visible).not.toContain('kurdora_at');
    expect(visible).not.toContain('kurdora_rt');
  });

  test('never renders a token into the HTML', async ({ page, context }) => {
    const user = await registerAndVerify(page, 'noleak');
    await login(page, user);
    await expect(page).toHaveURL(/\/en\/dashboard/);

    const access = (await cookie(context, 'kurdora_at'))?.value ?? 'missing';
    const refresh = (await cookie(context, 'kurdora_rt'))?.value ?? 'missing';

    const html = await page.content();
    expect(html).not.toContain(access);
    expect(html).not.toContain(refresh);
    // The CSRF token IS in the page, by design.
    await expect(page.getByTestId('csrf-present')).toHaveText('yes');
  });
});

test.describe('logout', () => {
  test('clears cookies and locks the dashboard again', async ({ page, context }) => {
    const user = await registerAndVerify(page, 'logout');
    await login(page, user);
    await expect(page).toHaveURL(/\/en\/dashboard/);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/en$/);

    expect(await cookie(context, 'kurdora_at')).toBeUndefined();
    expect(await cookie(context, 'kurdora_rt')).toBeUndefined();

    await page.goto('/en/dashboard');
    await expect(page).toHaveURL(/\/en\/login/);
  });
});

test.describe('session refresh', () => {
  test('recovers the session when only the access cookie is gone', async ({ page, context }) => {
    const user = await registerAndVerify(page, 'refresh');
    await login(page, user);
    await expect(page).toHaveURL(/\/en\/dashboard/);

    const before = (await cookie(context, 'kurdora_rt'))?.value;

    // Simulate the access token expiring: drop it, keep the refresh cookie.
    const kept = (await context.cookies()).filter((c) => c.name !== 'kurdora_at');
    await context.clearCookies();
    await context.addCookies(kept);

    await page.goto('/en/dashboard');
    // Bounced through the refresh route and back, still signed in.
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

    const after = (await cookie(context, 'kurdora_rt'))?.value;
    // Rotation: the refresh token must be a NEW value, not the one presented.
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);
  });

  test('a replayed refresh token kills the whole session family', async ({ page, context }) => {
    const user = await registerAndVerify(page, 'reuse');
    await login(page, user);
    await expect(page).toHaveURL(/\/en\/dashboard/);

    const stolen = (await cookie(context, 'kurdora_rt'))?.value;
    expect(stolen).toBeTruthy();

    // Force one legitimate rotation.
    const kept = (await context.cookies()).filter((c) => c.name !== 'kurdora_at');
    await context.clearCookies();
    await context.addCookies(kept);
    await page.goto('/en/dashboard');
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

    // Now replay the OLD token, as a thief with a stolen cookie would.
    await context.clearCookies();
    await context.addCookies([
      {
        name: 'kurdora_rt',
        value: stolen!,
        domain: 'localhost',
        path: '/api/v1/auth',
        httpOnly: true,
        secure: false,
        sameSite: 'Strict',
      },
    ]);

    await page.goto('/en/dashboard');
    // Reuse detected: the family is revoked and the browser is signed out.
    await expect(page).toHaveURL(/\/en\/login/);
  });
});
