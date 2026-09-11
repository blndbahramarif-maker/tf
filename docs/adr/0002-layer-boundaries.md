# ADR-0002 — Framework-free domain layer with mechanically enforced boundaries

**Status:** Accepted · 2026-09-11

## Context

Marketplace business logic — commission calculation, the order state machine,
the ledger, offer expiry, payout eligibility — is where correctness matters most
and where bugs are most expensive. In a typical Next.js codebase that logic ends
up inside route handlers and server components, entangled with request objects
and rendering, where it can only be tested by booting the framework.

## Decision

Four layers, with dependencies pointing inward only:

```
app/  →  src/lib  →  src/infra  →  src/domain  →  src/shared
```

- **`src/shared`** — pure: types, Zod schemas, money maths, state machines.
- **`src/domain`** — business logic. **May not import Next.js, React, next-intl,
  Prisma, or the Stripe SDK.** Depends on *ports* (interfaces) that `src/infra`
  implements.
- **`src/infra`** — adapters: Prisma, Stripe, Redis, storage, mail, search.
  Exactly one module may import the Stripe SDK.
- **`src/lib`** — web-only glue.
- **`app/`** — routes and UI.

Enforced by `no-restricted-imports` rules per path in `eslint.config.mjs`, and
**verified by `tests/architecture.test.ts`**, which lints deliberate violations
and asserts each rule fires. A guard nobody tested is a guard you discover was
broken when the violation is already in production.

## Consequences

**Good.** Commission and ledger logic are unit-tested with no database and no
framework. Provider swaps are contained. The API extraction in ADR-0001 stays
cheap. New contributors get an immediate, specific error rather than a review
comment weeks later.

**Bad.** More indirection: using the database from domain code requires defining
a port first. This friction is intentional and is the point.

## Alternatives rejected

- **Convention only, documented in a README.** Conventions decay. This one is
  load-bearing for testability and portability, so it is mechanical.
- **`eslint-plugin-boundaries`.** More expressive, but heavier to configure and
  harder to debug. Path-scoped `no-restricted-imports` is legible to one person
  reading the config cold. Revisit if the layer graph gets more complex.
