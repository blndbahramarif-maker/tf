import { serverEnv } from '@/infra/env';

/**
 * Stripe configuration, and the guard that keeps Phase 7 Part 1 in test mode.
 *
 * Two things this file exists to make impossible:
 *
 *   1. **Starting up half-configured.** A secret key without a webhook secret
 *      means payments would be created that nothing can ever confirm. That is
 *      worse than no payments at all, so it is a refusal, not a warning.
 *
 *   2. **Reaching live mode by accident.** Stripe's own key prefixes are the
 *      only reliable signal of which mode you are in, and they are checked
 *      here rather than trusted from a `NODE_ENV` somewhere. Until Stripe has
 *      given written approval of the business model (R-3, gate blocker B-1),
 *      a live key is REFUSED outright.
 */

export type StripeMode = 'test' | 'live';

export interface StripeConfig {
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly mode: StripeMode;
}

export type StripeConfigResult =
  | { readonly ok: true; readonly config: StripeConfig }
  | { readonly ok: false; readonly reason: StripeConfigIssue };

export type StripeConfigIssue =
  | 'not_configured'
  | 'missing_secret_key'
  | 'missing_webhook_secret'
  | 'live_mode_not_permitted'
  | 'mode_mismatch';

/**
 * Stripe test keys begin `sk_test_`; live keys begin `sk_live_`. Restricted
 * keys use `rk_`, which this integration does not support — a restricted key
 * silently lacking a permission would fail at the worst possible moment.
 */
function modeOfSecretKey(key: string): StripeMode | null {
  if (key.startsWith('sk_test_')) return 'test';
  if (key.startsWith('sk_live_')) return 'live';
  return null;
}

/**
 * Whether live mode is permitted at all.
 *
 * Hard-coded `false` for Phase 7 Part 1, and deliberately not an environment
 * variable: an env var is something an operator can set at 2am, and the gate
 * report's B-1 is not a thing an operator is allowed to overrule. It changes
 * when Stripe's written approval exists and a human edits this line in a
 * reviewed commit.
 */
export const LIVE_MODE_PERMITTED = false;

/**
 * The decision itself, as a pure function of the two values.
 *
 * Split out from `readStripeConfig` so the live-mode refusal can be asserted
 * directly. `serverEnv()` memoises, so a test that mutated `process.env` would
 * be asserting against a cached parse and would pass for the wrong reason —
 * which on this particular rule would be worse than having no test.
 */
export function decideStripeConfig(
  secretKey: string | undefined,
  webhookSecret: string | undefined,
): StripeConfigResult {
  // Neither set is the normal state before Phase 7 is deployed anywhere. It is
  // "off", not "broken", and the payment routes answer 503 rather than crash.
  if (!secretKey && !webhookSecret) return { ok: false, reason: 'not_configured' };

  if (!secretKey) return { ok: false, reason: 'missing_secret_key' };
  if (!webhookSecret) return { ok: false, reason: 'missing_webhook_secret' };

  const mode = modeOfSecretKey(secretKey);
  if (mode === null) return { ok: false, reason: 'mode_mismatch' };

  if (mode === 'live' && !LIVE_MODE_PERMITTED) {
    return { ok: false, reason: 'live_mode_not_permitted' };
  }

  return { ok: true, config: { secretKey, webhookSecret, mode } };
}

export function readStripeConfig(): StripeConfigResult {
  const env = serverEnv();
  return decideStripeConfig(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET);
}

/** True when Stripe is usable. Routes branch on this rather than throwing. */
export function isStripeConfigured(): boolean {
  return readStripeConfig().ok;
}

export function requireStripeConfig(): StripeConfig {
  const result = readStripeConfig();
  if (!result.ok) {
    // The reason is safe to surface in a server log: it names which variable
    // is absent, never any part of a key's value.
    throw new StripeNotConfiguredError(result.reason);
  }
  return result.config;
}

export class StripeNotConfiguredError extends Error {
  readonly reason: StripeConfigIssue;

  constructor(reason: StripeConfigIssue) {
    super(`Stripe is not usable: ${reason}`);
    this.name = 'StripeNotConfiguredError';
    this.reason = reason;
  }
}
