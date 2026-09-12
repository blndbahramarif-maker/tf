# Kurdora — working conventions

Read `docs/README.md` before making architectural changes. Read
`docs/12-decisions-log.md` for the decisions that are already settled.

## Current state

**Phase 7 Parts 1 and 2 complete: the payment foundation and connected-account
onboarding, Stripe TEST MODE only.** Orders, a payment gateway port with a
Stripe adapter behind it, destination charges for BUY_NOW, fee-only charges for
Cars and Business, database-durable idempotency, and a signature-verified
webhook. On top of that: a `ConnectGateway` port, server-side account creation
under a deterministic idempotency key, Stripe-hosted onboarding, `account.updated`
and `charge.*` handling, and a seller payouts page.

**The real Stripe API has never been called.** This environment has no Stripe
credentials and no Stripe CLI, so `tests/api/stripe-live.test.ts` is written and
SKIPPED, and no webhook has ever been received from Stripe. Everything above is
proven against a labelled fake provider. See `docs/16-phase-7-part-2.md`.

**Live mode is refused at startup** (`LIVE_MODE_PERMITTED = false` in
`src/infra/stripe/config.ts`). Stripe has NOT approved the business model in
writing; that remains a hard go-live blocker (R-3, `docs/15-phase-7-gate.md`).
No real seller has been onboarded and no real payment has been taken.

**Phase 6 complete: messaging and offers.** On top of Phases 1-5 there are now
buyer-to-seller conversations (per-participant read state, keyset-paginated
history, plain-text safety, reporting) and an explicit offer lifecycle driven by
a transition table with an append-only audit trail. Inbox, thread, contact,
offer list and offer detail pages ship with them.

**Phase 6 collects no money.** An accepted offer records agreement and nothing
else — no order, no payment, no ledger entry, no payout. A test asserts it.

There is still NO payment UI, NO payouts, NO refund or dispute handling, NO
reconciliation, NO realtime transport, NO message attachments, NO blocking, NO
counter-offers, NO subscriptions, NO advertising, NO reviews and NO moderation
UI. See `docs/10-roadmap.md`.

**Refunds and disputes are MIRRORED, not handled.** `charge.*` writes
`refunded`, `disputed` and `amount_refunded_minor` onto a payment attempt
because those are facts the provider reported. Nothing reverses a ledger entry,
changes an order status or holds a payout. A column holding `true` is not the
platform having handled what it describes.

## Commands

```bash
pnpm docker:up        # Postgres, Redis, MinIO, Mailpit
pnpm env:check        # validate .env.local
pnpm db:deploy        # apply migrations
pnpm db:seed          # seed configuration (idempotent)
pnpm dev              # http://localhost:3000/en
pnpm worker           # background worker (separate process)

pnpm verify           # format + lint + typecheck + migrations + test + openapi
                      # ← run before every commit
pnpm test:e2e         # Playwright. Requires a CURRENT production build —
                      # `next start` serves whatever .next contains.
pnpm build            # production build. Do NOT export NODE_ENV from .env.local:
                      # Next sets it itself, and forcing `development` makes the
                      # build fail to prerender.
```

Database tests (`tests/db/*`) only run when `TEST_DATABASE_URL` is set. They
create and drop their own throwaway databases — point it at a local server only.

```bash
pnpm db:migrate            # create + apply a migration in development
pnpm db:migrate:down       # reverse the most recent migration
pnpm db:reset              # drop, re-apply, re-seed (local only)
```

## Non-negotiables

These are enforced by lint or by tests. Do not work around them; if one is
genuinely wrong, change the rule deliberately and write an ADR.

1. **`src/domain` must not import Next.js, React, next-intl, Prisma or Stripe.**
   Depend on a port interface; implement it in `src/infra`. (ADR-0002)
2. **Only `src/infra/stripe` may import the Stripe SDK.**
3. **Money is integer minor units (`BigInt`), rates are basis points.**
   No floats, no `parseFloat`, no decimal percentages. (ADR-0006)
4. **Logical CSS properties only** — `ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`.
   Never `ml-`, `pl-`, `left-`, `text-left`. RTL breaks silently otherwise. (ADR-0005)
5. **No hard-coded UI text.** Everything through `@kurdora/i18n` catalogues.
6. **No hard-coded brand name.** Use `@kurdora/brand` or interpolate `{brandName}`.
7. **No hard-coded categories, commission rates or prices.** They are data,
   editable by an admin without a deploy.
8. **Secrets are server-side only.** Never `NEXT_PUBLIC_*`, never in a client
   component, never logged.
9. **Payment state comes only from verified webhooks.** Never trust the browser.
10. **Database changes are migrations.** Never manual production DDL, and
    **every migration ships a `down.sql`** — the migration tests fail without one.
11. **Invariants belong in the database as well as the domain.** Money rules are
    CHECK constraints and triggers, not only TypeScript (ADR-0010). Application
    checks bind only code that goes through them.
12. **The ledger is append-only and must balance.** Every money movement is a
    balanced entry group; use the recipes in `src/domain/ledger/postings.ts`
    rather than writing entries by hand.
13. **Every protected route declares a permission.** An empty requirement is
    DENIED — that is the deny-by-default rule, not an oversight to work around.
14. **Identity comes from the bearer token, never from the request.** No route
    may accept a user id from a path, query or body as proof of who is calling.
15. **Every id-addressed route verifies ownership** against the database, and
    answers `notFound(request)` — never 403 — when the caller is not the owner.
    A 403 there confirms the resource exists and enumerates other people's ids.
16. **Validate an id with `isUuid()` before querying.** An unparseable id makes
    Postgres throw and leaks a database error in a 500.
17. **No authentication material in JavaScript's reach.** Access and refresh
    tokens live in `HttpOnly` cookies only — never `localStorage`,
    `sessionStorage`, a JS variable, or rendered into HTML. An E2E test asserts
    both storages are empty after login. (ADR-0012)
18. **Every cookie-authenticated state change requires a CSRF token.** Enforced
    inside `requireAccess` and `requireActionAccess`, so a route or action that
    forgets fails closed. Bearer callers are exempt by design — a cross-origin
    page cannot set an `Authorization` header.
19. **A Server Action is a public POST endpoint.** It re-runs the full guard —
    session, account status, CSRF, permissions — and then verifies ownership
    against the database. Being "internal" is not a security property.

## Adding things

**A language:** one entry in `packages/i18n/src/index.ts` + one catalogue file.
Set `enabled: true` only after native-speaker review.

**An API endpoint:** define the schema in `src/shared`, document it in
`openapi/openapi.yaml`, implement in `app/api/v1/`, use `src/lib/api/respond.ts`
for the envelope. Money-moving endpoints require `Idempotency-Key`. The
documentation is enforced: `tests/api-contract.test.ts` fails if a route file
exports a method the OpenAPI document does not describe, and if the document
describes an endpoint with no route file.

**A conversation or offer surface:** participation is the QUERY, never a check
applied afterwards. Load through `loadConversationForViewer` /
`loadOfferForParty`, which put the viewer's id into the `where` clause; a
non-party gets `null` and the caller answers 404. Never write a loader that
fetches by id and compares ownership after — that is the check someone forgets.

**An offer transition:** add a row to `OFFER_TRANSITIONS` in
`src/domain/offers/offer-status.ts`, naming which actors may make it. Never add
an `if`. Roles are resolved from the database (`resolveActor`), never from the
request, and every transition writes its `offer_events` row in the SAME
transaction as the status change.

**A message-content rule:** messages are never parsed as markup, so the answer
is never "strip the dangerous part" — that is a blocklist. Content is refused
with a reason or SCORED and still delivered; it is never silently rewritten or
truncated.

**A connected-account surface:** the request names NOTHING. The country, the
email and the business name come from the caller's own seller profile row,
found by the session's user id — there is no `stripeAccountId`, `country` or
`capabilities` parameter anywhere, so a forged one has nowhere to arrive.
**Only `applyAccountState` may change a seller's payability**, it takes a
`ProviderAccountState` that only the Stripe adapter can produce, and it refuses
any transition `ONBOARDING_TRANSITIONS` disallows while still recording the
mirrored facts. Stripe's return URL "only means the flow was entered and exited
properly" — treat it as a cue to re-read the account, never as evidence.
`REJECTED` is terminal.

**A webhook event type:** decide whether a SECOND event about the same object
is a duplicate before adding it to `HANDLED_EVENT_TYPES`. Add it to
`SEMANTICALLY_UNIQUE_EVENT_TYPES` only if it describes a once-only transition.
`account.updated` and `charge.updated` are emitted repeatedly with real new
state each time; deduping them would silently discard the event that says a
seller has been restricted.

**Anything that takes money:** the request names a resource id and nothing
else. The amount, currency, seller, connected account and commission are all
re-read from the database — they are not merely validated, they are absent from
the request schema, so `z.object`'s stripping means a forged field has nowhere
to arrive. **Only a signature-verified webhook may move an order to PAID**;
`canTransitionOrder` reserves it to the `system` actor and no route, action or
redirect can produce one.

**A FEE_ONLY charge:** the buyer pays the commission and nothing else. The sale
principal is recorded in `orders.principal_minor` and **never sent to a payment
provider**. Guarded four times over: `computeOrderAmounts`, `assertChargeIsSafe`
one call before the network, and the CHECK constraints
`orders_fee_only_charges_fee_alone` and `orders_fee_only_principal_recorded`.
Never weaken any of them.

**A rate limit:** decide the key deliberately. Credential paths
(`enforceRateLimit` default) key on IP AND account together. Abuse paths —
messaging, offers — pass `{ keyBy: 'subject' }` so the limit follows the
ACCOUNT: a spammer rotating mobile addresses would otherwise get a fresh
allowance with every one.

**A dashboard action:** `"use server"`, first line `requireActionAccess(form, ...)`,
then load the resource scoped by the session's user id, then act. An id from a
form field is a lookup key, never proof of ownership. A non-owner gets
`not_found`, never `forbidden`. A `"use server"` module may only export async
functions — put shared constants and types in a sibling file.

**A page:** server component by default. Read data through
`src/infra/catalogue/read-model.ts` rather than fetching our own HTTP API, keep
filters in the URL with a plain GET form so they are shareable and work without
JavaScript, and give every page `alternates` from `src/lib/seo/urls.ts` so the
Sorani version is discoverable. Seller-written text is rendered with `dir="auto"`
and its own `lang`, never as HTML.

**Business logic:** it goes in `src/domain`, with unit tests that need no
database.

**A money movement:** add a recipe to `src/domain/ledger/postings.ts` with a
test proving it balances. Never insert ledger entries ad hoc.

**A database constraint:** put it in a migration with matching `down.sql`, and
add a test in `tests/db/constraints.test.ts` that writes something which should
be impossible and asserts the database refuses it.

**A protected route:** declare its permission requirement, add a row to
`CASES` in `tests/api/authorization-matrix.test.ts` with the expected status for
EVERY role, and — if it is addressed by id — add an IDOR test in
`tests/api/idor.test.ts` asserting 404 and that the victim's data is unchanged.

**A permission:** add it to `PERMISSIONS` in `prisma/seed/data.ts` and grant it
to the roles that need it. The seed REVOKES grants removed from the definition,
so privileges cannot quietly accumulate.

## Honesty rules

- Do not mark a feature complete unless it actually works and is tested.
- Label mock and test-mode code as such, in the code and in any summary.
- **Never claim Stripe has approved the business model.** Written confirmation
  does not exist yet (R-3, ADR-0007).
- Re-verify Stripe API behaviour against official documentation before writing
  payment code. Do not rely on memory or on what this repository's docs say.
