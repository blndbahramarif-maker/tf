# 09 — Internationalisation, Localisation & RTL

## Locales

| Code | Language | Script | Direction | Notes |
|---|---|---|---|---|
| `en` | English | Latin | LTR | Default / fallback |
| `ckb` | Kurdish Sorani | **Arabic** | **RTL** | BCP-47 `ckb`; Central Kurdish |
| `kmr` | Kurdish Kurmanji | **Latin** | **LTR** | Northern Kurdish |
| `ar` | Arabic | Arabic | **RTL** | |

**Critical point that is frequently got wrong: Sorani and Kurmanji are different
scripts *and* different directions.** They are not two spellings of one language and
are largely not mutually intelligible in writing. Treating "Kurdish" as one locale
would be a product failure, not just a technical one.

Adding a locale must require **only** a new catalogue file plus a registry row — never
a code change. The registry is the single source of truth:

```ts
// packages/i18n/src/locales.ts
export const LOCALES = {
  en:  { name: 'English',          native: 'English',  dir: 'ltr', script: 'Latn', numberingSystem: 'latn' },
  ckb: { name: 'Kurdish (Sorani)', native: 'کوردیی ناوەندی', dir: 'rtl', script: 'Arab', numberingSystem: 'latn' },
  kmr: { name: 'Kurdish (Kurmanji)', native: 'Kurmancî', dir: 'ltr', script: 'Latn', numberingSystem: 'latn' },
  ar:  { name: 'Arabic',           native: 'العربية',  dir: 'rtl', script: 'Arab', numberingSystem: 'latn' },
} as const;
```

## Routing & SEO

`/{locale}/...` prefix on **every** locale including the default — unambiguous for
crawlers and for `hreflang`. Locale detection order: URL → user preference → cookie →
`Accept-Language` → default. The URL always wins, so a shared link always renders in
the language it was shared in.

```html
<link rel="alternate" hreflang="en"  href="https://kurdora.com/en/cars" />
<link rel="alternate" hreflang="ckb" href="https://kurdora.com/ckb/cars" />
<link rel="alternate" hreflang="kmr" href="https://kurdora.com/kmr/cars" />
<link rel="alternate" hreflang="ar"  href="https://kurdora.com/ar/cars" />
<link rel="alternate" hreflang="x-default" href="https://kurdora.com/en/cars" />
<link rel="canonical" href="https://kurdora.com/ckb/cars" />
```

Localised slugs per locale; the URL always carries the id
(`/{locale}/listing/{id}/{slug}`) so a renamed listing never 404s and never loses
link equity.

## Three kinds of translatable content

1. **UI strings** — file-based ICU MessageFormat catalogues in `packages/i18n`,
   namespaced (`common`, `listing`, `checkout`, `admin`, …), with a database
   `translations` table as an **admin-editable overlay**. The overlay is cached in
   Redis and busted on save, so the owner can fix wording without a deploy.
2. **Platform content** — categories, attributes, attribute options, countries, cities,
   static pages: `*_translations` tables keyed `(entity_id, locale)` with fallback to `en`.
3. **User-generated content** — listings, messages, reviews. Authored in **one**
   language; `listings.content_locale` records which. We never force sellers to
   translate. Optional machine translation later is stored separately, clearly badged
   "translated automatically", with the original always one click away.

**No hard-coded UI text anywhere.** Enforced by an ESLint rule banning bare string
literals in JSX, plus a CI check for missing/unused keys across all four catalogues.

## RTL implementation

1. `<html lang={locale} dir={LOCALES[locale].dir}>` — set at the layout root from the
   registry, never inferred ad hoc.
2. **CSS logical properties everywhere.** Tailwind `ps-/pe-/ms-/me-/start-/end-/
   border-s-/border-e-/text-start/text-end`. An ESLint rule **bans** `ml-`, `mr-`,
   `pl-`, `pr-`, `left-`, `right-`, `text-left`, `text-right` in app code — RTL cannot
   silently regress because a developer reached for a physical class.
3. **Icons that encode direction** (back arrows, carousel chevrons, breadcrumb
   separators, progress steppers) flip via a `dir`-aware component. Icons that do not
   (logos, brand marks, play buttons, checkmarks) must not.
4. **Bidirectional text isolation.** Mixing "£50,000" or "BMW 320d" into Arabic-script
   prose reorders visually without it. Use `dir="auto"` on user-content containers and
   Unicode isolates (`U+2068 … U+2069`) around embedded LTR runs inside RTL strings.
   A shared `<Bidi>` helper does this so it is not left to each developer.
5. **Numbers, dates, currency** via `Intl.NumberFormat` / `Intl.DateTimeFormat` with the
   locale. Numbering system is a registry setting: default **Latin digits for prices in
   all locales** to avoid ambiguity in money, configurable per locale if you prefer
   Arabic-Indic.
6. **Fonts.** Latin: Inter. Arabic script: Noto Sans Arabic or Vazirmatn — but
   **Sorani-specific glyphs (ڕ ێ ۆ ڵ ھ گ چ پ ژ) must be visually verified**, since many
   "Arabic" fonts render Kurdish forms poorly or not at all. Subset per script and
   preload only the active one.
7. **Forms and validation**: phone, address and postcode formats vary per country; the
   address form is driven by a per-country field schema, not one hard-coded layout.
8. **Testing**: Playwright runs critical journeys in `en` **and** `ckb`; visual
   regression snapshots in both directions; an axe-core accessibility pass per locale.

## Translation quality `[HUMAN REVIEW]`
Machine translation is not acceptable for the UI of a community platform. Sorani and
Kurmanji catalogues must be reviewed by **native speakers**, especially for marketplace
and financial terminology (offer, commission, payout, dispute, refund, verification),
where a wrong word destroys trust. Budget for this explicitly — it is a launch
dependency, not a nice-to-have.

## Brand abstraction
`packages/brand` holds name, legal entity, domains, logo paths, colour tokens, support
addresses. UI strings interpolate `{brandName}` — the literal "Kurdora" appears in
**no** component and in **no** message catalogue value. Renaming the platform is a
config edit plus asset swap.
