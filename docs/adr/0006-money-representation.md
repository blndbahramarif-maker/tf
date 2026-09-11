# ADR-0006 — Money as integer minor units, rates as basis points

**Status:** Accepted · 2026-09-11
**Context docs:** `docs/03-database-architecture.md`, `docs/07-commission-engine.md`

## Context

Kurdora handles commission on transactions up to £50,000, in multiple
currencies, with figures that must reconcile exactly against Stripe. Floating
point cannot represent 0.1 exactly; accumulated error in money is unrecoverable
trust damage and, in an audit, a finding.

## Decisions

**Amounts are integers in minor units.** £50,000.00 is `5000000`. Stored as
Postgres `BIGINT`, handled as `BigInt` in TypeScript, serialised as a string
(ADR-0004). Always paired with an ISO-4217 currency code — an amount without a
currency is meaningless.

**Rates are integer basis points.** 0.5% is `50`; 6% is `600`. No decimal
percentages anywhere.

**Commission formula** (`docs/07-commission-engine.md`):

```
commission = clamp(floor(amountMinor × percentBps / 10000) + fixedMinor, min, max)
sellerAmount = amountMinor − commission        // derived, never recomputed
```

The seller amount is obtained by subtraction so the two figures cannot disagree
by a penny. Integer division floors, so rounding consistently favours the seller
by at most one minor unit — a deliberate, documented choice.

**`parseFloat` is banned** by lint rule. `Number`, `toFixed` and decimal literals
must not appear in money paths.

**Commission is snapshotted onto the order** at creation: rule id, basis points,
fixed component, computed amount. Changing a rule later never rewrites history.

## Consequences

**Good.** Exact arithmetic. Reconciles with Stripe, which also uses minor units.
Historical orders are immutable.

**Bad.** `BigInt` is verbose and does not serialise to JSON natively, so every
boundary needs explicit conversion. Currencies with other than two minor digits
(JPY, KWD) need a per-currency digit count — the `currencies` table carries one
from Phase 2.

## Alternatives rejected

- **`Decimal` / `NUMERIC`.** Exact, but invites decimal arithmetic in
  JavaScript where no exact decimal type exists, so values round-trip through
  strings anyway. Minor units match Stripe and remove the question.
- **Floating point.** Never, for money.
