# 17 — Stripe Test Mode: local verification runbook

**For the owner to run locally. Nothing here requires pasting a secret into a
chat, an issue, or a commit.**

> **Rewritten 2026-09-13.** This document previously covered Stripe **Connect**
> onboarding. Connect is gone: Kurdora is a contact-only marketplace and is
> never party to a sale (ADR-0014). What Stripe now does is bill sellers for
> **Kurdora's own service** — keeping a listing active (ADR-0015).
>
> **Test mode only.** A `sk_live_` key is refused at startup and cannot be made
> to work by configuration. `LIVE_MODE_PERMITTED = false`.

---

## 1. The variables the code actually reads

Real names from `src/infra/env.ts`. Nothing else is read.

| Variable | Required? | Read by | Notes |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | **Yes** | `src/infra/stripe/config.ts` | Must start `sk_test_`. `sk_live_` and `rk_` are refused. |
| `STRIPE_WEBHOOK_SECRET` | **Yes**, always with the key | `src/infra/stripe/config.ts` | Must start `whsec_`. A key without it is refused — a subscription nothing can confirm is worse than none. |
| `APP_URL` | Yes (already set) | `src/lib/billing/subscription-urls.ts` | Builds the Checkout return URLs **server-side**; never accepted from a request. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | **No** | `clientEnv()` | Still no call sites. Stripe-hosted Checkout needs no client-side key. Leave unset. |

Both secrets are server-side only and must never carry a `NEXT_PUBLIC_` prefix.
Lint and `tests/api/stripe-safety.test.ts` enforce that.

## 2. Stripe Dashboard setup

1. Sign in and switch to a **sandbox / test mode** account. Never live.
   Stripe recommends a sandbox for new Billing integrations, and a separate one
   for CI so automated tests do not disturb your products and prices.
2. **Connect does not need to be enabled.** Kurdora does not use it.
3. Copy the **test** secret key (starts `sk_test_`) from the API keys page.

That is all the Dashboard work required. The Product and Price are created by
script — see §4 — because they must match the plan row exactly, and a human
copying four values between two systems eventually gets one wrong.

## 3. Put the values in `.env.local`

Edit the file in your editor. Do not echo them into a recorded terminal.

```bash
STRIPE_SECRET_KEY=sk_test_...          # from the Dashboard
STRIPE_WEBHOOK_SECRET=whsec_...        # from `stripe listen`, see §5
```

Confirm without revealing anything:

```bash
pnpm env:check        # prints "Stripe  configured", never a value
```

## 4. Create the TEST Price

```bash
pnpm db:deploy                 # ensures the listing_monthly plan row exists
pnpm stripe:setup-test-plan
```

The script reads `service_plans` — the plan row is the source of truth — and
creates a matching Stripe Product and Price in test mode, then links the price
id back. It is idempotent, refuses to run unless the resolved Stripe mode is
`test`, and **refuses to link a Price whose amount, currency or interval
disagrees with the plan**. A mismatch there would charge a seller an amount the
application believes is something else.

To change the price, change the plan row (or an admin edits it), archive the old
Stripe Price, and re-run.

## 5. Stripe CLI and webhooks

```bash
brew install stripe/stripe-cli/stripe     # see docs.stripe.com/cli/install
stripe login                              # pairs the CLI with your TEST account
```

Then, in its **own terminal**, left running:

```bash
stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe
```

**The webhook path is exactly `/api/v1/webhooks/stripe`.**

`stripe listen` prints a `whsec_…` **on start**. That value — not one from a
registered Dashboard endpoint — verifies these forwarded deliveries. Put it in
`.env.local` and restart `pnpm dev`.

No `--events` filter is needed: the handler records every delivery and acts only
on `BILLING_EVENT_TYPES` (`src/infra/billing/webhook-service.ts`):

```
checkout.session.completed      invoice.paid
customer.subscription.created   invoice.payment_failed
customer.subscription.updated
customer.subscription.deleted
customer.subscription.paused
customer.subscription.resumed
```

### `stripe trigger` will not verify the mapping

Stripe is explicit: events triggered by the CLI *"contain fake data that doesn't
correlate to subscription information"*, and *"the most reliable way to test
webhook notifications is to create actual test subscriptions"*.

So `stripe trigger customer.subscription.updated` exercises **signature
verification and idempotency** — worth doing — but it will not prove that an
event updates the right listing. For that, complete a real test checkout (§7).

## 6. Turn subscriptions on, deliberately

They are **OFF** by default. Nothing is charged and nothing goes dark until:

```sql
UPDATE settings SET value = 'true'
WHERE key = 'listing.subscription_required' AND scope = 'GLOBAL';
```

**Turning this on takes every unpaid listing down.** Do it on a test database
first. Turn it back off with `'false'` when finished.

## 7. The verification walkthrough

```bash
# terminal 1
pnpm docker:up && pnpm db:deploy && pnpm db:seed && pnpm dev
# terminal 2
stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe
# terminal 3
pnpm verify
pnpm exec vitest run tests/api/stripe-live.test.ts
```

With no key, the live suite prints
`[stripe-live] SKIPPED: no sk_test_ key configured` and skips. Once a
`sk_test_` key is present those tests run against the real API — **that is the
signal that real verification has actually happened.**

Then, by hand:

1. Register, create a seller profile, create a listing.
2. `POST /api/v1/listings/{id}/subscription` → returns a Checkout URL.
   (There is no billing UI yet, by design — use the API.)
3. Open the URL, pay with **4242 4242 4242 4242**, any future expiry, any CVC.
4. Watch `stripe listen`: `checkout.session.completed`,
   `customer.subscription.created`, `invoice.paid`.
5. `GET /api/v1/listings/{id}/subscription` → `status: "ACTIVE"`.
6. Check the row: `current_period_end` must be **populated**. If it is null,
   Stripe has moved the field again — it currently lives on the subscription
   ITEM, not the root.
7. Publish the listing. With the setting on, it goes live only now.

### Payment failure → `PAST_DUE`

Verified against Stripe's Billing testing documentation on 2026-09-13: attach
**4000 0000 0000 0341** as the customer's default payment method and use a short
trial to defer the first charge. The subscription activates, then the invoice
fails when the trial ends. Expect `invoice.payment_failed` and a move to
`PAST_DUE`.

**The listing stays visible while `PAST_DUE`** — that is the approved rule, not
a bug. Stripe retries for days and most recover.

### Renewal, and cancellation

Use a **test clock** to advance time rather than waiting a month
(<https://docs.stripe.com/billing/testing/test-clocks>). Advancing one cycle
should produce `invoice.paid` and push `current_period_end` forward.

Cancel from the Dashboard: expect `customer.subscription.deleted`, status
`CANCELED`, and the listing moved to **PAUSED** — never REMOVED. A seller whose
card expired has not done anything wrong; removal is a moderation outcome.

### Duplicate and out-of-order delivery

In the `stripe listen` output, resend an event id you have already seen: the
response is `{"received":true,"duplicate":true}` and nothing changes. For
out-of-order, cancel a subscription and then resend an earlier `updated` event —
the status must stay `CANCELED`.

## 8. What must never appear anywhere

Not in a commit, issue, screenshot, log or chat message:

- `sk_test_…` / `sk_live_…` secret keys
- `whsec_…` webhook secrets
- database passwords, `AUTH_SECRET`, `AUTH_ENCRYPTION_KEY`

**Safe to share as evidence:** object ids (`cus_…`, `price_…`, `cs_…`, `sub_…`,
`in_…`, `evt_…`), event type names, and HTTP status codes.
