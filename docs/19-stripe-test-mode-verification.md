# 19 — Stripe test-mode verification: **BLOCKED**

**Status: BLOCKED at the pre-flight gate. No Stripe API call was made. Nothing
was set up, and nothing was simulated.**

Date of attempt: 2026-09-13.

This document records a verification run that **did not happen**. It exists so
that the absence of evidence is itself on the record, rather than being mistaken
for evidence of absence — or, worse, filled in with plausible-looking object ids
that nobody ever observed.

---

## 1. Why it stopped

The runbook in `docs/17-stripe-test-mode-setup.md` requires a Stripe **test**
secret key (`sk_test_…`) in the environment. The verification task's own
pre-flight gate says: if the key is absent, stop, set nothing up, and simulate
nothing.

**`STRIPE_SECRET_KEY` was ABSENT from the process environment.**

```
$ env | cut -d= -f1 | grep -i stripe
(no output; exit status 1)
```

No Stripe-prefixed variable of any kind was present — not the secret key, not
`STRIPE_WEBHOOK_SECRET`, not `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.

There is also no `.env.local` in the working tree (it is gitignored and the
container starts clean); only `.env.example` is present. So there was no second
place the key could have come from.

Because there was no key, there was no value to report a prefix or a length for.
No key value, and no `whsec_` value, was read, printed, logged or committed —
there were none to read.

### The full list of environment variable names found

Recorded in full, as the gate requires, so that "absent" can be checked rather
than taken on trust. Names only; no values.

```
AI_AGENT                     CLAUDE_CODE_VERSION              GIT_TERMINAL_PROMPT
ANTHROPIC_BASE_URL           CLAUDE_CODE_WORKER_EPOCH         GLOBAL_AGENT_HTTPS_PROXY
ANT_IMAGE_REPOSITORY         CLAUDE_EFFORT                    GLOBAL_AGENT_NO_PROXY
ANT_IMAGE_TAG                CLAUDE_ENABLE_STREAM_WATCHDOG    GRPC_DEFAULT_SSL_ROOTS_FILE_PATH
AWS_ACCESS_KEY_ID            CLAUDE_PID                       HEX_CACERTS_PATH
AWS_CA_BUNDLE                CLAUDE_SESSION_INGRESS_TOKEN_FILE HOME
AWS_SECRET_ACCESS_KEY        CLOUDSDK_AUTH_ACCESS_TOKEN       HTTPLIB2_CA_CERTS
BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE
                             CLOUDSDK_CORE_CUSTOM_CA_CERTS_FILE HTTPS_PROXY
BUN_INSTALL                  CLOUDSDK_PROXY_ADDRESS           IS_SANDBOX
BUN_OPTIONS                  CLOUDSDK_PROXY_PORT              JAVA_HOME
CARGO_HTTP_CAINFO            CLOUDSDK_PROXY_TYPE              JAVA_TOOL_OPTIONS
CCR_AGENT_PROXY_ENABLED      COREPACK_ENABLE_AUTO_PIN         MAX_THINKING_TOKENS
CCR_AUTO_MODE_USER_ENV_KEYS_FACT
                             CURL_CA_BUNDLE                   MCP_CONNECTION_NONBLOCKING
CCR_EGRESS_GATEWAY_ENABLED   DEBIAN_FRONTEND                  MCP_TOOL_TIMEOUT
CCR_ENABLE_TRACING           DENO_CERT                        NIX_SSL_CERT_FILE
CCR_SESSION_PROFILE          DENO_TLS_CA_STORE                NODE_EXTRA_CA_CERTS
CCR_SPAWN_TIMESTAMP_MS       DOCKER_HTTPS_PROXY               NODE_OPTIONS
CCR_TEST_GITPROXY            DOCUMENTS_MCP_SCRATCH_ROOT       NO_PROXY
CCR_UPSTREAM_PROXY_ENABLED   ELECTRON_GET_USE_PROXY           NoDefaultCurrentDirectoryInExePath
CLAUDECODE                   ENVRUNNER_SKIP_ACK               OLDPWD
CLAUDE_ADDITIONAL_DIRECTORIES ENV_MANAGER_ENABLE_DIAG_LOGS    PATH
CLAUDE_AFTER_LAST_COMPACT    FSSPEC_GCS                       PIP_CERT
CLAUDE_AUTOCOMPACT_PCT_OVERRIDE GCM_INTERACTIVE               PLAYWRIGHT_BROWSERS_PATH
CLAUDE_AUTO_BACKGROUND_TASKS GH_TOKEN                         PWD
CLAUDE_CODE_* (32 harness variables)
                             GITHUB_TOKEN                     PYTHONUNBUFFERED
                             GIT_ASKPASS                      RBENV_ROOT
                             GIT_CONFIG_COUNT                 REQUESTS_CA_BUNDLE
                             GIT_CONFIG_KEY_0..2              RUSTUP_HOME
                             GIT_CONFIG_VALUE_0..2            RUST_BACKTRACE
                             GIT_EDITOR                       SBX_TELEMETRY_SOCKET
                             GIT_SSL_CAINFO                   SESSION_INGRESS_URL
SHELL  SHLVL  SKIP_PLUGIN_MARKETPLACE  SSL_CERT_FILE  TERM  TRACEPARENT
USE_BUILTIN_RIPGREP  USE_SHTTP_MCP  UV_NATIVE_TLS  YARN_HTTPS_PROXY
https_proxy  no_proxy  npm_config_https_proxy  npm_config_noproxy
```

Every variable present is harness, proxy, TLS, or toolchain configuration. None
is a Stripe credential.

---

## 2. What was NOT verified

**Nothing in the verification plan was carried out.** Specifically, none of the
following has been observed, and this document asserts nothing about any of
them:

| # | Step | Status |
|---|---|---|
| 1 | `pnpm stripe:setup-test-plan` — real test Product + Price | **NOT RUN** |
| 2 | App built and started | **NOT RUN** |
| 3 | `stripe listen` real webhook forwarding | **NOT RUN** |
| 4 | Seller account + listing created through the app | **NOT RUN** |
| 5 | `POST /api/v1/listings/{id}/subscription` → hosted Checkout URL | **NOT RUN** |
| 6 | Real hosted Checkout completed with Playwright (card 4242…) | **NOT RUN** |
| 7 | Webhooks arrive; subscription maps to the correct listing; row reaches `ACTIVE` | **NOT VERIFIED** |
| 8 | Successful renewal via a Stripe **Test Clock** | **NOT VERIFIED** |
| 9 | `PAST_DUE` transition; listing stays visible | **NOT VERIFIED** |
| 10 | Cancellation → `PAUSED` (never removed) | **NOT VERIFIED** |
| 11 | Webhook signature: forged rejected, genuine accepted | **NOT VERIFIED** |
| 12 | Duplicate delivery deduplicated | **NOT VERIFIED** |
| 13 | Stale `customer.subscription.updated` ignored (`isStaleProviderUpdate`) | **NOT VERIFIED** |
| 14 | Listing access gate governs visibility | **NOT VERIFIED** |
| 16 | The 12 skipped real-API tests actually running | **NOT RUN** |
| 17 | `pnpm verify` | **NOT RUN** |
| 18 | Cleanup of Stripe test objects | **N/A — none created** |

### Real Stripe API calls made: **zero**

No `cus_`, `prod_`, `price_`, `cs_`, `sub_`, `in_`, `evt_`, `pi_` or `clock_`
object was created, and none is recorded here. Any such id appearing in a future
revision of this document must come from an observed API response.

### Webhook events received: **zero**

No `stripe listen` process was started. There is no event log.

### Subscription state transitions observed: **zero**

### Test totals: **none**

`pnpm test` was not run, so there is no files/passed/failed/skipped figure to
report. The database, Redis, the Stripe CLI and Playwright were all left
un-provisioned, because provisioning them would have produced a local-only
result that could be mistaken for the real verification this document is for.

---

## 3. What *was* established, and how far it goes

Only read-only inspection of source already in the repository. **This is
static-code evidence, not verification against Stripe.** It proves what the code
says, not what Stripe does.

1. **Live mode is still refused in code.** `src/infra/stripe/config.ts:58`
   reads `export const LIVE_MODE_PERMITTED = false;`, and line 82 refuses a
   `live` mode config. It is a hard-coded constant, not an environment variable.
   Unchanged by this attempt.

2. **Non-`sk_` keys are still refused.** `modeOfSecretKey` in the same file maps
   only `sk_test_` and `sk_live_` prefixes and returns `null` otherwise, which
   `decideStripeConfig` turns into a `mode_mismatch` refusal. A restricted
   (`rk_`) key cannot be configured.

3. **The real-API suite is structured to skip, loudly.**
   `tests/api/stripe-live.test.ts` gates two `describe.skipIf(!hasTestKey)`
   blocks containing **7 and 5 tests — 12 in total**, which is the set that
   would have run with a key. A third block of 4 tests (`live mode is refused`)
   runs regardless and needs no credentials. The file also prints
   `[stripe-live] SKIPPED: … The real Stripe API was NOT exercised in this run.`
   These counts come from reading the file; the suite was **not executed** in
   this attempt, so no pass/fail figure is claimed.

4. **Negative structural check — Connect vocabulary is absent from both gateway
   ports.** Grepping `src/domain/payments/payment-gateway.ts` and
   `src/domain/billing/billing-gateway.ts` for `connect`, `payout`, `transfer`,
   `destination`, `fee`, `on_behalf_of` and `stripeAccount`, with comment lines
   stripped, returns **no matches in code**. The only occurrences of those words
   anywhere in the two files are in prose comments that exist to state the
   absence. So a connected account, a destination charge, an application fee, a
   transfer and a payout remain unexpressible in the types — a buyer-to-seller
   payment path cannot be constructed through either port.

   Note the limit of this check: it covers the two domain ports named above. It
   is not a whole-repository audit, and it is static evidence, not a runtime
   observation.

Points 1–4 are the same assurances the repository already carried before this
attempt. **Nothing was added to them, and nothing new was demonstrated.**

---

## 4. Split: real vs local vs not verified

- **REAL Stripe verification:** none. Zero API calls, zero events, zero objects.
- **Local-integration verification:** none executed in this attempt. No
  database, no Redis, no app server, no test run.
- **Static source inspection:** the four points in §3 — code reads only.
- **NOT verified:** everything in the §2 table.

---

## 5. Blockers

**B-1 (blocking, the only one reached): no Stripe test credential is available
to this environment.** A `sk_test_…` secret key must be present in the process
environment (or in a `.env.local` the runner creates) before any step of the
runbook can begin.

Downstream of B-1, and therefore untested rather than known-good:

- **B-2** `STRIPE_WEBHOOK_SECRET` — supplied by `stripe listen` at run time, so
  it cannot be obtained before B-1 is cleared.
- **B-3** The Stripe CLI is not installed in this container, and Docker is not
  available. Both are solvable (the runbook covers local Postgres/Redis
  binaries), but there was no reason to provision them with the gate failed.
- **B-4** Whether the renewal, `PAST_DUE`, cancellation, signature, duplicate,
  stale-event and access-gate behaviours work against the real provider remains
  **unknown**. The code paths exist; they have never been observed running
  against Stripe.

## 6. To unblock

Provide a Stripe **test** secret key (`sk_test_…`) in the environment and re-run
this task from step 0. Do not supply a live key: `docs/17-stripe-test-mode-setup.md`
is test-mode only, and `LIVE_MODE_PERMITTED = false` refuses a live key at
startup by design.

## 7. Invariants, re-confirmed unchanged

- `LIVE_MODE_PERMITTED` is `false` and was not edited.
- `listing.subscription_required` default is untouched (`false`); no migration,
  seed or `settings` row was changed by this attempt.
- No Stripe test objects were created, so there is nothing to clean up.
- No secret, key or `whsec_` value appears in this document or in the commit
  that adds it — none existed to record.
