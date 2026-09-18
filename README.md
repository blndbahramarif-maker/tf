# Mobile Mechanic — Rochester, Kent

Website for **Mobile Mechanic**, a 24/7 mobile mechanic business run by **Lawe H**, based in
Rochester, Kent and travelling approximately 20 miles to customers.

It is a static website: plain HTML, CSS and a small amount of JavaScript. There is no build step,
no framework and no dependencies to install — the fonts and photographs are stored in this folder,
so the site loads quickly and works without any third-party services.

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

| Section | Content |
| --- | --- |
| Sticky header | Logo, Home / Services / About / Contact, **Call Now** button, hamburger menu on mobile |
| Scroll 1 | Hero + first 3 services (Servicing, Clutch, Auto Electrician) |
| Scroll 2 | "Professional Vehicle Repairs" — Timing Belt, Engine Repairs, Diagnostics |
| Scroll 3 | "More Mobile Mechanic Services" — Exhaust, Suspension, Wheel Bearing |
| Scroll 4 | About / Why choose Mobile Mechanic + call-to-action |
| Scroll 5 | Service area + 24/7 call-to-action |
| Contact | Full contact details and a quote request form |
| Footer | Business details, menu links, all nine services, copyright |
| Mobile only | Sticky bottom bar with **Call Now** and **Get a Quote** |

The phone number **07767547383** appears in the top bar, the header button, the hero, the repairs
section, the about call-to-action, the service-area section, the contact card, the footer and the
mobile sticky bar. Every instance is a `tel:` link, so tapping it starts a call. The email address
is a `mailto:` link everywhere it appears.

The "Enquire" button on each service card scrolls the visitor to the contact form.

---

## 3. The quote form — important

**The form does not send email on its own, because a static website has no server.**

Right now, pressing **Request a Quote** validates the details and then opens the visitor's own email
app with a message pre-addressed to `haremmohamed245@gmail.com`, with their name, phone, email,
vehicle, problem and preferred date/time already filled in. They still have to press *send* in their
email app. This works without any account or subscription, and nothing is lost if a visitor ignores
it — the phone number is the main call to action.

If you want form submissions delivered to your inbox automatically, connect a free form service.
The two simplest options:

### Option A — Web3Forms (no account needed to start)

1. Go to <https://web3forms.com> and enter `haremmohamed245@gmail.com` to get an **access key**.
2. In `index.html`, find `<form class="form-grid" id="quoteForm" novalidate>` and change it to:

   ```html
   <form class="form-grid" id="quoteForm" action="https://api.web3forms.com/submit" method="POST">
     <input type="hidden" name="access_key" value="YOUR-ACCESS-KEY-HERE">
     <input type="hidden" name="subject" value="New quote request from the website">
   ```

3. In `assets/js/main.js`, delete (or comment out) section **5. Quote form** so the browser submits
   the form normally instead of opening an email app.
4. Remove the note under the form in `index.html` (the paragraph with `class="form-note"`), as it
   will no longer be accurate.

### Option B — Formspree

1. Create a form at <https://formspree.io> using `haremmohamed245@gmail.com`; you receive an
   endpoint such as `https://formspree.io/f/abcdwxyz`.
2. Change the form tag to `<form class="form-grid" id="quoteForm" action="https://formspree.io/f/abcdwxyz" method="POST">`.
3. Do steps 3 and 4 from Option A.

### Option C — Netlify

If you host the site on Netlify, add `netlify` and `name="quote"` to the `<form>` tag, then do steps
3 and 4 from Option A. Submissions appear in the Netlify dashboard and can be emailed to you.

---

## 4. Putting the website online

**See `DEPLOY.md`** for full step-by-step instructions covering Netlify, Vercel, connecting a
`.co.uk` domain, and getting listed on Google.

The short version: drag this folder onto <https://app.netlify.com/drop> and the site is live in
seconds. Other hosts work too — GitHub Pages, or any normal web hosting where you upload the
contents of this folder to `public_html` by FTP.

---

## 5. Editing the content

| What you want to change | Where |
| --- | --- |
| Phone number | Search `07767547383` in `index.html` (and `PHONE` in `assets/js/main.js`) and replace everywhere |
| Email address | Search `haremmohamed245@gmail.com` in `index.html` (and `BUSINESS_EMAIL` in `assets/js/main.js`) |
| Service names and descriptions | The `<li class="card">` blocks in `index.html` |
| About text | The `#about` section in `index.html` |
| Copyright year | Bottom of `index.html`, in `footer__bottom` |
| Colours | The `:root` variables at the top of `assets/css/styles.css` (`--red`, `--bg`, and so on) |
| Photographs | Replace the files in `assets/img/` keeping the same filenames, or update the `src`/`srcset` in `index.html` |

**Please keep the alt text on images accurate if you swap the photos** — it is what screen readers
and search engines read.

---

## 6. Files

```
index.html                 The whole website (one page)
404.html                   Shown if someone follows a broken link
robots.txt                 Search engine instructions
sitemap.xml                Page list for search engines (set your domain after launch)
site.webmanifest           Name and icon when the site is saved to a phone home screen
netlify.toml               Hosting settings, used automatically by Netlify
vercel.json                Hosting settings, used automatically by Vercel
DEPLOY.md                  Step-by-step guide to publishing and connecting a domain
assets/css/styles.css      All styling
assets/js/main.js          Menu, scroll animations, form handling
assets/fonts/              Barlow Condensed + Inter (self-hosted, SIL Open Font Licence)
assets/img/                Photographs (AVIF + WebP + JPEG), logo and app icons
```

The entire page, including every photograph further down, is about **590 KB**; the first screen is
roughly 240 KB. Each photograph is stored in three formats and the browser picks the smallest one
it understands (AVIF, then WebP, then JPEG), images below the fold load only as you scroll, and the
two typefaces are preloaded so text never flashes.

---

## 7. Photographs

The photographs come from [Unsplash](https://unsplash.com) and are used under the
[Unsplash Licence](https://unsplash.com/license), which allows free commercial use. They are stored
in this repository rather than hot-linked, so the site keeps working regardless of Unsplash.

Replacing them with photographs of your own van, tools and completed work would make the site even
more convincing to local customers — just keep the same filenames, or update the paths in
`index.html`.

---

## 8. Notes on accuracy

The website deliberately contains **no** reviews, testimonials, prices, discounts, awards,
qualifications, certifications, customer numbers, named towns inside the service area, guarantees or
parts warranties, because none were provided. If you would like any of these added, send the real
details and they can be included.
