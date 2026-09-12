# Phase 7 Part 2 — Stripe Test-Mode Connect Onboarding

**Date:** 2026-09-12 · **Status:** implementation complete, **provider
integration UNVERIFIED** · **Recommendation: NEEDS FIXES — see §16**

> **Read this first.** Everything in Part 2 is proven against a labelled fake
> provider. **The real Stripe API was never called in this run, and no webhook
> was ever received from Stripe.** This environment has no Stripe credentials
> and no Stripe CLI. Sections 4, 5, 6, 7 and 8 say exactly what that leaves
> unproven, and §17 gives the exact setup for the next run.
>
> **No live Stripe operation of any kind occurred.** No live key was present, no
> live account was created, no real seller was onboarded and no real money moved.

---

## 1. Commit

Implemented on branch `claude/kurdora-marketplace-planning-ty4dnd`, on top of
Part 1 (`3bdf53a`). The commit hash for this work is recorded in the commit that
carries this document.

## 2. Files changed

**25 files modified, 11 added.** +1,468 / −58.

### New — domain (no Next, React, Prisma or Stripe)
| File | What it is |
|---|---|
| `src/domain/payments/onboarding-status.ts` | The onboarding state machine, `deriveOnboardingStatus`, `checkSellerEligibility` |
| `src/domain/payments/connect-gateway.ts` | The `ConnectGateway` port and `CONNECT_CONTROLLER` |

### New — infrastructure
| File | What it is |
|---|---|
| `src/infra/stripe/connect.ts` | The Stripe adapter for connected accounts |
| `src/infra/payments/onboarding-service.ts` | Account creation, link minting, `applyAccountState`, eligibility reads |
| `src/lib/payments/onboarding-urls.ts` | Return/refresh URLs, built server-side and never accepted from a request |

### New — routes, UI and migration
| File | What it is |
|---|---|
| `app/api/v1/connect/onboarding/route.ts` | `POST` — begin or resume onboarding |
| `app/api/v1/connect/status/route.ts` | `GET` — the caller's own standing, from the mirror |
| `app/[locale]/dashboard/payouts/page.tsx` | The seller payouts page |
| `app/[locale]/dashboard/payouts/payout-forms.tsx` | The two CSRF-carrying forms |
| `prisma/migrations/20260912200000_connect_onboarding/` | `migration.sql` + `down.sql` |

### New — tests
`tests/domain/onboarding.test.ts`, `tests/api/connect.test.ts`,
`e2e/payouts.spec.ts`.

### Modified (selected)
`webhook-service.ts` (account and charge handlers, the dedup split),
`order-service.ts` (eligibility wired to the domain), `payment-gateway.ts`
(`GatewayChargeSettlement`, `retrieveCharge`), `stripe/gateway.ts`
(`toChargeSettlement`), `stripe/config.ts` (`decideStripeConfig` extracted so
the live-mode refusal is testable), `prisma/seed/data.ts` (the
`seller:manage_payouts` permission), the four i18n catalogues, `openapi.yaml`,
`CLAUDE.md`, `docs/10-roadmap.md`, `.env.example`.

## 3. Migrations

One: **`20260912200000_connect_onboarding`**.

- New enum `onboarding_status` (7 values).
- `seller_profiles` gains `onboarding_status`, `details_submitted`,
  `stripe_disabled_reason`, `stripe_capabilities` (JSONB),
  `stripe_account_country`, `stripe_controller` (JSONB),
  `stripe_payout_delay_days`, `onboarding_started_at`,
  `onboarding_completed_at`, `stripe_account_synced_at`.
- `payment_attempts` gains `provider_payment_intent_id`,
  `amount_refunded_minor`, `refunded`, `disputed`, `provider_transfer_id`,
  `destination_account_id`, `provider_net_minor`, `failed_at`.
- Four CHECK constraints and three indexes (§13).

`down.sql` ships with it and was **executed**: see §13.

## 4. Stripe SDK and API calls actually exercised

**Against the real Stripe API: NONE.**

Written and wired, exercised only against the fake:

| SDK call | Where | Real-API status |
|---|---|---|
| `accounts.create` | `StripeConnectGateway.createAccount` | **NOT CALLED** |
| `accountLinks.create` | `StripeConnectGateway.createAccountLink` | **NOT CALLED** |
| `accounts.retrieve` | `StripeConnectGateway.retrieveAccount` | **NOT CALLED** |
| `charges.retrieve` (with `expand: ['balance_transaction']`) | `StripeGateway.retrieveCharge` | **NOT CALLED** |
| `webhooks.constructEvent` | `StripeGateway.constructEvent` | **NOT CALLED** in this run |

The object SHAPES these map were re-verified against Stripe's live
documentation on 2026-09-12, as CLAUDE.md requires: the Charge object (`status`
is exactly `succeeded | pending | failed`; `refunded` means FULLY refunded;
`balance_transaction` is a bare id unless expanded; `transfer` exists only for
destination charges) and the Balance Transaction object (`fee` positive when
assessed, `net = amount − fee`). Verifying a document is not the same as
calling the API, and this report does not treat it as such.

## 5. Stripe Test Mode results

**None. No request was made to Stripe.**

`readStripeConfig()` returns `not_configured`; `pnpm env:check` prints
`Stripe  not configured (Phase 7)`; `tests/api/stripe-live.test.ts` prints
`[stripe-live] SKIPPED: no sk_test_ key configured. The real Stripe API was NOT
exercised in this run.` and skips 11 tests.

## 6. Connected-account onboarding results

**No connected account was created at Stripe, in test mode or otherwise.**

What was exercised, against the fake provider and the real database:

- An account is created from the seller's PROFILE row — country, email and
  business name — with our ids as metadata, under the deterministic key
  `seller:<sellerProfileId>:acct:v1`. A second call reuses it.
- The account id is persisted BEFORE the link is minted, so a crash between the
  two leaves a recorded account rather than an orphan at Stripe.
- A FRESH link is minted every call, with `collection_options[fields]` =
  `eventually_due`.
- A `REJECTED` seller is refused a link.

## 7. Webhook events actually received

**ZERO events were received from Stripe. The Stripe CLI is not installed in
this environment and `stripe listen` was never run.**

Event types the handler now acts on (`HANDLED_EVENT_TYPES`):
`payment_intent.succeeded`, `payment_intent.processing`,
`payment_intent.payment_failed`, `payment_intent.canceled`,
`payment_intent.requires_action`, `account.updated`, `charge.succeeded`,
`charge.updated`, `charge.failed`.

Exercised via synthetic payloads through `recordEvent` → `processEvent` — the
real processing code, the real database, a fake `constructEvent`.

**One correctness fix worth calling out.** The Part 1 semantic dedup on
`(type, objectId)` would have been actively harmful applied to `account.updated`:
an account emits one every time a requirement changes, so treating the second as
a duplicate would have silently discarded the event that says a seller has been
restricted. Dedup is now restricted to `SEMANTICALLY_UNIQUE_EVENT_TYPES`, and a
test asserts a second `account.updated` is processed and lowers the seller from
`ACTIVE` to `RESTRICTED`.

## 8. Payment lifecycle results

**No PaymentIntent was created at Stripe. No card was charged. No 3DS challenge
was attempted.** The BUY_NOW destination-charge path is unchanged from Part 1
and remains unverified against the real API.

## 9. PaymentAttempt changes

**Assessment as the brief asked: `latest_charge` alone is NOT sufficient.**

A `payment_intent.succeeded` payload gives a charge id and nothing else of
substance. The figures that matter for reconciliation — the real Stripe fee and
the real net — live on the charge's balance transaction, which appears in that
payload as a bare string id at best. Kurdora does not estimate either: an
estimated fee that drifts from the real one produces a ledger that looks
balanced and is wrong.

So `charge.*` triggers `retrieveCharge`, which reads the charge back with
`expand: ['balance_transaction']` and writes: balance transaction id, payment
intent id, payment method type, transfer id, destination account id,
`provider_fee_minor`, `provider_net_minor`, `amount_refunded_minor`,
`refunded`, `disputed`, failure code/message, `livemode`, and
`succeeded_at`/`failed_at`.

`provider_fee_minor` and `provider_net_minor` are **nullable and stay null**
while a charge is unsettled. Null is honest; zero is a number that reconciles
against nothing.

**Refunds and disputes are MIRRORED, not HANDLED.** No ledger entry is
reversed, no order status changes, no payout is held. That is Part 3.

## 10. FEE_ONLY invariant verification

**Unchanged and re-asserted.** `total_minor = commission_amount_minor`,
`seller_amount_minor = 0`, the principal recorded and never sent.

Four independent layers, all still in place: `computeOrderAmounts`,
`assertChargeIsSafe` one call before the network, and the CHECK constraints
`orders_fee_only_charges_fee_alone` and `orders_fee_only_principal_recorded`.

A new test proves the Part 2 eligibility hardening did not accidentally gate
FEE_ONLY: a seller with `stripe_account_id = NULL`, `charges_enabled = false`
and `payouts_enabled = false` creates a £50,000 Cars order that produces a
£250 charge with no connected account involved. Nothing in Part 2 touches the
FEE_ONLY path.

## 11. Security results

| # | Attack | Result |
|---|---|---|
| 1 | Client supplies `stripeAccountId` in an onboarding request | **No such field exists** in the route, the service or the schema. Nothing to strip because nothing can arrive. |
| 2 | Client claims `chargesEnabled` / `payoutsEnabled` | Same — only `applyAccountState` writes them, and it takes a `ProviderAccountState` only the Stripe adapter can produce. |
| 3 | Forged "return from Stripe" (`?from=stripe`) | Changes nothing. E2E asserts status stays `NOT_STARTED` and both capabilities stay false. |
| 4 | Stale `account.updated` re-enabling a REJECTED seller | **Refused.** Status held at `REJECTED`; mirrored facts still recorded. Tested. |
| 5 | `account.updated` for one seller affecting another | Untouched. The account id is looked up, never trusted from elsewhere. Tested. |
| 6 | Forged webhook signature | 400 and audited, unchanged from Part 1. Real HMAC verification is Stripe's code and is **not** exercised here. |
| 7 | `sk_live_` key | **Refused** by `decideStripeConfig` → `live_mode_not_permitted`. Now tested directly rather than through a memoised env. |
| 8 | BUY_NOW from a seller with outstanding requirements | **Refused.** The subtle case: `charges_enabled` stays true until Stripe's deadline. Tested. |
| 9 | Cross-seller onboarding | Impossible by construction: no id parameter exists; the profile is found by the session's user id. |
| 10 | Non-seller reaching the onboarding endpoints | 403 for every role without `seller:manage_payouts`; 401 for a guest. Authorization matrix, all 9 roles. |
| 11 | Connected account id leaking to the browser | Absent from `loadOnboardingSnapshot`, from both API responses, and from the page. E2E asserts the rendered HTML contains no `acct_`. |
| 12 | Onboarding URL in logs or the audit trail | Never recorded. It grants access to the account holder's personal information. |
| 13 | Attacker-named `return_url` | Impossible: both URLs are built server-side from `APP_URL`. |

**One item is deliberately NOT claimed:** real HMAC signature verification was
not exercised in this run, because no Stripe webhook was received.

## 12. Test counts

| Suite | Result |
|---|---|
| `pnpm verify` (all 33 files) | **917 passed, 11 skipped, 0 failed** |
| — of which new in Part 2 | `tests/domain/onboarding.test.ts` 18, `tests/api/connect.test.ts` 15 |
| — extended in Part 2 | authorization matrix 189 (+2 routes × 9 roles), constraints 43 (+6), stripe-live 4 passed + 11 skipped |
| Playwright E2E | **49 passed**, of which 8 new in `e2e/payouts.spec.ts` |

The 11 skips are the real-Stripe suites. They are skipped, not passing, and the
runner says so on every run.

## 13. Migration up/down result

Executed, not asserted:

```
pnpm db:migrate:down   → ↓ reversing 20260912200000_connect_onboarding
                          Reversed 1 migration(s).
   (verified: onboarding_status and stripe_capabilities columns gone)
pnpm db:deploy         → All migrations have been successfully applied.
   (verified: all 4 new CHECK constraints present in pg_constraint)
pnpm check:migrations  → ✓ 8 migrations checked: all reversible, no spurious drops
```

## 14. Docker and CI status

**Docker is not available in this environment and never has been** across
Phases 5–7; `pnpm docker:up` has never run here. Postgres and Redis were run
directly on the host. MinIO has never booted, so object storage remains
exercised only through its own adapter tests.

**CI has never been observed running.** The workflow exists from Phase 5 and
was not modified. Whether it passes with the Part 2 changes is **unknown**.

## 15. Unresolved bugs

1. **An intermittent failure in `tests/api/listings.test.ts` ("filters by price
   range") was observed once** during a full 33-worker run and did not
   reproduce on two subsequent full runs. Cause: the suites share one database
   across parallel workers while several listing-search tests assert exact
   result counts, so any suite creating an ACTIVE listing can perturb them.
   This is a pre-existing fragility, not introduced here — but a fixture added
   in Part 2 did carry a mileage inside a band another file asserts on, and
   that was changed. The underlying fragility is **not fixed**.
2. **Two pre-existing OpenAPI lint warnings** on `GET /auth/session` (a 303-only
   operation with no 2xx or 4xx). Pre-existing; not touched.

## 16. Blocked / unverified

**Blocked on credentials this environment does not have:**

- B-1 **The real Stripe API was never called.** No account, no link, no
  account read, no charge read.
- B-2 **No webhook was ever received from Stripe.** The Stripe CLI is not
  installed; `stripe listen` was never run; real HMAC verification was not
  exercised.
- B-3 **No end-to-end test-mode payment was made.** No card, no 3DS.
- B-4 **No onboarding round trip was completed.** That requires a human to fill
  in Stripe's hosted form — by design.

**Blocked on decisions and people:**

- B-5 **Stripe has NOT approved Kurdora's business model in writing.** Hard
  go-live blocker (R-3). `LIVE_MODE_PERMITTED = false` remains enforced.
- B-6 **Legal review of the FEE_ONLY Cars/Business model is still required.**
- B-7 **An ADR-0013 DEVIATION needs a decision.** ADR-0013 chose
  `losses.payments = stripe`; combined with the Express Dashboard that is
  documented as PUBLIC PREVIEW and requires API version `2026-08-26.preview`,
  while this integration is pinned to GA `2026-08-26.dahlia`. The GA-supported
  combination (`losses.payments = application`) is used instead. **This decides
  who absorbs a negative balance on a connected account** — a commercial
  question, not a technical one. It is recorded in `CONNECT_CONTROLLER` and
  pinned by a test so it cannot drift silently. **`stripe_dashboard.type` is
  immutable per account**, so changing course later means creating every
  connected account again.
- B-8 **Native-speaker review** of the new Sorani, Kurmanji and Arabic payout
  strings has not happened. They were written without native review, like every
  non-English string in the repository.

## 17. Exactly what the next run needs

Full instructions are now in `.env.example`. In short:

1. A Stripe **sandbox** account with Connect enabled. Never a live one.
2. `STRIPE_SECRET_KEY=sk_test_…`, `STRIPE_PUBLISHABLE_KEY=pk_test_…`
3. Stripe CLI: `stripe login`, then
   `stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe`.
   Take the `whsec_…` it prints on start — not one from a dashboard endpoint —
   as `STRIPE_WEBHOOK_SECRET`.
4. `pnpm verify` then `pnpm exec vitest run tests/api/stripe-live.test.ts`.
5. A human completes the hosted onboarding form for the round trip.

## 18. Recommendation

**NEEDS FIXES — but not of the code.**

The implementation is complete, tested against a fake provider, and passes the
full gate: 917 unit/API tests, 49 E2E tests, formatting, lint, typecheck,
reversible migrations and OpenAPI validation. The security properties the brief
named are in place and asserted.

It should not be approved as "Stripe integration verified", because it is not.
Four of the ten Part 2 objectives — the real API call, the real webhook, the
real test-mode payment, the CLI round trip — **could not be executed here at
all**, and no amount of further coding changes that. They need credentials.

Two things also need a human, not a next run: **B-7**, the controller deviation,
which is a commercial decision about who carries losses and is expensive to
reverse because the dashboard type is immutable per account; and **B-5**,
Stripe's written approval, which remains the hard go-live blocker it has been
since the gate.

**Kurdora cannot take real money and is not ready to.** No real seller has been
onboarded and no real payment has been taken.
