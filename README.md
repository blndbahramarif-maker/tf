# RDF Mobile Mechanic — website

Website for **RDF Mobile Mechanic** — *bringing the workshop to you*. A mobile mechanic
covering Rochester, the Medway towns and the surrounding Kent area.

It is a static website: plain HTML, CSS and a small amount of JavaScript. There is no build
step, no framework and no dependencies to install — the fonts and photographs are stored in
this folder, so the site loads quickly and works without any third-party services.

The design follows the RDF flyer (`assets/img/rdf-flyer.jpg`): black, red and white, condensed
italic headings, red hexagon service icons and the **FAST | RELIABLE | CONVENIENT** strip.

---

## 1. Previewing the website

**Quickest way:** double-click `index.html` and it opens in your browser.

**Recommended way** (some browser features behave better over a local server):

```bash
# from inside this folder
python3 -m http.server 8000
```

Then open <http://localhost:8000> in your browser.

---

## 2. What is on the page

The page is built as **five scrolls** — five full sections the visitor moves through — plus a
header and footer.

| Section | Content |
| --- | --- |
| Sticky header | RDF lockup, Home / Services / Why RDF / How it works / Contact, phone button, hamburger menu on mobile |
| **Scroll 1 — Hero** (`#home`) | Full RDF lockup and strapline, what the business does, Call / WhatsApp / View services buttons, trust pills, FAST \| RELIABLE \| CONVENIENT strip |
| **Scroll 2 — Services** (`#services`) | "Services we offer" ribbon and the six services from the flyer: servicing, brakes, timing belts, clutches, diagnostics, general repairs |
| **Scroll 3 — Why RDF** (`#why`) | The flyer's four promises (experienced & reliable, competitive prices, quality parts & workmanship, convenient & trusted), a photograph, a small stats band and the Checkatrade membership panel |
| **Scroll 4 — How it works** (`#how`) | Three steps (call or WhatsApp → we come to you → job done & explained) and the area covered |
| **Scroll 5 — Contact** (`#contact`) | Large call/WhatsApp card, what to have ready, and a quote form that opens WhatsApp |
| Footer | Brand, menu, all six services, contact details, Checkatrade line |
| Mobile only | Sticky bottom bar with **Call** and **WhatsApp** |

The phone number **07706696124** appears in the top bar, the header button, the hero, the hero
photo badge, the services note, the coverage panel, the contact card, the form, the footer and
the mobile sticky bar. Every instance is a `tel:` link, so tapping it starts a call. The
WhatsApp buttons open `https://wa.me/447706696124`.

---

## 3. The quote form — important

**The form does not send email, because a static website has no server, and the business has
no email address on the flyer.**

When a visitor presses **Send on WhatsApp**, the details are validated and then WhatsApp opens
with a tidy message already written:

```
Quote request from the RDF website

Name: Jane Smith
Phone: 07000 000000
Vehicle: Ford Focus 1.6 TDCi
Registration: AB12 CDE
Service: Brakes
Area: ME1

Details: Grinding noise from the front when braking...
```

They still have to press *send* in WhatsApp. Nothing is stored on the website and nothing is
sent anywhere else. If they ignore the form, the phone number is on screen throughout.

If enquiries should arrive by **email** instead, add a free form service (Web3Forms, Formspree
or Netlify Forms) — that needs an email address to send to, and a small change in
`assets/js/main.js` where the WhatsApp link is built.

---

## 4. The files

```
index.html          the whole page
404.html            "page not found" page
assets/css/         the single stylesheet
assets/js/          the menu, scroll animations and quote form
assets/img/         photographs, icons and the original flyer
assets/fonts/       Barlow Condensed (headings) and Inter (body text)
netlify.toml        Netlify settings (caching and security headers)
vercel.json         the same for Vercel, if used instead
sitemap.xml         helps Google find the page
robots.txt          tells search engines the site may be indexed
site.webmanifest    name and icons when saved to a phone home screen
DEPLOY.md           how to put the site online and connect a domain
HANDOVER.md         plain-English notes for the business owner
```

---

## 5. Changing the details

| What to change | Where |
| --- | --- |
| Phone number | Search `07706696124` and `07706 696124` in `index.html` and `404.html`, and `PHONE` in `assets/js/main.js` |
| WhatsApp number | Search `447706696124` in `index.html`, and `WHATSAPP_NUMBER` in `assets/js/main.js` |
| Business name / strapline | The `.brand`, `.lockup` and `<title>` blocks in `index.html` |
| Services and their wording | The six `<article class="service">` blocks in Scroll 2 |
| The four promises | The `<li class="check">` blocks in Scroll 3 |
| Towns covered | The `<ul class="areas">` list in Scroll 4 |
| Colours | The `:root` block at the top of `assets/css/styles.css` |
| Photographs | Replace the files in `assets/img/` keeping the same names, or update the `<picture>` blocks |

**Note on the towns and the base location:** the flyer gives no address, so Rochester and the
surrounding Medway towns were carried over from the previous version of this site. If the
business is based somewhere else, change the coverage list in Scroll 4, the `addressLocality`
in the structured data at the top of `index.html`, and the mentions in the footer and contact
section.

---

## 6. What was **not** invented

No reviews, prices, guarantees, qualifications, opening hours or years of experience appear on
the site, because none were given. The claims on the page are the ones printed on the flyer:
the six services, the four promises, Checkatrade membership, and fast / reliable / convenient.
Anything real can be added later.

---

## 7. The cinematic layer

The page is deliberately filmic: a darkened workshop photograph behind the hero with a slow
Ken Burns drift, a red key light, a perspective floor grid, film grain over the whole page,
and oversized outlined words drifting behind each section.

The depth is real CSS 3D, not images: the cards, the hero photograph and the call card tilt
towards the pointer (`[data-tilt]` in `index.html`, handled in `assets/js/main.js`), the
hexagon icons sit forward of their cards on the Z axis, and sections rise out of the page as
they enter the viewport.

All of it is switched off for visitors whose system asks for reduced motion, and the tilt
never runs on touch screens — a finger cannot hover, and a tilt on tap just feels loose.
To dial the whole effect down, lower `--shadow-3d`, the `.grain` opacity, or delete the
`data-tilt` attributes.

---

## 8. Accessibility and performance notes

* Every image has alternative text; the icons are decorative SVG symbols.
* Colour contrast follows the flyer's white-on-black, which passes AA comfortably.
* The page works without JavaScript — only the mobile menu, the reveal animation and the
  WhatsApp form need it.
* `prefers-reduced-motion` is respected: animations are switched off for visitors who ask for
  that in their system settings.
* Fonts and photographs are served from this folder, so there are no third-party requests and
  no cookies. There is nothing to consent to and no cookie banner is needed.
