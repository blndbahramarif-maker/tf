# Kurdora — Planning Documentation

> **Status: PHASE 1 COMPLETE — project skeleton.**
> No marketplace features exist yet: no database models, no authentication,
> no listings, no payments. Phase 2 has not started.
> Blocking decisions are answered — see **[12 — Decisions log](./12-decisions-log.md)**.
> Nothing in this repository is production-ready. Every payment statement here is
> traced to official Stripe documentation retrieved on **2026-09-11** (sources cited
> inline). Re-verify before Phase 7 implementation, because Stripe changes.

Kurdora is a planned multi-vendor marketplace for Kurdish communities across Europe.
"Kurdora" is a **working brand name** and is deliberately isolated behind a single
brand configuration module so it can be changed without touching application code.

## Read in this order

| # | Document | What it answers |
|---|---|---|
| 00 | [Scope & open questions](./00-scope-and-open-questions.md) | What we are building, what is undecided, what blocks us |
| 01 | [Technology stack](./01-tech-stack.md) | What we build it with, and **why** (with rejected alternatives) |
| 02 | [System architecture](./02-system-architecture.md) | Services, boundaries, data flow, deployment |
| 03 | [Database architecture](./03-database-architecture.md) | Schema, relationships, indexes, money representation |
| 04 | [Payment architecture](./04-payments-architecture.md) | Stripe Connect design — **read the economics warning** |
| 05 | [Roles & permissions](./05-roles-and-permissions.md) | RBAC model, admin capabilities |
| 06 | [Transaction flows](./06-transaction-flows.md) | Buy Now, Offer→Accept→Pay, fee-only, contact-only |
| 07 | [Commission engine](./07-commission-engine.md) | Configurable rules, resolution order, immutability |
| 08 | [Security architecture](./08-security-architecture.md) | Threat model and controls |
| 09 | [Internationalisation & RTL](./09-i18n-rtl.md) | en / ckb / kmr / ar, bidirectional layout |
| 10 | [Development roadmap](./10-roadmap.md) | Phases 0–14 with exit criteria |
| 11 | [Risks & decisions](./11-risks-and-decisions.md) | What can sink this project |
| 12 | **[Decisions log](./12-decisions-log.md)** | **Your answers, and exactly what they changed — read this second** |
| 13 | **[Dependencies & blockers](./13-dependencies-and-blockers.md)** | **External, non-engineering items that can block a phase** |
| 14 | [Environments](./14-environments.md) | Local, CI and production configuration |
| 15 | **[Phase 7 gate](./15-phase-7-gate.md)** | **Stripe Connect architecture, verified 2026-09-12. Live mode blocked pending Stripe approval** |
| 16 | **[Phase 7 Part 2](./16-phase-7-part-2.md)** | **Connected-account onboarding. Implemented and tested against a FAKE provider — the real Stripe API was never called** |
| — | [Architecture decision records](./adr/) | Why each structural choice was made |

## Legal notice

This documentation contains **no legal advice**. Sections touching consumer law, VAT,
payment-services regulation, the EU Digital Services Act, GDPR and prohibited-goods
rules are flagged `[LEGAL REVIEW]` and must be reviewed by a qualified UK/EU lawyer
and a tax adviser before launch.
