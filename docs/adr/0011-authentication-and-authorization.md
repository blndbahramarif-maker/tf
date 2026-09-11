# ADR-0011 — Authentication and authorization design

**Status:** Accepted · 2026-09-11
**Context docs:** `docs/08-security-architecture.md`, `docs/05-roles-and-permissions.md`

## Context

Phase 3 had to make three decisions that are expensive to reverse once accounts
exist: how sessions are represented, where authorization is decided, and what a
refused request is allowed to reveal.

## Decisions

### Split tokens: short JWT access, opaque rotating refresh

Access tokens are HS256 JWTs valid for **15 minutes**, carrying the subject,
session family, roles and permissions. Refresh tokens are opaque 256-bit random
values, stored only as SHA-256 hashes, valid for 30 days.

Carrying permissions in the token avoids a database round trip per request. The
cost is staleness: a revoked role keeps working until the access token expires.
Fifteen minutes bounds that, and refresh re-reads the database.

Two things are **not** trusted to the token and ARE read from the database on
every authenticated request: account status and whether any held role requires
two-factor. A suspension must bite immediately, not in fifteen minutes. That is
two queries per request, accepted deliberately.

### Rotation with family revocation

Each refresh mints a new token and revokes the presented one, so a token is
valid exactly once. Presenting a revoked token revokes the **entire family**.

We cannot distinguish a thief replaying a stolen token from a user replaying
their own, so both are ejected. This is the standard mitigation for refresh
token theft and it is the reason rotation is worth the complexity.

The response to reuse is byte-identical to the response for an unknown token:
telling an attacker "reuse detected" confirms they hold something real.

### Deny by default, in the domain layer

`checkAccess` is a pure function in `src/domain/rbac`. A route declares what it
needs; **an empty requirement is denied**. A route that forgets to say what it
needs fails closed.

Two guards always run: permission, then ownership. Permission alone would let
any seller edit any listing — the classic marketplace bug.

### Ownership answers 404, never 403

A resource that exists but belongs to someone else returns exactly what a
non-existent id returns. A 403 here would confirm existence and turn every
`/{id}` route into an oracle for enumerating other people's records.

Both paths go through one `notFound()` helper so they cannot drift apart, and a
test asserts the two responses are identical.

### Mandatory two-factor for staff, as data

`roles.requires_two_factor` is a column, not a hard-coded list of role names, so
the owner can require two-factor for a new role without a deploy. A staff
account without TOTP cannot sign in at all — the role grants nothing until
enrolment is complete.

Ten single-use recovery codes are issued at enrolment. Without them, mandatory
two-factor turns a lost phone into permanent loss of the platform owner's
account (R-13).

### Step-up authentication

Sensitive actions require a re-authentication within the last 15 minutes,
carried as a claim so no database read is needed. In Phase 3 this gates password
change, two-factor management and revoking all sessions. From Phase 7 it gates
refunds, payout release and commission changes.

Where two-factor is enrolled, step-up demands it again: a stolen session plus a
known password must not reach money operations.

### Rate limiting fails OPEN; authorization fails CLOSED

If Redis is unavailable, rate limiting lets requests through rather than taking
the site down. It is an abuse control, not an authorization control, and must
never be the only thing between an attacker and an action — which is why
per-account lockout with exponential backoff backs it up on the login path.
Lockout survives IP rotation; a rate limiter does not.

## Consequences

**Good.** Stolen access tokens expire quickly; stolen refresh tokens are
single-use and self-destruct the session family. Suspension is immediate.
Enumeration is closed on registration, login and every owned resource.
Authorization logic is pure and unit-tested without a database, and the
role × route matrix is executed as 126 assertions rather than described.

**Bad, accepted.**
- Two database queries per authenticated request.
- Permission changes take up to 15 minutes to take effect.
- Family revocation logs out an innocent user when their own replay is
  mistaken for theft. Correct trade: the alternative is leaving a thief in.
- HS256 with a shared secret means any service verifying tokens can also mint
  them. Fine for one application; move to asymmetric signing (RS256/EdDSA) if
  the API is ever split out (ADR-0001).

## Alternatives rejected

- **Opaque sessions with a database lookup per request.** Simpler to revoke,
  but a read on every request including static-ish reads. Revisit if the
  15-minute staleness window proves unacceptable.
- **A managed identity provider.** Still a live option (D-3). Rejected for now
  because seller lifecycle state is entangled with authorization and must be
  transactional with our own data.
- **Storing permissions only in the database.** Would remove staleness at the
  cost of a join on every request. The 15-minute bound is the compromise.
