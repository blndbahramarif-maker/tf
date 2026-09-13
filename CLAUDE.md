# Kurdora — working conventions

Read `docs/README.md` before making architectural changes. Read
`docs/12-decisions-log.md` for the decisions that are already settled.

## Current state

**Kurdora is a CONTACT-ONLY marketplace (ADR-0014).** It provides the place
where sellers advertise and buyers find them and make contact. The transaction
happens directly between buyer and seller, OUTSIDE Kurdora.

Kurdora does not, for a seller's sale: collect the price, hold buyer money,
provide escrow, transfer money to sellers, act as payment intermediary, or
guarantee the transaction, the goods or either party. **Never write copy or
code that implies otherwise** — see the wording rules below.

Every category is `CONTACT_ONLY`, enforced by two CHECK constraints, and the
seller-sale payment surface (orders, payments, Connect onboarding, payouts, the
Stripe webhook) has been REMOVED, not disabled.

**Retained and unwired:** `src/infra/stripe/` and
`src/domain/payments/payment-gateway.ts` — the provider boundary, kept for a
possible future charge for KURDORA'S OWN services (paid listings, promotion,
advertising). That is a different thing from processing somebody else's sale.
No route calls it, nothing charges anything, and `LIVE_MODE_PERMITTED = false`
stays enforced. The order/payment/ledger/payout/refund/dispute TABLES are also
retained, empty and unwritten.

**Phases 1-6 stand:** catalogue, listings, auth and sessions, the seller
dashboard, buyer-to-seller messaging, and the offer lifecycle. An accepted offer
records agreement and moves no money — it never did.

**Safety layer (the current focus, since there is no payment step to interrupt):**
prohibited-item screening on create and publish, listing reporting, moderation
actions with an audit trail, and suspension enforced at the guard.

There is NO payment UI, NO payouts, NO refunds, NO disputes, NO reconciliation,
NO realtime transport, NO message attachments, NO blocking, NO counter-offers,
NO subscriptions, NO advertising, NO reviews and NO moderation dashboard.
See `docs/10-roadmap.md`.

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
9. **Kurdora is never party to a seller's sale.** No route may collect a sale
    price, hold buyer money, or pay a seller. Enforced by
    `categories_no_online_payment_for_seller_goods` and
    `categories_contact_only_flow` (ADR-0014). If a feature needs one of those
    relaxed, it is the wrong feature.
10. **Database changes are migrations.** Never manual production DDL, and
    **every migration ships a `down.sql`** — the migration tests fail without one.
11. **Invariants belong in the database as well as the domain.** Money rules are
    CHECK constraints and triggers, not only TypeScript (ADR-0010). Application
    checks bind only code that goes through them.
12. **The ledger is append-only and must balance.** Currently DORMANT — nothing
    writes to it, because nothing moves money. If that changes, every movement
    is a balanced entry group; use the recipes in
    `src/domain/ledger/postings.ts` rather than writing entries by hand.
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

**A listing-safety rule:** prohibited-item rules are DATA
(`prohibited_item_rules`), matched by `src/domain/safety/prohibited-content.ts`.
BLOCK refuses, REQUIRE_APPROVAL forces `PENDING_REVIEW`, FLAG publishes to
review rather than to the public. Both the dashboard action and the API route
go through `decidePublication` — one implementation, because a second is how
one path ends up missing a rule type. Screening reads the STORED text at
publish time, never the form, because a seller can write a clean draft and edit
it before publishing. **Never claim screening catches everything:** it reads
text against a list a human wrote, cannot see images and cannot infer intent.

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
- Re-verify Stripe API behaviour against official documentation before writing
  any provider code. Do not rely on memory or on what this repository's docs say.

### Wording — what the product may never say

Kurdora is not party to the sale and holds no money. Copy that implies
otherwise is not a tone problem, it is a false statement to someone deciding
whether to hand over cash. **Never write, in UI text, docs or a summary:**

- "Kurdora guarantees the seller / the buyer / the transaction"
- "buyer protection", "we protect your payment", "secure payment", "escrow"
- anything implying Kurdora has checked the goods, vetted the seller, or will
  recover a buyer's money

An E2E test asserts these strings are absent from the public pages. Say what is
true instead: buyer and seller arrange payment, delivery and collection between
themselves, and Kurdora is not part of the transaction.

Equally, do not overclaim the safety layer. Screening is a net, not a
guarantee, and reporting records a claim rather than removing a listing.

### Not legal advice

Nothing in this repository is a legal opinion. Do not describe the model as
legally risk-free, exempt from regulation, or free of obligations — a
marketplace hosting listings still has duties. No lawyer has reviewed it.
