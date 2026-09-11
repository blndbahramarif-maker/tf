# ADR-0001 — Lean single application rather than split web + API

**Status:** Accepted · 2026-09-11
**Context docs:** `docs/01-tech-stack.md`, `docs/12-decisions-log.md` (DL-3)

## Context

The original architecture proposed two deployables: a Next.js web app and a
separate NestJS API. That gives clean process isolation, independent scaling and
a smaller blast radius for the money-handling code.

Kurdora is being built by one person with Claude Code. A two-service
architecture roughly doubles the work — two deployments, two dependency trees,
two CI paths, a network boundary to design, and integration overhead — for
isolation benefits a solo developer cannot fully exploit.

## Decision

One Next.js application. The HTTP API lives at `app/api/v1/*` and is written
against an OpenAPI contract, so native mobile clients can consume it unchanged
later.

Two things stay separate regardless:

1. **The worker is its own process.** Webhook processing, payout reconciliation
   and scheduled jobs must not share a web request's lifecycle. A redeploy or
   request timeout mid-way through a money operation is unacceptable, and that
   risk does not shrink because the team is small.
2. **`src/domain` is framework-free** (ADR-0002), so the API can be extracted
   into a standalone service later without touching business logic.

## Consequences

**Good.** Roughly half the setup and operational work. One deployment, one
dependency tree, one place to look. Every expensive-to-reverse decision — schema,
money model, commission engine, Stripe design, RBAC, i18n — is unaffected.

**Bad, accepted knowingly.**
- The admin console is a route group rather than a separate origin, so it shares
  the public app's process and bundle. Compensating controls are mandatory:
  enforced TOTP, step-up auth on money operations, stricter CSP, separate cookie
  scope, full audit logging.
- A crash or memory leak in page rendering takes the API with it.
- Scaling is coarser: the render layer and the API scale together.

**Reversal path.** Lift `src/domain` and `app/api` into a standalone service.
The boundary rule in ADR-0002 is what keeps that cost low, which is precisely
why it is enforced mechanically rather than by convention.

## Alternatives rejected

- **Next.js + NestJS.** Correct at team size ≥ 2. Revisit when someone else joins.
- **Server Actions instead of an HTTP API.** Fastest to write, but produces no
  contract a mobile client or third party can consume. The brief requires the
  backend not to be web-only.
