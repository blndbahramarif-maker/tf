import { serverEnv } from '@/infra/env';
import { DEFAULT_LOCALE } from '@kurdora/i18n';

/**
 * Where Stripe Checkout returns a seller to.
 *
 * Built from `APP_URL` on the SERVER and never accepted from a request: an
 * attacker who could name `success_url` would have Stripe redirect a seller
 * mid-payment to a page of their choosing, which is a credible phishing
 * primitive against someone who has just entered card details.
 *
 * Returning to the success URL proves NOTHING. It means the browser came back,
 * not that the payment settled. The listing becomes payable only when a
 * signature-verified webhook says so.
 */
export function subscriptionUrls(listingId: string): { success: string; cancel: string } {
  const base = serverEnv().APP_URL;
  const listing = `/${DEFAULT_LOCALE}/dashboard/listings/${listingId}`;
  return {
    success: new URL(`${listing}?billing=returned`, base).toString(),
    cancel: new URL(`${listing}?billing=cancelled`, base).toString(),
  };
}
