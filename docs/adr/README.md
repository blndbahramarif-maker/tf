# Architecture Decision Records

One file per significant, hard-to-reverse decision. Format: context → decision →
consequences (including the bad ones) → alternatives rejected and why.

An ADR is **immutable once accepted**. If a decision changes, write a new ADR
that supersedes the old one and mark the old one `Superseded by ADR-XXXX`.
The record of what we believed at the time is the valuable part.

| ADR | Title | Status |
|---|---|---|
| [0001](./0001-lean-single-application.md) | Lean single application rather than split web + API | Accepted |
| [0002](./0002-layer-boundaries.md) | Framework-free domain layer with enforced boundaries | Accepted |
| [0003](./0003-postgresql-and-prisma.md) | PostgreSQL with Prisma, raw SQL for money and search | Accepted |
| [0004](./0004-api-conventions.md) | API versioning, money-as-string, cursor pagination, idempotency | Accepted |
| [0005](./0005-locale-routing-and-rtl.md) | Always-prefixed locale routing and logical-property RTL | Accepted |
| [0006](./0006-money-representation.md) | Integer minor units and basis points | Accepted |
| [0007](./0007-stripe-connect-shape.md) | Destination charges plus fee-only for high value | Superseded in part by 0013 |
| [0008](./0008-toolchain-versions.md) | Toolchain version constraints | Accepted |
| [0009](./0009-security-baseline.md) | Phase 1 security baseline and deferred controls | Accepted |
| [0010](./0010-database-invariants.md) | Correctness enforced by the database, not only by application code | Accepted |
| [0011](./0011-authentication-and-authorization.md) | Authentication and authorization design | Accepted |
| [0012](./0012-browser-session-transport.md) | Browser session transport: HttpOnly cookies and signed double-submit CSRF | Accepted |
| [0013](./0013-phase-7-payment-architecture.md) | Phase 7 payment architecture, re-verified against Stripe docs | Accepted |
