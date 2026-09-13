# 17 — Stripe Test Mode: local setup runbook

**For the owner to run locally. Nothing in this document requires pasting a
secret into a chat, an issue, or a commit.**

> **Test mode only.** Every step below is sandbox. A `sk_live_` key is refused
> at startup and cannot be made to work by configuration — see §4. Stripe has
> not approved Kurdora's business model in writing, so live mode stays blocked
> (R-3, [D-A](./13-dependencies-and-blockers.md)).

---

## 1. The variables the code actually reads

These are the **real names from `src/infra/env.ts`**. Nothing else is read.

| Variable | Required? | Where it is read | Notes |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | **Yes**, to exercise Stripe | `src/infra/stripe/config.ts` | Must start `sk_test_`. `sk_live_` is refused; `rk_` (restricted) is refused. |
| `STRIPE_WEBHOOK_SECRET` | **Yes**, always alongside the key | `src/infra/stripe/config.ts` | Must start `whsec_`. A secret key without this is refused — a payment nothing can confirm is worse than no payment. |
| `APP_URL` | Yes (already set) | `src/lib/payments/onboarding-urls.ts` | `http://localhost:3000` locally. Builds the Stripe return/refresh URLs **server-side**; never accepted from a request. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | **No — not yet** | `clientEnv()` in `src/infra/env.ts` | **`clientEnv()` has no call sites today.** There is no payment UI until Part 3. Leave it unset. |
| `STRIPE_TEST_CONNECTED_ACCOUNT_ID` | Only for the BUY_NOW checks | `tests/api/stripe-live.test.ts` | An `acct_…` that has **already completed hosted onboarding** (§8). Test-only, never read by the application. **Not a secret** — an object id, safe to store and safe to quote as evidence. |

**Correction worth flagging:** `.env.example` previously listed
`STRIPE_PUBLISHABLE_KEY`, a name **nothing in the codebase reads**. That was
wrong and is now fixed. If you set that variable expecting it to do something,
it did nothing.

Both secrets are **server-side only**. Neither may ever carry a `NEXT_PUBLIC_`
prefix — lint and `tests/api/stripe-safety.test.ts` both enforce it.

## 2. Stripe dashboard setup (once)

1. Sign in to Stripe and switch to a **sandbox / test mode** account.
   Never a live account.
2. Enable **Connect**. Complete the platform profile enough for test mode.
3. Copy the **test** secret key from the API keys page. It starts `sk_test_`.

**Connected-account setup:** none is needed in the dashboard. The application
creates connected accounts itself, with this exact configuration
(`CONNECT_CONTROLLER`, `src/domain/payments/connect-gateway.ts`):

```
controller[stripe_dashboard][type]  = express
controller[fees][payer]             = application
controller[losses][payments]        = application
controller[requirement_collection]  = stripe
capabilities                        = card_payments, transfers
```

This is the owner-approved GA combination (DL-5, ADR-0013 Amendment 1). If
Stripe rejects `accounts.create` with a controller error, that is a finding to
report — **not** something to "fix" by switching to the preview configuration.

## 3. Put the values in `.env.local`

Edit `.env.local` directly in your editor. Do not echo them to a terminal that
is being recorded, and do not paste them anywhere.

```bash
STRIPE_SECRET_KEY=sk_test_...          # from the dashboard
STRIPE_WEBHOOK_SECRET=whsec_...        # from `stripe listen`, see §5
```

Confirm without revealing anything:

```bash
pnpm env:check        # prints "Stripe  configured", never a value
```

## 4. What protects you if you get a key wrong

Automated, and asserted by `tests/api/stripe-safety.test.ts`:

| Mistake | What happens |
|---|---|
| You paste a `sk_live_` key | Refused: `live_mode_not_permitted`. No Stripe client is ever constructed, so no network call can occur. |
| You paste a `pk_` or `rk_` key | Refused at the env schema (`sk_` prefix required) or as `mode_mismatch`. |
| You set the key but not the webhook secret | Refused: `missing_webhook_secret`. |
| You set a test key with `APP_ENV=production` | Startup refuses. |
| Someone flips `LIVE_MODE_PERMITTED` | A test fails. |
| A secret ends up on a `NEXT_PUBLIC_` variable | Lint error, plus a runtime test that scans the actual environment. |
| Payments fail to configure | The error names the **reason** (`live_mode_not_permitted`), never any part of a key. |

## 5. Stripe CLI and webhooks

```bash
# Install (macOS). See https://docs.stripe.com/cli/install for other platforms.
brew install stripe/stripe-cli/stripe

stripe login          # opens a browser; pairs the CLI with your TEST account
```

Then, in its **own terminal**, left running:

```bash
stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe
```

**The webhook endpoint path is exactly `/api/v1/webhooks/stripe`**
(`app/api/v1/webhooks/stripe/route.ts`).

`stripe listen` prints a `whsec_…` **on start**. That value — **not** one from a
dashboard endpoint — is what verifies these forwarded deliveries. Put it in
`.env.local` as `STRIPE_WEBHOOK_SECRET` and restart `pnpm dev`.

No `--events` filter is needed. The handler records every delivery and acts
only on `HANDLED_EVENT_TYPES` (`src/infra/payments/webhook-service.ts`):

```
payment_intent.succeeded        account.updated
payment_intent.processing       charge.succeeded
payment_intent.payment_failed   charge.updated
payment_intent.canceled         charge.failed
payment_intent.requires_action
```

A narrower filter can only hide an event you needed.

## 6. Callback / return URLs

Built server-side from `APP_URL`; there is no request parameter that can name
them, deliberately — an attacker who could set `return_url` would have Stripe
redirect a seller mid-onboarding to a page of their choosing.

| Purpose | URL |
|---|---|
| Return (flow entered and exited) | `http://localhost:3000/en/dashboard/payouts?from=stripe` |
| Refresh (link expired or used) | `http://localhost:3000/en/dashboard/payouts?link=expired` |

`en` is `DEFAULT_LOCALE`. **Neither URL proves anything** — returning to the
first triggers a fresh account read, per Stripe's own note that it "only means
the flow was entered and exited properly".

## 7. Run it

```bash
# terminal 1
pnpm docker:up          # or your local Postgres + Redis
pnpm db:deploy && pnpm db:seed
pnpm dev

# terminal 2
stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe

# terminal 3
pnpm verify                                          # includes the real-API tests once keyed
pnpm exec vitest run tests/api/stripe-live.test.ts   # the Stripe suites specifically
```

With no key configured, `tests/api/stripe-live.test.ts` prints
`[stripe-live] SKIPPED: no sk_test_ key configured` and skips 11 tests. Once a
`sk_test_` key is present those 11 run against the real API — that is the
signal that real verification has actually happened.

## 8. The onboarding round trip

1. Register, create a seller profile, go to `/en/dashboard/payouts`.
2. **Set up payouts** → you are sent to Stripe's hosted form.
3. Complete it with Stripe's test values
   (<https://docs.stripe.com/connect/testing>). Test SSN `000-00-0000`, test
   bank routing `110000000` / account `000123456789` for US; for GB use the
   test sort code and account number Stripe lists.
4. You are returned to `?from=stripe`. The page **re-reads the account**.
5. `stripe listen` should show `account.updated` forwarded, and the page
   status should move (`ONBOARDING_STARTED` → `PENDING_VERIFICATION` or
   `ACTIVE`).

**A human must complete step 3.** No automated test can make a seller payable,
and neither can Kurdora — that is the design, not a gap.

### Then unlock the BUY_NOW destination-charge checks

Verified against Stripe's testing documentation on 2026-09-13: **there is no
documented way to fully onboard a connected account through the API** for the
controller configuration Kurdora uses (`requirement_collection = stripe`). The
published test values (`individual.dob = 1902-01-01`, `id_number = 000000000`,
`address.line1 = address_full_match`) satisfy individual verification checks,
but Stripe still collects the requirements itself.

So a destination charge needs an account a human has onboarded. Once you have
one, copy its id into `.env.local`:

```bash
STRIPE_TEST_CONNECTED_ACCOUNT_ID=acct_...   # from step 5, or the Connect dashboard
```

Three further tests then run automatically, covering the destination charge,
the application fee and the transfer destination in one real object. Without
it they skip with a message naming this section — never silently.

## 9. Test cards

<https://docs.stripe.com/testing> · `4242 4242 4242 4242` succeeds,
`4000 0000 0000 0002` is declined, `4000 0025 0000 3155` forces a 3DS
challenge. Any future expiry, any CVC.

## 10. What must never appear anywhere

Not in a commit, an issue, a screenshot, a log, or a chat message:

- `sk_test_…` / `sk_live_…` secret keys
- `whsec_…` webhook secrets
- `pi_…_secret_…` client secrets
- database passwords, `AUTH_SECRET`, `AUTH_ENCRYPTION_KEY`

**Safe to share:** object IDs (`acct_…`, `pi_…`, `ch_…`, `evt_…`, `txn_…`),
event type names, and HTTP status codes. Those are what an exit report should
quote as evidence.
