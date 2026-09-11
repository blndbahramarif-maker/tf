# 08 — Security Architecture

## Threat model (what actually attacks a marketplace)

| Threat | Realistic scenario | Primary control |
|---|---|---|
| Account takeover | Credential stuffing against sellers with payout accounts | Argon2id, rate limiting, breach-password check, 2FA, device/IP anomaly alerts |
| Payment manipulation | Client posts `amount: 1` for a £50,000 car | Server-side amount derivation; the request body never sets price |
| Fake payment confirmation | Attacker calls the success callback without paying | Order state changes only on signature-verified webhooks |
| Webhook forgery / replay | Fake `payment_intent.succeeded` | Signature verification + `evt_` id as primary key |
| Duplicate charge / payout | Network retry, double-click | Deterministic idempotency keys + `idempotency_keys` table |
| Seller payout hijack | Attacker redirects a seller's payout | Payout details live at Stripe, never in our DB; step-up auth; change alerts |
| Commission bypass | Parties move off-platform to avoid the fee | Risk scoring + moderation queue (**not** silent censorship) |
| Stolen/counterfeit goods | Illegal listings | Prohibited-item rules per country, moderation queue, reporting |
| Malicious upload | Polyglot image with embedded payload | Magic-byte validation + **full re-encode** + separate serving origin |
| Stored XSS | Script in a listing description | React escaping + sanitised server-side rendering + strict CSP |
| IDOR | `GET /orders/<someone-else's-id>` | Ownership guard on every resource, deny by default |
| Scraping | Competitor harvesting listings and contacts | Rate limits, no contact details until engagement, bot detection |
| Admin compromise | One admin phished → total loss | Separate subdomain, mandatory 2FA, step-up auth, audit log, least privilege |

## Authentication

- **Argon2id** password hashing (OWASP parameters: m=19456 KiB, t=2, p=1). Never
  MD5/SHA/bcrypt-without-cost-review.
- Password policy: length-based (min 12), checked against a breached-password list;
  no arbitrary composition rules.
- **Access token**: JWT, 15 min, signed, minimal claims (`sub`, `roles`, `jti`).
- **Refresh token**: opaque, hashed at rest, 30 days, **rotated on every use** with
  **reuse detection** — a replayed refresh token revokes the entire token family and
  alerts the user. This is what limits the damage of a stolen token.
- Web transport: refresh token in `HttpOnly; Secure; SameSite=Lax` cookie.
  Mobile: secure keychain/keystore + bearer.
- Email verification required before selling, messaging or paying.
- Phone verification required before publishing (strong anti-spam signal).
- 2FA (TOTP) optional for users, **mandatory for all staff roles**.
- Account lockout with exponential backoff; generic error messages (no user enumeration).

## Authorisation
Deny by default. Permission guard + ownership guard on every route ([05](./05-roles-and-permissions.md)).
Integration tests assert that a non-owner receives 403/404 on every owned resource —
this test suite is a merge gate.

## Input / output
- **Zod schemas shared** between client and server; the server always re-validates.
- Prisma parameterises all queries; raw SQL uses `$queryRaw` tagged templates only —
  string-concatenated SQL is banned by lint rule.
- HTML output: React escapes by default; any rich text is sanitised server-side with an
  allowlist (no `dangerouslySetInnerHTML` on user content without sanitisation).
- **CSP with per-request nonces**, no `unsafe-inline`, no `unsafe-eval`.
  Plus HSTS (preload), `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
  `Permissions-Policy`, frame-ancestors `none`.
- CSRF: `SameSite` cookies + double-submit token on cookie-authenticated mutations.
  Bearer-authenticated (mobile) requests are not CSRF-exposed.

## File uploads
1. Client requests a **short-lived presigned URL** (auth + quota + MIME checked first).
2. Upload goes **direct to object storage** — bytes never touch the API.
3. A worker then: verifies **magic bytes** (not the declared `Content-Type`, not the
   extension), enforces size and dimension limits, rejects SVG entirely,
   **fully re-encodes** with `sharp` (this strips EXIF/GPS and destroys any embedded
   payload), generates WebP/AVIF derivatives, and optionally scans with ClamAV.
4. Serving: `cdn.kurdora.com`, a **cookieless origin**, with
   `Content-Disposition` and `X-Content-Type-Options: nosniff`.
5. Only after successful processing does the image become visible.

Stripping GPS EXIF is a **safety** feature, not just hygiene: a seller photographing an
item at home should not publish their coordinates.

## Rate limiting & abuse
Redis token buckets, layered per IP + per user + per route class:
login/register/reset (strict), messaging, offers, listing creation, reports, search,
webhooks (generous but monitored). Progressive delays, then temporary blocks.
Registration behind a privacy-respecting CAPTCHA (hCaptcha/Turnstile) when risk is elevated.

## Messaging safety — designed, not knee-jerk

Your brief is explicit: do not automatically censor legitimate communication. So:

- Messages are **scored**, not blocked. Signals: contact details exchanged before any
  order, external payment links, urgency/pressure language, near-duplicate messages
  across many conversations, brand-new account with high volume.
- A high score routes the conversation to the **moderation queue** and may show the
  *sender* a non-blocking safety notice. It does not delete or silently edit the
  message.
- Users see a persistent, dismissible safety banner on high-value categories
  (inspect before paying, never pay outside the platform, meet in public).
- Blocking and reporting are always one click away, in every conversation.
- Moderator access to message content is **permission-gated and audited** — a moderator
  reading a reported conversation leaves a trail.
- `[LEGAL REVIEW]` Message scanning and retention have GDPR implications; the privacy
  policy must disclose it accurately and the lawful basis must be confirmed.

## Payment security
See [04](./04-payments-architecture.md) §"Security rules for payment code". Summary:
no card data ever stored; webhook signature verification with the raw body; exactly-once
event processing; deterministic idempotency keys; server-side amounts only; secret keys
only in the API's secret store; asynchronous webhook processing; nightly reconciliation.

## Secrets & supply chain
- Managed secret store; nothing in the repo; `.env.example` holds names only.
- Distinct credentials per environment; documented rotation procedure.
- `NEXT_PUBLIC_*` is audited in CI — a lint rule fails the build if a name matching
  `SECRET|KEY|TOKEN|PASSWORD` is exposed to the client bundle.
- Lockfiles committed; `pnpm audit` + Dependabot/Renovate; SBOM generated at build;
  images pinned by digest; `gitleaks` pre-commit and in CI.

## Audit & monitoring
- Append-only `audit_logs` (no UPDATE/DELETE grant), written by an interceptor.
- Alerts on: repeated failed logins, admin privilege change, refund above a threshold,
  payout hold/release, webhook signature failures, ledger imbalance, reconciliation drift.
- Correlation id flows request → job → Stripe idempotency key, so one order is traceable
  end to end.

## GDPR / privacy by design `[LEGAL REVIEW]`
EU/UK data residency · data inventory per table with purpose and retention ·
cookie consent before any non-essential cookie · self-service data export ·
deletion request workflow (anonymise + retain pseudonymised financial records —
see [03](./03-database-architecture.md)) · consent versioning · DPA register for
processors (Stripe, email, storage, search, error tracking) · breach-notification
runbook. **A qualified lawyer must review the privacy policy, DPAs, retention periods,
message-scanning basis and the seller agreement.**

## Compliance surface that needs professional review `[LEGAL REVIEW]`
- UK/EU consumer law: distance selling, 14-day withdrawal rights where the seller is a
  trader, statutory guarantees.
- **EU Digital Services Act** — online marketplaces have specific obligations:
  trader traceability (KYB), notice-and-action, statements of reasons for moderation
  decisions, internal complaint handling, transparency reporting. **This materially
  affects the moderation and verification design and should be scoped before Phase 9.**
- VAT/OSS/IOSS, and whether the marketplace is a deemed supplier in any flow.
- Payment-services regulation if funds are held (see [04](./04-payments-architecture.md)).
- Per-country prohibited and restricted goods.
- Age restrictions where relevant.
