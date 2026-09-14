# Putting the Mobile Mechanic website online

Everything here is written for someone who has never deployed a website before.
Nothing needs to be installed, and the hosting options below are free.

---

## 1. What you upload

**The whole folder.** Every file in it is needed. Keep the structure exactly as it is —
if the `assets` folder is missing, the site loses its styling, photos and fonts.

```
index.html          the website itself  ← must be in the top level
404.html            shown if someone follows a broken link
robots.txt          tells search engines they may list the site
sitemap.xml         list of pages for search engines (edit after you get a domain)
site.webmanifest    name and icon when someone saves the site to their phone
netlify.toml        settings, used automatically if you host on Netlify
vercel.json         settings, used automatically if you host on Vercel
assets/css/         the styling
assets/js/          the menu, animations and form
assets/fonts/       the two typefaces
assets/img/         photographs, logo and app icons
README.md           notes for you (not published, harmless if it is)
DEPLOY.md           this file (same)
```

`index.html` **must** sit at the top level of what you upload, not inside another folder.

---

## 2. Option A — Netlify Drop (easiest, about two minutes)

1. Go to **<https://app.netlify.com/drop>**.
2. Drag the whole website folder onto the page.
3. Wait a few seconds. The site is live at an address like
   `https://cheerful-otter-123456.netlify.app`.
4. Create a free account when prompted, so the site stays online and you can change it later.
5. In **Site configuration → Change site name**, rename it to something tidy such as
   `mobile-mechanic-rochester`, giving you
   `https://mobile-mechanic-rochester.netlify.app`.

To update the site later, drag the folder onto the same site's **Deploys** tab.

---

## 3. Option B — Netlify connected to GitHub (updates publish themselves)

The website is already in a GitHub repository, so:

1. Sign in at <https://app.netlify.com> with your GitHub account.
2. **Add new site → Import an existing project → GitHub**, and pick this repository.
3. Branch: choose the branch holding the site. Build command: **leave empty**.
   Publish directory: **`.`** (a single full stop). `netlify.toml` sets these for you.
4. **Deploy site.**

From then on, every change pushed to that branch publishes automatically.

---

## 4. Option C — Vercel

1. Sign in at <https://vercel.com> with your GitHub account.
2. **Add New → Project**, import this repository.
3. Framework preset: **Other**. Leave the build command empty; output directory `.`.
4. **Deploy.** You get an address like `https://mobile-mechanic.vercel.app`.

`vercel.json` already sets caching and security headers.

Netlify and Vercel are equally good here. Netlify Drop is the quickest if you would rather
not use GitHub at all.

---

## 5. Connecting a .co.uk domain

### Step 1 — Buy the domain

Buy from any UK registrar — for example 123 Reg, Namecheap, IONOS, GoDaddy or Cloudflare.
A `.co.uk` domain is usually £8–£15 per year. Something like
`mobilemechanicrochester.co.uk` or `haremmobilemechanic.co.uk` works well: short, and it
says what you do and where.

You do **not** need their hosting, website builder or email add-ons — only the domain.

### Step 2 — Tell your host about the domain

**On Netlify:** Site configuration → **Domain management** → **Add a domain** → type your
domain → **Verify** → **Add domain**.

**On Vercel:** Project → **Settings** → **Domains** → type your domain → **Add**.

### Step 3 — Point the domain at the host

The host now shows you the exact settings to copy. There are two ways, and the host tells
you which values to use — **always use the values on your own screen**, not values from a
guide, because they differ per account:

* **Easiest — change the nameservers.** The host gives you two to four nameserver addresses.
  In your registrar's control panel, find "Nameservers" (sometimes "DNS settings") and
  replace what is there with the ones the host gave you. The host then handles everything.
* **Or — add two DNS records.** In your registrar's DNS settings, add the **A record** for
  the bare domain (`yourdomain.co.uk`) and the **CNAME record** for `www`, exactly as the
  host displays them.

### Step 4 — Wait

Changes take anywhere from ten minutes to 24 hours to spread across the internet (48 hours
at the very outside). The host issues a free HTTPS certificate automatically, so your site
gets the padlock — you do not have to buy an SSL certificate.

### Step 5 — Check both addresses work

Visit `yourdomain.co.uk` and `www.yourdomain.co.uk`. Both should load the site over
`https://`. Your host has a setting to redirect one to the other — turn it on so there is
only one address in use.

---

## 6. Four small edits once the domain works

These help Google show the right address and make links look right when shared on WhatsApp
or Facebook. Open the files in any text editor (Notepad, TextEdit, VS Code) and replace
`www.your-domain.co.uk` with your real domain.

**1. In `index.html`,** find:

```html
<link rel="canonical" href="./index.html">
```

and change it to:

```html
<link rel="canonical" href="https://www.your-domain.co.uk/">
```

**2. In `index.html`,** find:

```html
<meta property="og:image" content="assets/img/hero-mechanic-1200.jpg">
```

and change it to the full address, adding the page address underneath:

```html
<meta property="og:image" content="https://www.your-domain.co.uk/assets/img/hero-mechanic-1200.jpg">
<meta property="og:url" content="https://www.your-domain.co.uk/">
```

**3. In `sitemap.xml`,** change `https://www.your-domain.co.uk/` to your real domain.

**4. In `robots.txt`,** remove the `#` from the last line and set your domain:

```
Sitemap: https://www.your-domain.co.uk/sitemap.xml
```

Then upload the folder again (or push to GitHub if you set up Option B or C).

---

## 7. Helping local customers find you

1. **Google Search Console** — <https://search.google.com/search-console>. Add your domain,
   verify it (the host has a one-click option or gives you a TXT record), then submit
   `https://www.your-domain.co.uk/sitemap.xml`.
2. **Google Business Profile** — <https://business.google.com>. This is the single most
   valuable thing for a local mobile mechanic: it puts you on Google Maps and in the local
   results box. Set the business as a **service-area business** (you travel to customers,
   so your home address stays private) with Rochester and roughly 20 miles around it as the
   area, and add your phone number and website address.
3. **Bing Webmaster Tools** — <https://www.bing.com/webmasters>, optional, takes two minutes.

Ask happy customers to leave a Google review. Reviews can be shown on the website later —
they are deliberately not on it now, because inventing them would be dishonest and Google
penalises fake reviews.

---

## 8. Making the quote form send email

The form currently opens the customer's own email app with their details filled in. To have
enquiries arrive in your inbox automatically instead, follow **section 3 of `README.md`** —
it takes about five minutes with the free Web3Forms or Formspree service.

---

## 9. Changing the website later

1. Edit the files (see the table in `README.md` section 5).
2. Re-upload, or push to GitHub if the site is connected to it.
3. If a change does not appear straight away, refresh with `Ctrl`+`F5` (Windows) or
   `Cmd`+`Shift`+`R` (Mac) — the page, stylesheet and script are set to re-check on every
   visit, so it should appear immediately.
