# ADR-0009 — Phase 1 security baseline and explicitly deferred controls

**Status:** Accepted · 2026-09-11
**Context docs:** `docs/08-security-architecture.md`

## Context

Phase 1 has no authentication, no user data and no payments, so most controls
in the security architecture have nothing yet to protect. The risk at this stage
is the opposite one: shipping placeholder controls that *look* implemented and
are never revisited.

## In place now

- **Secrets never reach the browser.** `src/infra/env.ts` splits server and
  client configuration; only publishable values may appear in `clientEnv`. The
  custom lint rule `kurdora/no-public-env-secrets` fails the build on a
  secret-looking `NEXT_PUBLIC_*` variable, and is tested.
- **Environment validated at boot**, with stricter requirements under
  `APP_ENV=production` — including a refusal to start production with a Stripe
  **test** key, which would otherwise silently produce fake payments.
- **Baseline response headers**: `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
- **`poweredByHeader: false`** — no free version disclosure.
- **Secret scanning in CI** (gitleaks) over full history.
- **Dependency audit in CI** (advisory now, blocking in Phase 12).
- **`.gitignore` denies all `.env*` except `.env.example`.**
- **Local credentials are obviously local** and documented as such in
  `docker-compose.yml`.

## Deliberately deferred, with the phase that owns them

| Control | Phase | Why not now |
|---|---|---|
| Content-Security-Policy with per-request nonces | 12 | Needs real UI and a nonce pipeline in middleware. A permissive placeholder CSP is worse than none: it looks done |
| Argon2id hashing, refresh rotation, reuse detection | 3 | No authentication exists |
| RBAC and ownership guards | 3 | No resources to own |
| Rate limiting (Redis token buckets) | 3 | No endpoints worth limiting |
| Upload validation, magic bytes, re-encode, EXIF strip | 4 | No uploads |
| Webhook signature verification, exactly-once processing | 7 | No webhooks |
| Idempotency enforcement | 7 | Convention defined in ADR-0004, enforced when money moves |
| Audit logging interceptor | 3 | No mutating actions |
| GDPR export and deletion workflows | 12 | No personal data |
| External penetration test | before live payments | Nothing to test |

**Nothing in this table may be described as implemented until its phase ships
and its tests pass.**

## Consequences

**Good.** The two controls that matter at this stage — secret leakage and
configuration error — are mechanically enforced and tested. What is missing is
listed, owned and dated, rather than assumed.

**Bad.** The application is not secure for production use today, and must not be
exposed to the internet with real users before Phase 12.
