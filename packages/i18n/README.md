# @kurdora/i18n

Locale registry and message catalogues.

## Adding a language

1. Add an entry to `LOCALES` in `src/index.ts`.
2. Add `messages/<code>.json` with the same key structure as `en.json`.
3. Set `enabled: true` once the catalogue has been reviewed by a native speaker.

No application code changes. `tests/i18n.test.ts` fails the build if a catalogue
is missing keys that `en.json` has, or has keys `en.json` does not.

## ⚠️ Translation status

| Locale | Status |
|---|---|
| `en` | Source of truth |
| `ckb` | **Machine-assisted draft — REQUIRES native Sorani review before launch** |
| `kmr` | **Machine-assisted draft — REQUIRES native Kurmanji review.** Disabled |
| `ar` | **Machine-assisted draft — REQUIRES native Arabic review.** Disabled |

Only `en` may be treated as correct. The Kurdish and Arabic catalogues here exist
to prove the architecture (routing, direction switching, fallback, key parity) —
they are **not** launch-quality copy. Marketplace and financial vocabulary
(offer, commission, payout, dispute, refund, verification) is exactly where a
wrong word destroys trust, and none of it has been reviewed by a speaker.

This is tracked as a launch dependency in `docs/11-risks-and-decisions.md` (R-10).
