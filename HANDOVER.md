# Mobile Mechanic — website handover

Everything the business owner needs to know about the website.

**Live website:** https://mobilemechanicrochester.co.uk
(also reachable at https://mobile-mechanic-rochester.netlify.app)

---

## 1. What it costs to run

| Item | Cost | Needed? |
| --- | --- | --- |
| Hosting (Netlify free plan) | **£0 per year** | Already set up and running |
| A `.co.uk` domain name | **about £8–12 per year** | Optional, but recommended |
| SSL / HTTPS certificate (the padlock) | **£0** | Included free, automatic |
| Email forwarding, website builder, "SEO packages" | — | **Not needed. Do not buy these.** |

There is no hosting bill. The site is plain HTML, so it costs nothing to serve. The free
Netlify plan allows 100 GB of traffic a month; this site is about 0.6 MB per visitor, which
is well over 100,000 visits a month. A local mobile mechanic will never come close.

**The only thing worth paying for is the domain name.**

---

## 2. Buying the domain (about £10 a year)

Buy from any registrar — all of these sell `.co.uk`:

* **Namecheap** — namecheap.com
* **123 Reg** — 123-reg.co.uk (UK company)
* **IONOS** — ionos.co.uk
* **Cloudflare** — cloudflare.com/products/registrar (cheapest, sold at cost, slightly more technical)
* **GoDaddy** — godaddy.com (watch for expensive renewal prices)

**How:**

1. Search for the name you want, for example `mobilemechanicrochester.co.uk`.
2. Add **only the domain** to the basket. Decline hosting, website builders, email packages,
   "website security" and "SEO services" — none of them are needed, and they are where these
   companies make their money.
3. Pay. £8–12 for the year is normal.
4. **Check the renewal price**, not just the first-year price. Some sell the first year for
   £1 and renew at £30. Namecheap and Cloudflare are honest about this.

**Important:** buy the domain with the **business owner's own email address and card**. The
domain is the valuable part — whoever's name it is registered in owns the web address.

Once it is bought, connecting it to the website takes about ten minutes — see `DEPLOY.md`
section 5, or ask whoever set the site up.

---

## 3. Accounts involved

| Account | What it does | Who should own it |
| --- | --- | --- |
| **GitHub** (github.com/blndbahramarif-maker/tf) | Stores the website files | Whoever maintains the site |
| **Netlify** (app.netlify.com) | Publishes the site to the internet, free | Whoever maintains the site |
| **Domain registrar** | Owns the web address | **The business owner, always** |

Netlify is signed into using the GitHub account — there is no separate Netlify password.

If the business owner wants to take over completely, they create their own free GitHub and
Netlify accounts, and the repository and site get transferred to them. Otherwise it is
perfectly normal for whoever built it to keep hosting it and make changes on request.

---

## 4. How the website gets changed

There is no admin login, no WordPress dashboard, no monthly fee. The website is a set of
files. To change wording, add a service or swap a photograph, the files are edited and
pushed to GitHub — the live site updates itself within a minute.

`README.md` section 5 lists exactly which file holds which piece of text.

---

## 5. The quote form

The form on the contact section does **not** send email by itself, because the site has no
server. When a customer presses *Request a Quote*, their own email app opens with all their
details filled in, addressed to **haremmohamed245@gmail.com**, ready for them to send.

To have enquiries land in the inbox automatically instead, connect a free form service —
`README.md` section 3 gives the step-by-step instructions (about five minutes).

Either way, **most customers will phone**. The number is on the screen nine times and the
sticky bar at the bottom of every phone screen is a permanent Call Now button.

---

## 6. Getting found on Google

Two free things, in order of importance:

1. **Google Business Profile** — business.google.com. This is the big one for a local mobile
   mechanic: it puts the business on Google Maps and in the local results box. Set it up as a
   **service-area business** (travels to customers, so the home address stays private),
   covering Rochester and roughly 20 miles around it.
2. **Google Search Console** — search.google.com/search-console. Add the site and submit the
   sitemap once a domain is connected. `DEPLOY.md` section 7 explains how.

Ask satisfied customers for Google reviews. There are deliberately no reviews on the website
yet, because inventing them would be dishonest and Google penalises fake ones. Real ones can
be added later.

---

## 7. What is on the website

One page that scrolls, containing:

* Hero: 24/7 mobile mechanic, Rochester, approximately 20-mile service area, 8 years of
  experience, Call Now and Get a Quote buttons
* All nine services, in three groups of three
* About section — Harem M S B, 8 years of experience, why a mobile service is convenient
* Service area and 24/7 call-to-action
* Contact details and a quote form
* Footer with every service listed

Business details used throughout:

```
Business:     Mobile Mechanic
Mechanic:     Harem M S B
Phone:        07767547383
Email:        haremmohamed245@gmail.com
Base:         Rochester, Kent, ME1 3AR
Availability: 24 hours a day, 7 days a week
Service area: Approximately 20 miles from Rochester
Experience:   8 years
```

Nothing else was invented — no reviews, prices, guarantees, qualifications or named towns.
If any of those are real and should be shown, they can be added.
