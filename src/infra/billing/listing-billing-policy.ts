import { prisma } from '@/infra/db/client';
import { listingMayBeVisible, type SubscriptionStatus } from '@/domain/billing/subscription-status';

/**
 * Whether a listing needs a paid Kurdora subscription to be visible, and
 * whether it currently has one.
 *
 * The requirement is a SETTING, not a constant: charging for listings is a
 * business decision that an admin turns on without a deploy, and it must
 * default to OFF so that enabling it is a deliberate act rather than something
 * that happens the moment this code ships.
 */

export const SUBSCRIPTION_REQUIRED_SETTING = 'listing.subscription_required';

export async function listingSubscriptionRequired(): Promise<boolean> {
  const setting = await prisma.setting.findFirst({
    where: { key: SUBSCRIPTION_REQUIRED_SETTING, scope: 'GLOBAL' },
    select: { value: true },
  });
  // Absent or non-boolean means OFF. A misconfigured setting must not silently
  // start taking listings down.
  return setting?.value === true;
}

export interface BillingGate {
  readonly required: boolean;
  readonly status: SubscriptionStatus | null;
  readonly allowed: boolean;
}

/**
 * The billing half of "may this listing be visible".
 *
 * Read from the DATABASE, never from a request: the status column is written
 * only by `applyProviderSubscription`, which only a signature-verified webhook
 * reaches. A seller who edits a form field, a hidden input, or an API payload
 * changes nothing here, because none of those are inputs to this function.
 */
export async function checkListingBilling(listingId: string): Promise<BillingGate> {
  const required = await listingSubscriptionRequired();
  if (!required) return { required: false, status: null, allowed: true };

  const subscription = await prisma.listingSubscription.findUnique({
    where: { listingId },
    select: { status: true },
  });

  const status = (subscription?.status ?? null) as SubscriptionStatus | null;
  return {
    required: true,
    status,
    allowed: listingMayBeVisible({ subscriptionRequired: true, status }),
  };
}
