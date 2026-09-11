# 05 — Roles & Permissions

## Model: roles → permissions, plus resource-level ownership guards

A role is a bag of permissions. A permission is `resource:action` (e.g.
`listing:moderate`, `payout:release`). Two checks always run:

1. **Permission guard** — does this role hold `listing:update`?
2. **Ownership guard** — is *this* listing owned by the caller?

Both are required. Permission alone would let any seller edit any listing.

`buyer` and `seller` are **capabilities of one account**, not separate logins. A user
browses as a buyer and gains seller permissions once a seller profile exists. This
avoids the classic marketplace mistake of duplicate accounts and split reputation.

## Roles

| Role | Granted when | Notes |
|---|---|---|
| `guest` | unauthenticated | Browse, search, view listings and public seller profiles |
| `buyer` | on registration + email verification | |
| `seller` | on creating a seller profile | Publishing a *payable* listing additionally requires `payouts_enabled` from Stripe |
| `business_seller` | seller profile with a verified business | Business profile, subscription features |
| `moderator` | assigned by admin | Trust & safety only — **no financial permissions** |
| `support` | assigned by admin | Read-only on orders/payments, can message users, cannot move money |
| `finance` | assigned by admin | Refunds, payouts, commission rules — **no user-content moderation** |
| `admin` | assigned by owner | Broad platform administration |
| `super_admin` | the owner | Role assignment, settings, destructive actions |

Moderation and finance are deliberately separated. The person who hides a listing
should not be the person who can issue a £50,000 refund.

## Permission catalogue (abridged)

```
listing:create|read|update|delete|publish|feature|moderate|approve|reject
category:create|update|delete|reorder|set_commission
order:read_own|read_any|cancel|refund|update_status
payment:read_own|read_any|retry|reconcile
payout:read_own|read_any|release|hold|reverse
commission:read|create|update|delete
seller:verify|suspend|reinstate|read_verification
user:read|suspend|ban|impersonate|export_data|delete_data
message:read_own|read_reported|moderate
review:create|read|hide|remove|restore
report:read|assign|resolve|escalate
subscription:read|create|cancel|refund
advertisement:create|update|delete|read_stats
setting:read|update
translation:read|update|publish
analytics:read_basic|read_financial
audit:read
```

## Rules with teeth

- **No implicit escalation.** A moderator cannot grant themselves `payout:release`;
  only `super_admin` holds `role:assign`.
- **Step-up authentication** (re-enter password + TOTP) is required for:
  refunds, payout release/hold, commission rule changes, user bans, role assignment,
  settings changes, data deletion. Session freshness window: 15 minutes.
- **Every admin action writes an `audit_log`** with before/after state via an
  interceptor — it cannot be forgotten by a developer.
- **Impersonation** (support viewing a user's account) is time-boxed, loudly banner-ed
  to the impersonated session's audit trail, read-only by default, and can never be
  used to trigger payments.
- **2FA is mandatory** for `moderator`, `support`, `finance`, `admin`, `super_admin`.
  Login is refused without it, not merely nagged.
- Admin console lives on its own subdomain with its own cookie scope, stricter CSP and
  optional IP allowlist.

## What the admin dashboard manages

Everything in brief section 3, mapped to modules: users · buyers · sellers ·
businesses · listings · categories & subcategories · category attributes · countries ·
cities · payments · transactions · orders · refunds · disputes · seller verification ·
payouts · **commission rules** · featured listings · advertisements · subscriptions ·
reviews · reports · bans · **languages & translations** · notifications · prohibited-item
rules · platform settings · audit log · analytics.

None of these are hard-coded. Categories, commission rates, promotion prices,
subscription prices, country availability, prohibited-item rules and UI translations
are all database-backed and editable without a deploy.
