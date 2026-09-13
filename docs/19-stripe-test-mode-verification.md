# 19 — Stripe test-mode verification: BLOCKED

**Status: BLOCKED — not run. No Stripe API call was made, in test mode or
otherwise. Nothing in this document is a verification result.**

Date of attempt: 2026-09-13.

---

## 1. Why it is blocked

The verification run described in `docs/17-stripe-test-mode-setup.md` requires a
Stripe **test** secret key (`sk_test_...`) in the environment of the machine
running it. In the environment this run was attempted in, **`STRIPE_SECRET_KEY`
is absent.**

The check performed, and its result:

```
$ env | cut -d= -f1 | grep -i stripe
(no output — no environment variable whose name contains "stripe", in any case)
```

There is also no `.env.local` in the clone (it is gitignored and was never
created, because creating one would not have supplied the missing key), and the
`stripe` CLI is not installed on this machine, so the `stripe listen` webhook
forwarding in §5 of the runbook could not have been started either.

Without a key there is nothing to verify: the run stopped at the gate before any
environment setup, any database work, any server start, and any network call to
Stripe.

## 2. What was NOT done

Explicitly, so nobody reads absence as success. None of the following happened:

- No `.env.local` was created; no database was started, migrated or seeded.
- `pnpm stripe:setup-test-plan` was **not** run. No Stripe Product and no Price
  exist as a result of this run, and `service_plans.stripe_price_id` was not
  written.
- No application server was started, and no webhook endpoint was exercised.
- No seller account, no listing, no Checkout Session, no subscription, no
  invoice and no payment intent were created. **There are no object ids to
  record, because no objects were created.**
- No webhook event was received — not from `stripe listen`, not from a re-delivery.
- None of the state transitions were observed: not `INCOMPLETE → ACTIVE`, not
  `PAST_DUE`, not the cancel-and-pause behaviour.
- Duplicate delivery (dedupe) and out-of-order delivery (`isStaleProviderUpdate`)
  were **not** exercised against real events.
- `pnpm test` and `pnpm verify` were not run in this attempt, so there are no
  pass/fail/skip totals to report. The 12 real-API tests in
  `tests/api/stripe-live.test.ts` remain **skipped**, exactly as they were before.
- No Stripe test objects were created, so there was no cleanup to perform.

## 3. What is unchanged in the repository

- `LIVE_MODE_PERMITTED` remains `false`. It was not edited.
- `listing.subscription_required` was not touched; it remains `false` by default.
- No source file was modified by this attempt. The only change is this document.

## 4. REAL Stripe verification vs local-integration verification

- **REAL Stripe verification: none.** The live Stripe API has still never been
  called from this repository. That statement is unchanged by this attempt.
- **Local-integration verification: none performed in this attempt.** Whatever
  local coverage exists is the coverage that already existed on the branch; this
  run added nothing to it and confirmed nothing about it.

## 5. What is needed to unblock

A Stripe **test** secret key (`sk_test_...`) present in the runner's
environment, plus the `stripe` CLI available on the machine for webhook
forwarding. A `sk_live_` key is not an acceptable substitute and must not be
supplied: the runbook and the code both refuse live mode, and the verification
must never be attempted against live.

No secret value — no API key, no `whsec_` webhook signing secret — belongs in
this file or in any commit.
