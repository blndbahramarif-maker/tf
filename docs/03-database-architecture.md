# 03 — Database Architecture

PostgreSQL 17. Managed with Prisma migrations. Every change ships as a migration; no
manual production DDL.

## Cross-cutting conventions

| Convention | Rule | Why |
|---|---|---|
| Primary keys | UUIDv7 (`id UUID`) | Time-sortable, no enumeration of your listing/user count, safe in URLs and across services |
| Money | `amount_minor BIGINT` + `currency CHAR(3)` | **Never floats.** £50,000.00 = `5000000`. Rounding errors in commission are unrecoverable trust damage |
| Percentages | **Basis points** `INT` (`percent_bps`) | 0.5% = `50`. Integer maths, no float drift |
| Timestamps | `TIMESTAMPTZ`, always UTC | Rendered per user time zone at the edge |
| Soft delete | `deleted_at TIMESTAMPTZ NULL` on user-facing entities | GDPR erasure vs. statutory financial retention — see below |
| Status | Postgres `ENUM` types | Constraint at the database, not just the app |
| Audit | `created_at`, `updated_at`, `created_by`, `updated_by` | Plus append-only `audit_logs` |
| Mode | `livemode BOOLEAN` on all payment-touching rows | Test data can never contaminate live reporting |

### Money arithmetic rule
```
commission_minor = clamp(
    floor(amount_minor * percent_bps / 10000) + fixed_minor,
    min_minor, max_minor)
seller_amount_minor = amount_minor - commission_minor      // exact, by construction
```
The seller amount is derived by subtraction, never computed independently, so the two
can never disagree by a penny.

## Entity map

### Identity & access
- **users** — `email` (citext, unique), `email_verified_at`, `password_hash` (Argon2id),
  `phone_e164`, `phone_verified_at`, `preferred_locale`, `timezone`, `status`
  (`active|suspended|banned|pending_deletion`), `last_login_at`, `failed_login_count`,
  `locked_until`, `two_factor_secret_enc`, `two_factor_enabled_at`.
- **profiles** — display name, avatar, bio, country_id, city_id (1–1 with users).
- **roles**, **permissions**, **role_permissions**, **user_roles** — RBAC ([05](./05-roles-and-permissions.md)).
- **sessions** / **refresh_tokens** — `token_hash`, `family_id`, `rotated_from`,
  `expires_at`, `revoked_at`, `ip`, `user_agent`. Reuse detection revokes the family.
- **oauth_identities** — reserved for future social login.

### Selling
- **seller_profiles** — `user_id`, `seller_type` (`individual|business`), `slug`
  (unique), `display_name`, `logo_url`, `about`, `country_id`, `city_id`,
  `verification_status` (`unverified|pending|verified|rejected|suspended`),
  `stripe_account_id`, `payouts_enabled`, `charges_enabled`, `requirements_due JSONB`,
  `response_rate`, `response_time_minutes`, `rating_avg`, `rating_count`, `member_since`.
- **businesses** — `seller_profile_id`, `legal_name`, `registration_number`,
  `vat_number`, `registered_address`, `company_type`, `website`, `verified_at`.
  **We do not store passports, ID scans or bank account numbers** — Stripe collects and
  holds those ([04](./04-payments-architecture.md)).
- **seller_verification_events** — append-only trail of status changes with actor and reason.

### Geography
- **countries** — ISO-3166-1 alpha-2, `default_currency`, `is_active`,
  `requires_business_verification`, `settings JSONB` (per-country rules).
- **country_translations** — localised country names.
- **cities** — `country_id`, `name`, `slug`, `lat`, `lng`, `population`, `is_active`.
- **city_translations**.
- **currencies** — code, `minor_unit_digits`, `symbol`, `is_active`.
- **exchange_rates** — `base`, `quote`, `rate NUMERIC(18,8)`, `as_of`, `source`. Used
  only for *reporting* conversion; never to convert an actual payment.

### Catalogue
- **categories** — `parent_id` (self-FK), `path LTREE` *(materialised path for fast
  subtree queries)*, `slug`, `icon`, `position`, `is_active`, `depth`,
  `transaction_flow` (`buy_now|offer_then_pay|fee_only|contact_only`),
  `allows_online_payment`, `min_price_minor`, `max_online_amount_minor`,
  `requires_approval`, `max_images`, `listing_duration_days`, `seo JSONB`.
  → **Categories are pure data. Nothing in application code names a category.**
- **category_translations** — `(category_id, locale)`: name, description, SEO title/description.
- **attribute_definitions** — `category_id`, `key`, `data_type`
  (`text|number|integer|boolean|enum|multi_enum|date|range`), `unit`, `is_required`,
  `is_filterable`, `is_searchable`, `position`, `validation JSONB` (min/max/regex),
  `inherit_to_children`.
- **attribute_definition_translations** — localised label and help text.
- **attribute_options** + **attribute_option_translations** — enum values (e.g. fuel type).
- **listings** — `seller_profile_id`, `category_id`, `title`, `slug`, `description`,
  `content_locale`, `price_minor`, `currency`, `price_type`
  (`fixed|negotiable|on_request|free`), `country_id`, `city_id`, `condition`,
  `status` (`draft|pending_review|active|paused|sold|expired|rejected|removed`),
  `availability`, `quantity`, `view_count`, `favourite_count`, `published_at`,
  `expires_at`, `featured_until`, `bumped_at`, `search_document TSVECTOR`,
  **`attributes JSONB`** (denormalised copy, GIN-indexed, for fast filtering).
- **listing_attribute_values** — normalised `(listing_id, attribute_definition_id,
  value_text|value_number|value_boolean|value_date|option_id)`. Written in the **same
  transaction** as `listings.attributes`; normalised table is the source of truth,
  JSONB is the read-optimised projection.
- **listing_images** — `url`, `storage_key`, `position`, `width`, `height`,
  `blurhash`, `alt_text`, `moderation_status`. **`is_primary` enforced by a partial
  unique index** so a listing cannot have two primary images.
- **listing_videos**, **listing_translations** (optional machine translations, badged),
  **favourites**, **listing_views** (partitioned by month), **saved_searches**.

*Why hybrid attributes:* pure EAV cannot answer "cars, diesel, 2018+, under 80,000 km,
in Germany" quickly. Pure JSONB loses referential integrity and admin editability.
The hybrid gives both, at the cost of one extra write per listing save.

### Interaction
- **conversations** — `listing_id` (nullable), `buyer_id`, `seller_id`,
  `last_message_at`, `status` (`open|archived|blocked|reported`).
  Unique index on `(listing_id, buyer_id, seller_id)`.
- **messages** — `conversation_id`, `sender_id`, `body`, `type`
  (`text|image|system|offer_ref`), `risk_score`, `moderation_status`, `edited_at`,
  `deleted_at`. Partitioned by month.
- **message_reads** — `(message_id, user_id, read_at)`.
- **message_attachments**, **blocks** (`blocker_id`, `blocked_id`).
- **offers** — `listing_id`, `buyer_id`, `seller_id`, `amount_minor`, `currency`,
  `message`, `status` (`pending|accepted|declined|countered|withdrawn|expired|converted`),
  `parent_offer_id` (counter-offers), `expires_at`, `accepted_at`, `order_id`.

### Commerce — the core
- **orders** — `order_number` (human-readable), `listing_id`, `buyer_id`,
  `seller_profile_id`, `offer_id`, `flow_type`, `status`,
  `subtotal_minor`, `shipping_minor`, `tax_minor`, `total_minor`, `currency`,
  **commission snapshot**: `commission_rule_id`, `commission_percent_bps`,
  `commission_fixed_minor`, `commission_amount_minor`,
  `seller_amount_minor`, `payment_fee_minor` (actual, from Stripe balance transaction),
  `platform_net_minor`, `fx_rate_to_base`, `base_currency_total_minor`,
  `buyer_snapshot JSONB`, `listing_snapshot JSONB`, `expires_at`, `paid_at`,
  `completed_at`, `cancelled_at`, `livemode`.
  **Snapshots are immutable.** A later commission-rate change or listing edit must
  never alter a historical order. This is the single most important schema rule here.
- **order_items** — one row per line (future multi-item carts; one row today).
- **order_events** — append-only state-machine transition log.
- **payments** — `order_id`, `provider` (`stripe`), `provider_payment_intent_id`,
  `provider_charge_id`, `provider_balance_transaction_id`, `status`
  (`requires_payment_method|requires_action|processing|succeeded|failed|canceled`),
  `amount_minor`, `currency`, `payment_method_type`, `application_fee_amount_minor`,
  `transfer_id`, `transfer_group`, `failure_code`, `failure_message`,
  `idempotency_key`, `livemode`. Unique on `provider_payment_intent_id`.
  **No card number, no CVV, no PAN, ever.**
- **payment_events** — raw provider events. `id` = Stripe `evt_...` as the **primary
  key**, giving exactly-once processing for free. Columns: `type`, `payload JSONB`,
  `signature_verified`, `received_at`, `processed_at`, `attempts`, `status`, `error`.
- **ledger_entries** — append-only **double-entry** internal ledger. `entry_group_id`,
  `account` (`platform_revenue|seller_payable|payment_fees|refunds|disputes|
  promotions|subscriptions|tax_collected`), `direction` (`debit|credit`),
  `amount_minor`, `currency`, `order_id`, `payout_id`, `description`, `occurred_at`.
  Invariant enforced by test and by a scheduled job: **every `entry_group_id` sums to
  zero per currency.** This is how we answer "what do we owe sellers" and reconcile
  against Stripe without trusting our own mutable tables.
- **commissions** — materialised per-order commission record for reporting.
- **payouts** — `seller_profile_id`, `provider_payout_id`/`provider_transfer_id`,
  `amount_minor`, `currency`, `status` (`pending|in_transit|paid|failed|reversed`),
  `arrival_date`, `failure_code`, `livemode`.
- **refunds** — `order_id`, `payment_id`, `provider_refund_id`, `amount_minor`,
  `reason`, `status`, `reverse_transfer`, `refund_application_fee`, `initiated_by`.
- **disputes** — `payment_id`, `provider_dispute_id`, `amount_minor`, `reason`,
  `status`, `evidence_due_by`, `evidence JSONB`, `outcome`, `transfer_reversal_id`.
- **idempotency_keys** — `key`, `user_id`, `endpoint`, `request_hash`,
  `response_status`, `response_body JSONB`, `created_at`, `expires_at`.
  Unique on `(key, endpoint)`. Prevents double-charging on a double-clicked button.
- **outbox_events** — transactional outbox (see [02](./02-system-architecture.md)).

### Trust & safety
- **reviews** — `order_id` (**unique with `direction`**, so one review per order per
  direction), `author_id`, `subject_seller_id`/`subject_user_id`, `rating` (1–5,
  `CHECK`), `title`, `body`, `status` (`published|pending|hidden|removed`),
  `seller_response`, `responded_at`. **Requires a completed order — no order, no
  review.** That alone eliminates most fake-review vectors.
- **reports** — `reporter_id`, `target_type` (`listing|user|message|review|conversation`),
  `target_id`, `reason_code`, `details`, `status`
  (`open|triaging|actioned|dismissed|escalated`), `assigned_to`, `resolution_note`.
- **moderation_actions** — `moderator_id`, `target_type`, `target_id`, `action`
  (`warn|hide|remove|suspend|ban|reinstate`), `reason`, `expires_at`, `notes`.
- **prohibited_terms**, **prohibited_item_rules** — `country_id` (nullable = global),
  `category_id`, `rule_type` (`block|flag|require_approval`), `pattern`, `note`.
  Per-country because a legal item in one EU state is illegal in another.
- **user_sanctions** — warnings, suspensions, bans with expiry and appeal state.

### Monetisation
- **promotion_products** — `key` (`featured|premium|homepage|category_spotlight`),
  `duration_days`, `is_active`, `position`.
- **promotion_prices** — `(promotion_product_id, country_id|null, currency)` →
  `price_minor`. Admin-configurable; **no price in code**.
- **listing_promotions** — purchased promotions, `starts_at`, `ends_at`, `order_id`.
- **subscription_plans** — `key` (`starter|professional|premium`), `is_active`,
  `features JSONB` (listing quota, image quota, badge, analytics, ad credits).
- **subscription_prices** — `(plan_id, currency, interval)` → `price_minor`,
  `stripe_price_id`.
- **subscriptions** — `seller_profile_id`, `plan_id`, `status`, `current_period_end`,
  `stripe_subscription_id`, `cancel_at_period_end`.
- **advertisements** — `placement`, `creative_url`, `target_url`, `country_id`,
  `category_id`, `starts_at`, `ends_at`, `impressions`, `clicks`, `status`, `advertiser_id`.
- **ad_events** — impression/click log, partitioned by month.

### Platform
- **settings** — `key`, `value JSONB`, `scope` (`global|country`), `scope_id`,
  `is_public`, `updated_by`. Everything configurable lives here or in a typed table.
- **translations** — `(namespace, key, locale)` → `value`, `is_overridden`.
  Admin-editable overlay on top of the file-based catalogues.
- **notifications** — `user_id`, `type`, `payload JSONB`, `read_at`, `channels_sent`.
- **notification_preferences** — per user, per type, per channel.
- **audit_logs** — append-only: `actor_id`, `actor_role`, `action`, `entity_type`,
  `entity_id`, `before JSONB`, `after JSONB`, `ip`, `user_agent`, `correlation_id`,
  `created_at`. Partitioned by month. **No UPDATE or DELETE grant on this table.**
- **email_log**, **feature_flags**, **data_export_requests**, **data_deletion_requests**
  (GDPR), **consent_records** (cookie/marketing consent with timestamp and version).

## Key indexes

```sql
-- Listing browse/filter (the hottest query on the site)
CREATE INDEX ON listings (status, category_id, country_id, published_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX ON listings (status, country_id, city_id, price_minor);
CREATE INDEX ON listings USING GIN (attributes jsonb_path_ops);
CREATE INDEX ON listings USING GIN (search_document);
CREATE INDEX ON listings USING GIN (title gin_trgm_ops);
CREATE INDEX ON categories USING GIST (path);          -- ltree subtree queries
CREATE UNIQUE INDEX ON listing_images (listing_id) WHERE is_primary;
CREATE UNIQUE INDEX ON reviews (order_id, direction);
CREATE UNIQUE INDEX ON payments (provider_payment_intent_id);
CREATE UNIQUE INDEX ON conversations (listing_id, buyer_id, seller_id);
CREATE INDEX ON ledger_entries (entry_group_id);
CREATE INDEX ON orders (seller_profile_id, status, created_at DESC);
CREATE INDEX ON messages (conversation_id, created_at DESC);
```

## GDPR vs. financial retention  `[LEGAL REVIEW]`

These two obligations conflict and the schema must respect both:

- **Erasure request** → anonymise `users`/`profiles` (hash email, null personal
  fields, drop avatar), delete messages and listings.
- **Financial records** (`orders`, `payments`, `ledger_entries`, `payouts`, `refunds`,
  `audit_logs`) are **retained** in pseudonymised form, keyed by an opaque
  `anonymised_subject_id`. Statutory accounting-retention periods and the exact lawful
  basis must be confirmed by a lawyer and an accountant; the schema supports whatever
  period is chosen via a configurable retention policy.

`data_export_requests` and `data_deletion_requests` are processed as background jobs
with a verifiable audit trail, not as ad-hoc SQL.
