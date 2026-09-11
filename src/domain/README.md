# `src/domain` — business logic

**This layer must not import Next.js, React, next-intl, Prisma, or the Stripe
SDK.** Enforced by `eslint.config.mjs`; a violation fails CI.

It may import: `src/domain/*`, `src/shared/*`, `zod`, Node built-ins.

## Why

Three payoffs, all of which are expensive to retrofit:

1. **Testable without booting anything.** Commission maths, the order state
   machine and the ledger invariant are unit tests with no database.
2. **The API can be extracted later.** If the lean single-app deployment stops
   being enough, `src/domain` lifts into a standalone service unchanged,
   because it never knew it was inside Next.js (ADR-0001).
3. **Providers are swappable.** Domain depends on *ports* (interfaces); `src/infra`
   supplies the implementations. Exactly one module in the codebase imports the
   Stripe SDK.

## Ports

Define an interface in `src/domain/ports` and implement it in `src/infra`.
The domain never learns which vendor is behind a port.
