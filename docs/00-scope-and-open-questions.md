# 00 — Scope & Open Questions

## What Kurdora is

A multi-vendor marketplace for Kurdish communities across Europe, supporting several
distinct transaction types (everyday goods, high-value assets, services, job listings)
in four languages across two writing directions, with real money moving between buyers
and sellers through a marketplace payment provider — not a classified-ads site.

## In scope for the full build
Listings with category-specific attributes · dynamic categories · powerful search ·
buyer and seller dashboards · business profiles · in-platform messaging and offers ·
Stripe Connect marketplace payments · configurable commission engine · orders, payouts,
refunds, disputes · reviews · reports and moderation · featured listings ·
business subscriptions · advertising · admin analytics · four locales with correct RTL ·
GDPR workflows · audit logging.

## Explicitly out of scope for v1 (deliberate, revisit later)
Native mobile apps (the API is built so they are additive) · multi-item cart ·
shipping-label integration · in-platform video calls · AI recommendations ·
auctions/bidding · crypto · buyer financing/BNPL · a public partner API.

---

## Open questions

> **Q-1 to Q-4 are ANSWERED** — see [12 — Decisions log](./12-decisions-log.md) for the
> answers and their full consequences. They are kept here for the record, marked
> ✅ with the answer given. Q-5 and Q-6 are answered in principle but still need the
> specific country and categories named. Q-7 onward remain open but are **not blocking
> Phase 1**.

### Q-1 · Where is the platform company legally established? ✅ **ANSWERED: UK limited company**
UK Ltd, or an EU entity, or not yet incorporated? This determines your Stripe platform
country, which cross-border corridors are supported, which consumer law applies, your
VAT position and your regulator. **Everything about the payment architecture depends on
this answer.** (Cross-border payouts support platforms in the US, UK, EEA, Canada and
Switzerland, with UK↔EEA payouts fee-free.)

### Q-2 · How do you want to cover the payment processing cost? ✅ **ANSWERED: B (fee-only) for high value; A for everyday goods**
See the arithmetic in [04](./04-payments-architecture.md) — 0.5% loses money on every
card transaction. Pick one (or a per-category mix):
- **A** — raise commission above processing cost for card-funded orders
- **B** — fee-only/success-fee for high-value; the principal never touches the platform *(my recommendation for Business/Cars)*
- **C** — restrict high-value orders to low-cost bank rails (Bacs/SEPA/Pay by Bank)
- **D** — surcharge the buyer *(likely unlawful for consumer cards in UK/EU — not recommended)*

### Q-3 · For a £50,000 sale, does the full amount go through the platform? ✅ **ANSWERED: no — fee-only**
Full amount = maximum buyer trust, but a £50,000 chargeback lands on your balance and
Stripe may not approve it. Fee-only = safe and profitable but weaker buyer protection
on the principal, which you must state honestly in the UI.

### Q-4 · What is the actual team and budget? ✅ **ANSWERED: solo, built with Claude Code → lean stack**
Solo, or a team? This decides D-7 (full stack vs lean), whether to buy or build auth,
search and the admin console, and whether the roadmap in [10](./10-roadmap.md) is
realistic. **An honest answer here saves months.**

### Q-5 · Which countries at launch? ⚠️ **PARTLY ANSWERED: one country — which one?**
"All of Europe" multiplies legal, tax, language, prohibited-goods and payment work. I
recommend launching in **one or two** countries. Which ones, and why those?

### Q-6 · Which categories at launch? ⚠️ **PARTLY ANSWERED: 3–4 categories — which ones?**
All thirteen is a lot of category-attribute schemas, moderation policies and
prohibited-item rules. I recommend three or four. Which matter most to you commercially?

### Q-7 · Who absorbs refunds and disputes?
Does the platform absorb them, or do you reverse the transfer from the seller (and
enable `debit_negative_balances`)? This must be in the seller agreement `[LEGAL REVIEW]`.

### Q-8 · Should sellers be paid immediately, or after a buyer protection window?
Immediate = happier sellers, more fraud exposure. Delayed = safer, but see R-4 on fund
holding, and it must not be described as escrow.

### Q-9 · Do you already have a Stripe account, and has Stripe seen this business model?
If not, completing the platform profile is the first thing to do in parallel with
Phase 1 — it can block everything (R-3).

### Q-10 · "Jobs" — job advertisements, or paid gig transactions?
Advertisements are `contact_only` and simple. Paid gigs are a services marketplace with
its own escrow, milestone and dispute design — a substantial addition.

### Q-11 · Mobile apps — when?
"Eventually" is already handled by the API-first design. If it is within 12 months, I
would add a couple of API affordances now (device tokens, pagination cursors, a
mobile-shaped media contract) rather than retrofit them.

### Q-12 · Domains and brand
Do you own `kurdora.com` (or the intended domain)? Confirm that "Kurdora" is a
placeholder — the architecture isolates it in `packages/brand`, so changing it later
costs a config edit and an asset swap, not a refactor.

### Q-13 · Do you have native Sorani and Kurmanji speakers available to review copy?
This is a launch dependency, not a nice-to-have (R-10).

### Q-14 · Hosting preference
Any existing infrastructure, cloud preference, or regional requirement? Default
recommendation is EU/UK region managed Postgres + containers.

---

## What happens next

Q-1 to Q-4 are answered and the documents are updated. On your approval I start
**Phase 1** — project skeleton, ADRs, OpenAPI contract v0, CI pipeline, local Docker
environment — and stop at its exit gate for your review before Phase 2.

The only answers still needed *before Phase 2 seeding* (not before Phase 1) are the
specific launch **country** and the 3–4 launch **categories** (Q-5, Q-6). My suggestions
are in [DL-4](./12-decisions-log.md#dl-4--launch-scope-one-country-34-categories).
