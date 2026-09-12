import { serverEnv } from '@/infra/env';
import { DEFAULT_LOCALE } from '@kurdora/i18n';

/**
 * Where Stripe sends a seller back to.
 *
 * Both URLs are built from `APP_URL` on the SERVER. Neither is ever accepted
 * from a request: an attacker who could name the `return_url` would have
 * Stripe redirect a seller mid-onboarding to a page of their choosing, which
 * is a credible phishing primitive against exactly the people we are asking
 * for identity documents.
 *
 * They carry the default locale rather than the seller's. The alternative is
 * threading a locale through the account-link call, and the payouts page
 * redirects to the reader's own locale on arrival anyway — a one-hop cost
 * against a URL that must be predictable for the reason above.
 */

export const PAYOUTS_PATH = `/${DEFAULT_LOCALE}/dashboard/payouts`;

/**
 * Where the seller lands when the flow was entered and exited properly.
 *
 * Stripe is explicit that this "doesn't mean that all information has been
 * collected, or that there are no outstanding requirements on the account",
 * so the marker below is a cue to RE-READ the account — never evidence.
 */
export function connectReturnUrl(): string {
  return new URL(`${PAYOUTS_PATH}?from=stripe`, serverEnv().APP_URL).toString();
}

/**
 * Where the seller lands when the link expired or was already used.
 *
 * Stripe's own guidance is that this URL should trigger a new Account Link.
 * The page does NOT do that automatically: an account stuck in a state that
 * cannot produce a usable link would then bounce the seller between Stripe and
 * us forever. It renders a button instead — one extra click, no loop.
 */
export function connectRefreshUrl(): string {
  return new URL(`${PAYOUTS_PATH}?link=expired`, serverEnv().APP_URL).toString();
}
