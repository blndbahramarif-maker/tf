# ADR-0008 — Toolchain version constraints

**Status:** Accepted · 2026-09-11

## Context

The newest major version is not automatically the right one. During Phase 1
setup, installing latest-everything produced a toolchain that could not run:
**TypeScript 7.0 is not supported by typescript-eslint**, which aborts on
startup. The Prisma CLI also resolved to a release candidate while the client
resolved to stable, which would have produced schema/client drift.

This is the "boring, well-documented technology" principle from
`docs/01-tech-stack.md` meeting reality.

## Decisions

| Tool | Version | Reason |
|---|---|---|
| Node | 22 LTS | Pinned in `.nvmrc` and CI |
| pnpm | 10.x | Pinned via `packageManager` |
| TypeScript | **^6** | 7.0 breaks typescript-eslint; revisit when it supports TS ≥ 7.1 |
| Prisma CLI + client | **7.10.0 stable, matched** | CLI and client must match exactly; no release candidates |
| Next.js | 16.x | Current stable |
| ESLint | 10.x with flat config | |
| Vitest | 5.x | |

**Rules going forward:**
1. **No release candidates, betas or previews in `package.json`.** The one
   anticipated exception is a Stripe preview API version, which would be an
   explicit, documented decision in Phase 7 — not an accident of resolution.
2. **Prisma CLI and client versions must match exactly.**
3. **Verify the toolchain runs before writing code against it.** Installing and
   assuming is how a day gets lost.
4. Dependency upgrades are their own change, never bundled with a feature.

## Consequences

**Good.** The toolchain works. Version choices are recorded with reasons rather
than being archaeology later.

**Bad.** We are deliberately one major behind on TypeScript, so some newer
language features are unavailable. Acceptable: a working lint pipeline is worth
more than new syntax.

**Review trigger.** When typescript-eslint announces TS ≥ 7 support, upgrade as
a standalone change and update this ADR.
