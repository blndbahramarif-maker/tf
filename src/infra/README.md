# `src/infra` — adapters

Implementations of the ports declared in `src/domain/ports`: Prisma
repositories, the Stripe gateway, Redis, object storage, mail, search.

Rules:
- May import `src/domain` and `src/shared`, plus any vendor SDK.
- Must **not** import `src/lib` (web-only glue) or anything in `app/`.
- **Only `src/infra/stripe` may import the Stripe SDK** (docs/02-system-architecture.md).
- Secrets are read here, never in `app/` and never in a client component.
