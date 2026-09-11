# ADR-0012 — Browser session transport: HttpOnly cookies, not localStorage

**Status:** Accepted (Phase 5)
**Supersedes nothing. Extends ADR-0009 (security baseline).**

## Context

Phase 3 issued bearer tokens: a 15-minute access JWT and an opaque, rotating
refresh token, returned in a JSON body. That is right for API and mobile
clients, which can hold a secret outside a web page.

Phase 5 needed the browser to hold a session. The obvious shortcut — return the
same tokens to JavaScript and keep them in `localStorage` — was rejected.

## Decision

The browser session is carried in cookies the page cannot read.

| Cookie | Contents | Flags | Path |
|---|---|---|---|
| `kurdora_at` | access token | `HttpOnly`, `SameSite=Lax`, `Secure`* | `/` |
| `kurdora_rt` | refresh token | `HttpOnly`, `SameSite=Strict`, `Secure`* | `/api/v1/auth` |
| `kurdora_csrf` | CSRF token | readable, `SameSite=Lax`, `Secure`* | `/` |
| `kurdora_sess` | presence marker, no secret | `HttpOnly`, `Secure`* | `/` |

\* `Secure` everywhere except plain-HTTP local development, where the browser
would discard the cookie and nothing would work.

CSRF uses three independent checks: `SameSite`, an `Origin`/`Sec-Fetch-Site`
check, and a signed double-submit token that is an HMAC over the session family
id.

## Why not localStorage

An access token in `localStorage` is readable by any script on the origin. One
XSS — in our code, in a dependency, in an ad tag we never add — and the attacker
exfiltrates a working session and keeps it. `HttpOnly` does not prevent an XSS
from ACTING as the user while the page is open, but it does prevent the session
from being stolen and reused later, from another machine, after the flaw is
fixed. That difference is the whole point.

It is also a one-way door in practice: once client code reads tokens from
storage, every subsequent feature assumes it, and moving to cookies later means
touching every call site.

## Why the refresh cookie is scoped to `/api/v1/auth`

It is the valuable credential — long-lived, and it mints access tokens. Scoping
it means it is not attached to ordinary page requests at all, so a flaw in a
page cannot see it even in a same-origin request.

This has one consequence worth recording, because it cost a debugging cycle: a
page at `/en/dashboard` does not receive the refresh cookie, so a Server
Component cannot tell "signed out" from "access token expired". Widening the
scope would have undone the protection. Instead `kurdora_sess` carries a
constant — no secret — purely so a page can tell the difference and bounce
through the refresh route.

## Why a GET rotates the session

Server Components can read cookies but cannot write them. A page whose access
token has expired therefore redirects to `GET /api/v1/auth/session`, which
rotates and writes cookies before redirecting back.

A GET that changes state is normally wrong. It is acceptable here because the
refresh cookie is `SameSite=Strict`: a cross-site request cannot carry it, so a
forged navigation rotates nothing. The worst outcome of forcing a same-site
navigation is a rotation the victim does not notice. The `next` parameter is
constrained to a path on this origin, so the endpoint is not an open redirect.

## Why CSRF is enforced in the guard, not per route

Same reason permissions are: a route that forgets to ask must fail closed. It
is a no-op for bearer callers and safe methods, so API clients are unaffected,
but no cookie-authenticated mutation can reach a handler without a valid token
regardless of what the handler remembered to do.

## Consequences

- API and mobile clients are unchanged; all 316 Phase 1–4 API tests still pass.
- Rotation, reuse detection, immediate suspension checks and step-up are
  untouched — the browser calls the same `rotateSession` the API does.
- Server Actions are public POST endpoints and must re-run the full guard.
  Being "internal" is not a security property.
- Step-up-requiring operations (password change, revoking another session) have
  no browser flow yet, so they are not offered in the UI rather than being
  offered and failing.
