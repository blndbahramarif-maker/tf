/**
 * Creates a Stripe TEST MODE Product and Price for the Kurdora listing
 * subscription, and links it to the plan row.
 *
 * Why a script rather than Dashboard instructions: the Price must MATCH the
 * plan row's amount, currency and interval, and a human copying four values
 * between two systems gets one wrong eventually. Here the plan row is the
 * source of truth and the Price is derived from it.
 *
 * ### TEST MODE ONLY, enforced twice.
 *
 * `requireStripeConfig()` refuses a `sk_live_` key outright
 * (`LIVE_MODE_PERMITTED = false`), and this script refuses to run unless the
 * resolved mode is `test`. It is not possible to point it at live mode.
 *
 *   pnpm stripe:setup-test-plan
 *
 * Idempotent: re-running finds the existing Price by its lookup key rather
 * than creating a second one.
 */
import Stripe from 'stripe';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const PLAN_KEY = 'listing_monthly';
/** Stable across re-runs, so this script can find what it made last time. */
const LOOKUP_KEY = 'kurdora_listing_monthly';

async function main(): Promise<void> {
  const { requireStripeConfig } = await import('../src/infra/stripe/config');
  const { STRIPE_API_VERSION } = await import('../src/infra/stripe/gateway');

  const config = requireStripeConfig();
  if (config.mode !== 'test') {
    // Belt and braces. `requireStripeConfig` already refuses a live key, but
    // this script CREATES billing objects and must never do so in live mode.
    throw new Error(`Refusing to run: Stripe mode is "${config.mode}", not "test".`);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const stripe = new Stripe(config.secretKey, {
    apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
  });

  try {
    const plan = await prisma.servicePlan.findUnique({ where: { key: PLAN_KEY } });
    if (plan === null) {
      throw new Error(`No service_plans row with key "${PLAN_KEY}". Run pnpm db:deploy first.`);
    }

    console.log(
      `Plan "${plan.key}": ${plan.amountMinor} ${plan.currency} / ${plan.interval} (from the database)`,
    );

    // Already linked and still valid at Stripe? Then there is nothing to do.
    if (plan.stripePriceId !== null) {
      const existing = await stripe.prices.retrieve(plan.stripePriceId).catch(() => null);
      if (existing !== null && existing.active) {
        console.log(`Already linked to ${existing.id} — nothing to do.`);
        return;
      }
      console.log(`Stored price ${plan.stripePriceId} is missing or inactive; creating a new one.`);
    }

    const found = await stripe.prices.list({ lookup_keys: [LOOKUP_KEY], active: true, limit: 1 });
    let price = found.data[0] ?? null;

    if (price === null) {
      const product = await stripe.products.create({
        name: plan.name,
        description: plan.description ?? undefined,
        metadata: { kurdora_plan_key: plan.key },
      });

      price = await stripe.prices.create({
        product: product.id,
        // Straight from the plan row. Minor units are what Stripe wants too,
        // so there is no conversion to get wrong.
        unit_amount: Number(plan.amountMinor),
        currency: plan.currency.toLowerCase(),
        recurring: { interval: plan.interval as 'month' | 'year' },
        lookup_key: LOOKUP_KEY,
        metadata: { kurdora_plan_key: plan.key },
      });
      console.log(`Created product ${product.id} and price ${price.id}`);
    } else {
      console.log(`Found existing price ${price.id} by lookup key`);
    }

    /*
     * Refuse to link a Price that does not match the plan.
     *
     * A mismatch here would charge a seller an amount the application believes
     * is something else — the snapshot in `listing_subscriptions.amount_minor`
     * would disagree with what Stripe actually took, and reconciliation would
     * be wrong in a way nobody notices until a refund.
     */
    const matches =
      price.unit_amount === Number(plan.amountMinor) &&
      price.currency === plan.currency.toLowerCase() &&
      price.recurring?.interval === plan.interval;

    if (!matches) {
      throw new Error(
        `Price ${price.id} does not match the plan ` +
          `(price: ${price.unit_amount} ${price.currency}/${price.recurring?.interval}, ` +
          `plan: ${plan.amountMinor} ${plan.currency.toLowerCase()}/${plan.interval}). ` +
          `Archive that price in the Dashboard, or change the plan row, then re-run.`,
      );
    }

    await prisma.servicePlan.update({
      where: { id: plan.id },
      data: { stripePriceId: price.id },
    });

    console.log(`\n✓ Linked plan "${plan.key}" to Stripe TEST price ${price.id}`);
    console.log('  Subscriptions remain OFF until listing.subscription_required is true.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
