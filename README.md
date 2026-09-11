# HAVEN Real Estate

A single-page marketing site for a fictional London estate agency, built as a static
site with no framework and no build step. Open `index.html` and it runs.

Same structure and visual language as the reference design it was modelled on —
sky-gradient hero, dark expanding services accordion, chevron image band, giant
footer wordmark — rebranded to a different company, a different market and a
different price list.

## Brand

| | |
|---|---|
| Company | HAVEN Real Estate Ltd |
| Market | London (28 boroughs), prices in GBP |
| Wordmark | `HAVEN`, with the **A** drawn as a roof — inline SVG cap-aligned to the type |
| Type | Instrument Sans (self-hosted, OFL) |
| Palette | Ink `#0B0B0C`, paper `#F6F5F2`, accent green `#1F4A3C`, clay `#C9633F`, hero sky gradient |

## Run it

```bash
# any static server works
python3 -m http.server 8000
# → http://localhost:8000
```

Or just open `index.html` directly in a browser. Everything — images, fonts, CSS,
JS — is served from this repository, so it also works offline and on a static host
(GitHub Pages, Netlify, S3) with no configuration.

## Structure

```
index.html              markup for every section
assets/css/styles.css   design tokens, layout, responsive rules
assets/js/main.js       all interactions (vanilla, no dependencies)
assets/img/             24 optimised JPEGs (~2.5 MB total)
assets/fonts/           Instrument Sans woff2 subsets
```

### Sections

Intro wordmark → nav → hero → stat ticker → vision → listings (with filters) →
"this isn't just about real estate" chevrons → testimonials → services accordion →
service tiles → agent recruitment → journal → footer.

### Interactions

- Intro overlay that fades out, with a hard 4s ceiling so it can never trap the page
- Word-by-word hero headline reveal
- `IntersectionObserver` scroll reveals with per-group stagger
- Nav that shades on scroll and hides going down / returns going up
- Hero parallax (desktop only)
- Services accordion — hover, click, focus and Enter/Space all open a row
- Listing filters (All / For Sale / To Let / New)
- Count-up stats, testimonial carousel with autoplay, newsletter validation
- Full-screen mobile menu with Escape-to-close
- Every animation is disabled under `prefers-reduced-motion`

## Credits

Photography from [Unsplash](https://unsplash.com) under the Unsplash License.
[Instrument Sans](https://fonts.google.com/specimen/Instrument+Sans) by Rodrigo Fuenzalida
and Jonny Pinhorn, SIL Open Font License 1.1.

All company details, listings, prices and testimonials are fictional.
