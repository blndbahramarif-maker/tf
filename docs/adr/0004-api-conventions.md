# ADR-0004 — API conventions: versioning, money-as-string, cursor pagination, idempotency

**Status:** Accepted · 2026-09-11
**Contract:** `openapi/openapi.yaml`, `src/shared/api-contract.ts`

## Context

The API will be consumed by the web app now and by native mobile apps later.
Conventions chosen now are extremely expensive to change once clients exist in
app stores, where old versions keep calling the old contract for years.

## Decisions

**Path versioning (`/api/v1`).** Visible in logs and in client code; trivially
routable. Header-based negotiation is more elegant and harder to debug at 3am.

**Money is an integer minor-unit value sent as a STRING.**
`{ "amountMinor": "5000000", "currency": "GBP" }` is £50,000.00.
JSON numbers are IEEE-754 doubles in every JavaScript client; 64-bit integers
above 2^53 lose precision silently. Silent precision loss on money is
unacceptable, so the value crosses the wire as a string and is parsed to `BigInt`.

**Cursor pagination, never offset.** Offset pagination duplicates and skips rows
when the underlying set changes mid-scroll, which is the normal case for a
listing feed with continuous new inserts. Cursors are also what mobile
infinite-scroll needs.

**`Idempotency-Key` required on every request that creates a resource or moves
money.** Replaying a key returns the original response. Without this, a
double-tapped Buy button, a retried request after a timeout, or a flaky mobile
network becomes a double charge.

**Errors use one envelope with a machine-readable `code`.** Clients switch on
`code`, never on `message` — messages are localised and will change.

**API routes are not locale-prefixed.** Clients send `Accept-Language`.
User-generated content is returned in its authored language with a
`contentLocale` field; we never machine-translate a seller's words silently.

**Payment state is never accepted from a client.** No endpoint will ever take a
client assertion that a payment succeeded. Order state changes only on a
signature-verified Stripe webhook.

## Consequences

**Good.** One contract serves web and mobile. Money precision is safe by
construction. Retries are safe by construction.

**Bad.** Money requires explicit conversion at every boundary — verbose, and it
will feel like friction. That verbosity is the feature.

## Alternatives rejected

- **Money as a number.** Works until an order exceeds £90 trillion in minor
  units — but it also invites `parseFloat` and arithmetic in the client, which
  is the actual risk.
- **GraphQL.** Excellent for varied client needs; adds schema, caching and
  rate-limiting complexity that one developer does not need at this stage.
