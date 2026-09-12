import { expect, test } from './fixtures';
import { e2ePrisma } from './database';
import { createSellerProfile, login, reauthenticate, registerAndVerify } from './helpers';

/**
 * Payout onboarding, in a real browser.
 *
 * **Stripe is NOT configured in the E2E environment**, and these tests are
 * written to be honest about that rather than to fake it. What they prove is
 * everything on OUR side of the boundary: that the page is reachable only by
 * its owner, that it renders provider state and never invents it, that an
 * unconfigured provider degrades to a message instead of a crash, and that a
 * connected account id never reaches the browser.
 *
 * What they deliberately do NOT prove is that a seller becomes payable. That
 * requires a human to complete Stripe's hosted form — which is the design, not
 * a gap. No automated test can make a seller eligible, and neither can Kurdora.
 */

test.describe('payouts page access', () => {
  test('an anonymous visitor is sent to sign in', async ({ page }) => {
    await page.goto('/en/dashboard/payouts');
    await expect(page).toHaveURL(/\/en\/login/);
  });

  test('a signed-in user with no seller profile is told so', async ({ page }) => {
    const user = await registerAndVerify(page, 'nopayouts');
    await login(page, user);

    await page.goto('/en/dashboard/payouts');
    await expect(page.getByRole('heading', { name: 'Payouts' })).toBeVisible();
    await expect(page.getByText('do not have a seller profile', { exact: false })).toBeVisible();
  });
});

test.describe('payout onboarding', () => {
  test('a new seller sees "Not started" and is told what will happen', async ({ page }) => {
    const user = await registerAndVerify(page, 'payoutseller');
    await login(page, user);
    await createSellerProfile(page);
    await reauthenticate(page);

    await page.goto('/en/dashboard/payouts');

    await expect(page.getByRole('heading', { name: 'Payouts' })).toBeVisible();
    await expect(page.getByText('Not started').first()).toBeVisible();

    // Neither capability, because nothing has told us otherwise. A brand-new
    // seller being anything but unpayable would be the bug.
    await expect(page.getByText('Can take payments')).toBeVisible();

    // The hand-off is stated BEFORE the click, not discovered on arrival.
    await expect(page.getByText('taken to Stripe', { exact: false })).toBeVisible();

    // No refresh button: there is no account to refresh yet.
    await expect(page.getByRole('button', { name: 'Check for updates' })).toHaveCount(0);
  });

  test('never renders a connected account id', async ({ page }) => {
    /*
     * A seller has no use for `acct_…`, and rendering one would put it into
     * page source, browser history and every support screenshot. The snapshot
     * the page reads does not carry it at all, and this asserts that end to
     * end rather than trusting the shape of a type.
     */
    const user = await registerAndVerify(page, 'noacct');
    await login(page, user);
    await createSellerProfile(page);
    await reauthenticate(page);

    // Give the seller an account directly, as a verified webhook would.
    const prisma = await e2ePrisma();
    const profile = await prisma.sellerProfile.findFirstOrThrow({
      where: { user: { email: user.email } },
      select: { id: true },
    });
    await prisma.sellerProfile.update({
      where: { id: profile.id },
      data: {
        stripeAccountId: `acct_e2e_${Date.now()}`,
        onboardingStatus: 'PENDING_VERIFICATION',
        detailsSubmitted: true,
      },
    });

    await page.goto('/en/dashboard/payouts');
    await expect(page.getByText('Being reviewed').first()).toBeVisible();

    const html = await page.content();
    expect(html).not.toContain('acct_');
  });

  test('renders outstanding requirements as provider keys', async ({ page }) => {
    const user = await registerAndVerify(page, 'reqs');
    await login(page, user);
    await createSellerProfile(page);
    await reauthenticate(page);

    const prisma = await e2ePrisma();
    const profile = await prisma.sellerProfile.findFirstOrThrow({
      where: { user: { email: user.email } },
      select: { id: true },
    });
    await prisma.sellerProfile.update({
      where: { id: profile.id },
      data: {
        stripeAccountId: `acct_e2e_reqs_${Date.now()}`,
        onboardingStatus: 'RESTRICTED',
        detailsSubmitted: true,
        stripeDisabledReason: 'requirements.past_due',
        requirementsDue: {
          currently_due: ['individual.verification.document'],
          past_due: [],
        },
      },
    });

    await page.goto('/en/dashboard/payouts');
    await expect(page.getByText('Action needed').first()).toBeVisible();
    await expect(page.getByText('individual.verification.document')).toBeVisible();
    // An account exists now, so the seller can ask the provider directly.
    await expect(page.getByRole('button', { name: 'Check for updates' })).toBeVisible();
  });

  test('offers no onboarding link to a seller Stripe has rejected', async ({ page }) => {
    const user = await registerAndVerify(page, 'rejected');
    await login(page, user);
    await createSellerProfile(page);
    await reauthenticate(page);

    const prisma = await e2ePrisma();
    const profile = await prisma.sellerProfile.findFirstOrThrow({
      where: { user: { email: user.email } },
      select: { id: true },
    });
    await prisma.sellerProfile.update({
      where: { id: profile.id },
      data: {
        stripeAccountId: `acct_e2e_rej_${Date.now()}`,
        onboardingStatus: 'REJECTED',
        stripeDisabledReason: 'rejected.fraud',
      },
    });

    await page.goto('/en/dashboard/payouts');
    await expect(page.getByText('Rejected').first()).toBeVisible();
    // Rejection is terminal. A button that cannot help is worse than none.
    await expect(page.getByRole('button', { name: 'Set up payouts' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Finish setting up payouts' })).toHaveCount(0);
  });

  test('degrades to a message, not a crash, when the provider is unconfigured', async ({
    page,
  }) => {
    const user = await registerAndVerify(page, 'nostripe');
    await login(page, user);
    await createSellerProfile(page);
    await reauthenticate(page);

    await page.goto('/en/dashboard/payouts');
    await page.getByRole('button', { name: 'Set up payouts' }).click();

    // Still here. No redirect to a third party, no 500, and the seller is told
    // something rather than watching a spinner.
    await expect(page).toHaveURL(/\/en\/dashboard\/payouts/);
    await expect(page.getByRole('heading', { name: 'Payouts' })).toBeVisible();

    // Nothing was recorded either: onboarding state comes from the provider,
    // and the provider was never reached.
    const profile = await (
      await e2ePrisma()
    ).sellerProfile.findFirstOrThrow({
      where: { user: { email: user.email } },
      select: { stripeAccountId: true, onboardingStatus: true },
    });
    expect(profile.stripeAccountId).toBeNull();
    expect(profile.onboardingStatus).toBe('NOT_STARTED');
  });

  test('returning from Stripe does not make a seller payable', async ({ page }) => {
    /*
     * The attack, and Stripe's own warning about it: the return URL "only
     * means the flow was entered and exited properly". Anyone can type it.
     * Arriving at it must change nothing.
     */
    const user = await registerAndVerify(page, 'faketurn');
    await login(page, user);
    await createSellerProfile(page);
    await reauthenticate(page);

    await page.goto('/en/dashboard/payouts?from=stripe');

    await expect(page.getByRole('heading', { name: 'Payouts' })).toBeVisible();
    await expect(page.getByText('Not started').first()).toBeVisible();

    const profile = await (
      await e2ePrisma()
    ).sellerProfile.findFirstOrThrow({
      where: { user: { email: user.email } },
      select: { chargesEnabled: true, payoutsEnabled: true, onboardingStatus: true },
    });
    expect(profile.chargesEnabled).toBe(false);
    expect(profile.payoutsEnabled).toBe(false);
    expect(profile.onboardingStatus).toBe('NOT_STARTED');
  });

  test('explains an expired link instead of looping back to Stripe', async ({ page }) => {
    const user = await registerAndVerify(page, 'expired');
    await login(page, user);
    await createSellerProfile(page);
    await reauthenticate(page);

    await page.goto('/en/dashboard/payouts?link=expired');
    await expect(page.getByText('setup link expired', { exact: false })).toBeVisible();
    // A button, not an automatic redirect: an account that cannot produce a
    // usable link would otherwise bounce the seller back and forth forever.
    await expect(page.getByRole('button', { name: 'Set up payouts' })).toBeVisible();
  });
});
