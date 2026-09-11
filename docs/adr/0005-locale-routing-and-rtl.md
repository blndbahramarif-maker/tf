# ADR-0005 — Always-prefixed locale routing and logical-property RTL

**Status:** Accepted · 2026-09-11
**Context docs:** `docs/09-i18n-rtl.md`

## Context

Launch is English and Kurdish Sorani, with Kurmanji and Arabic to follow.

The fact that drives everything: **Sorani and Kurmanji are different languages in
different scripts with different text directions.** Sorani (`ckb`) is Arabic
script, right-to-left. Kurmanji (`kmr`) is Latin script, left-to-right. They are
not mutually intelligible in writing. Treating "Kurdish" as one locale would be
a product failure.

## Decisions

**Every locale carries a URL prefix, including the default** — `/en/cars`, not
`/cars`. Unambiguous for crawlers, makes `hreflang` mechanical, and means a
shared link always renders in the language it was shared in.

**A single locale registry** (`packages/i18n`) is the source of truth for code,
name, endonym, direction, script and numbering system. No component may branch
on a locale code. Adding a language is one registry entry plus one catalogue file.

**Disabled locales stay routable.** `kmr` and `ar` resolve rather than 404 while
their catalogues are in review; only enabled locales appear in the switcher.

**Direction comes from the registry**, applied once as `<html lang dir>`.

**Logical CSS properties only.** `ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`,
`end-*`, `text-start`, `border-s`. The custom ESLint rule
`kurdora/no-physical-direction-classes` **fails the build** on `ml-`, `pl-`,
`left-`, `text-left` and friends, including inside responsive variants,
template literals and `cn()` calls.

**Latin digits for money in every locale** by default. Digit ambiguity is
tolerable in prose and not in prices. Configurable per locale.

## Consequences

**Good.** RTL cannot silently regress — the single most common way multilingual
products break for right-to-left users, because nobody testing in English sees
it. Adding a language needs no code change.

**Bad.** Developers must learn logical properties, and the lint rule will
occasionally be annoying. Correct trade. A small escape hatch exists for
genuinely direction-independent cases via an inline disable with a required
explanatory comment.

**Unresolved.** Arabic-script fonts must be verified to render Sorani letterforms
(ڕ ێ ۆ ڵ گ چ پ ژ) correctly — many "Arabic" fonts do not. Needs a native reader,
not a developer.
