# 14 — Environments and test execution

What each suite needs to run, and what has actually been verified.

## Services

| Service | Version pinned | Used by |
|---|---|---|
| PostgreSQL | `postgres:17-alpine` (compose and CI) | migrations, seeds, API tests, E2E |
| Redis | `redis:7-alpine` | rate limiting, API tests, E2E |
| MinIO | `minio/minio:latest` | S3 storage driver — **never booted** |
| Mailpit | `axllent/mailpit:latest` | outbound mail — **never booted** |

## Environment variables

| Variable | Required by | Notes |
|---|---|---|
| `DATABASE_URL` | everything | |
| `TEST_DATABASE_URL` | `tests/db/*`, `tests/api/*`, E2E | Suites create and drop their own databases from this connection. Point it at a local server only. |
| `REDIS_URL` | API tests, E2E | |
| `AUTH_SECRET` | auth, CSRF signing | ≥ 32 characters. CSRF token minting throws without it rather than falling back to an unsigned token. |
| `AUTH_ENCRYPTION_KEY` | TOTP secret encryption | 32 bytes, hex |
| `APP_URL` | CSRF origin check, canonical URLs | The expected origin comes from here, never from a request header. |
| `E2E_PORT` | E2E | Defaults to 3100, so an E2E run does not collide with `pnpm dev`. |
| `PLAYWRIGHT_CHROMIUM_PATH` | E2E, optional | Points Playwright at a pre-installed Chromium whose build number does not match the pinned `@playwright/test`. CI does not set it — it installs its own. |
| `PLAYWRIGHT_NO_SANDBOX` | E2E, optional | Adds `--no-sandbox`, needed when running as root in a container. |

**`NODE_ENV` must NOT be set in `.env.local`.** Next sets it itself — `development` for `next dev`, `production` for `next build`. Exporting `NODE_ENV=development` into a build shell produces a development bundle that fails to prerender.

## Databases created by test runs

| Database | Created by | Lifecycle |
|---|---|---|
| `kurdora` | you | development |
| `kurdora_test` | you / CI | the connection other suites derive from |
| `kurdora_api_test` | `tests/api/global-setup.ts` | dropped and recreated per run |
| `kurdora_e2e` | `e2e/prepare-db.ts` | dropped and recreated per run |

The E2E database is prepared as the first half of the Playwright `webServer`
command rather than in `globalSetup`. Playwright starts the web server BEFORE
global setup, so preparing it there means the server boots against a database
that does not exist and every request fails while Playwright waits for a URL
that never becomes healthy.

## Commands

```bash
pnpm verify        # format + lint + typecheck + migrations guard + unit/API tests + openapi
pnpm test          # vitest only
pnpm test:e2e      # Playwright; builds nothing — run pnpm build first
pnpm build         # production build
```

`pnpm test:e2e` requires a current production build. The Playwright `webServer`
runs `next start`, which serves whatever `.next` contains — a stale build is
the single most confusing E2E failure, because the tests exercise code that is
no longer in the repository.

## Rate limits during E2E

Registration is capped at five per hour per IP. An E2E run is one IP making
many registrations, so `e2e/fixtures.ts` clears the `ratelimit:*` keys in Redis
before each test. **The limits themselves are not relaxed and the application
contains no test-only bypass** — the counters are reset from outside, the way
an hour passing would. `tests/api/rate-limit.test.ts` still proves the limiter
works.

## Verification status — what has and has not run

| Item | Status |
|---|---|
| PostgreSQL 16 (locally installed) | ✅ every suite has run against it |
| PostgreSQL 17 (the pinned version) | ❌ **never run** |
| Redis 7 | ✅ |
| `docker compose up` | ❌ **never executed** — no Docker daemon has been available in any session |
| MinIO / S3 driver | ❌ **never booted**; `S3StorageDriver` is NOT integration-tested |
| Mailpit | ❌ never booted; mail is not sent in any phase so far |
| GitHub Actions CI | ❌ **not observed running** — the workflow is written and its YAML parses, but no run has been watched |
| Playwright E2E | ✅ run locally against a production build, real Chromium, real database |

The CI workflow's E2E job is written against the same service images and the
same commands used locally. That is a reasonable basis for expecting it to
work; it is not evidence that it has.
