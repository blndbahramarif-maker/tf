# 07 — Commission Engine

## Requirement

0.5% today on Business/Cars/Furniture/Mobile/Clothing; the owner must be able to change
any category to any rate from the admin panel without a code change or deploy.
(But first read the economics warning in [04](./04-payments-architecture.md) — 0.5%
does not cover the card processing fee.)

## Design

A single table of **rules**, resolved by specificity at order-creation time, then
**snapshotted onto the order** so history is immutable.

```
commission_rules
  id
  scope_type      promo | seller | category | country | platform
  scope_id        (nullable — the seller/category/country it applies to)
  applies_to      order | subscription | promotion
  model           percentage | fixed | hybrid
  percent_bps     INT       -- basis points: 0.5% = 50, 2% = 200
  fixed_minor     BIGINT    -- flat component in minor units
  currency        CHAR(3)   -- required when fixed_minor > 0
  min_minor       BIGINT    -- optional floor
  max_minor       BIGINT    -- optional cap
  priority        INT       -- tie-break within the same scope
  effective_from  TIMESTAMPTZ
  effective_to    TIMESTAMPTZ NULL
  is_active       BOOLEAN
  created_by, created_at
```

**Basis points, not decimals.** `0.5%` stored as `50`. No floating-point money, ever.

## Resolution order (first match wins)

```
1. promo      — active campaign covering this order (time-boxed)
2. seller     — negotiated rate for this specific seller
3. category   — this category, then walk UP the category tree to the nearest ancestor
                with a rule  (ltree makes this one query)
4. country    — country-level override
5. platform   — global default
```

The category walk is what makes "set a rate on `Vehicles` and let `Vehicles > Cars >
Electric` inherit it" work, while still allowing a specific override on a child.

## Calculation

```ts
function calculateCommission(amountMinor: bigint, rule: CommissionRule): bigint {
  let c = 0n;
  if (rule.model !== 'fixed')  c += (amountMinor * BigInt(rule.percentBps)) / 10000n; // floor
  if (rule.model !== 'percentage') c += rule.fixedMinor;
  if (rule.minMinor !== null && c < rule.minMinor) c = rule.minMinor;
  if (rule.maxMinor !== null && c > rule.maxMinor) c = rule.maxMinor;
  if (c > amountMinor) c = amountMinor;        // never exceed the order
  return c;
}
const sellerAmountMinor = amountMinor - commissionMinor;  // derived, never recomputed
```

Integer division floors, so rounding always favours the seller by at most one minor
unit. That is a deliberate, documented choice — and it is consistent, which matters
more than the direction.

## Immutability

On order creation we write onto the order:
`commission_rule_id`, `commission_percent_bps`, `commission_fixed_minor`,
`commission_amount_minor`, `seller_amount_minor`.

Changing a rule tomorrow **never** alters yesterday's orders, invoices, payouts or
reports. Rules are versioned by `effective_from`/`effective_to`; admin edits create a
new row and close the old one rather than mutating in place, so the admin UI can show
"what was the Cars rate on 3 March".

## Worked example (your brief, model B from [04](./04-payments-architecture.md))

```
Business sale, asking price          £50,000.00   (5_000_000 minor)
Category rule: Business, 50 bps (0.5%)
Commission = floor(5_000_000 × 50 / 10000) = 25_000  =  £250.00
Fee-only flow: the buyer pays the £250.00 platform fee through Stripe.
Stripe fee on £250 (UK card, 1.5% + 20p)        ≈    £3.95
Platform net                                    ≈  £246.05  ✅ profitable
The £50,000 principal never touches Kurdora.
```

Compare with the destination-charge version of the same sale: platform net **−£500.20**.
Same commission rule, same code — the difference is entirely the flow choice.

## Reporting truth

Commission ≠ revenue. Every order records:
- `commission_amount_minor` — what we charged
- `payment_fee_minor` — the **actual** Stripe fee, read from the balance transaction
  via webhook (not estimated)
- `platform_net_minor = commission − payment_fee − refunded − disputed`

The admin dashboard shows all three. A dashboard that shows gross commission and calls
it revenue is how marketplaces discover too late that they are losing money.

## Admin UI requirements

- Create/edit/deactivate rules per scope, with an effective-date picker.
- **Live preview**: "at this rate, a £50,000 order yields £X commission, ~£Y Stripe
  fee, £Z net" — computed with the real engine, so the owner sees loss-making rates
  before saving.
- A **warning banner** when a saved rate is below the expected processing cost for that
  category's flow and typical order value.
- Full audit trail of who changed what, when, and the previous value.
