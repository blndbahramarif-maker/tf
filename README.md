# Pampered Pets — South Croydon

Website for **Pampered Pets**, a dog and cat grooming parlour at 120 Selsdon Rd,
South Croydon CR2 6PG · 020 8686 5048.

It is a static site: plain HTML, CSS and JavaScript, with fonts and the 3D engine
stored in this folder, so no third-party scripts are loaded (the only external
content is the Google map in section 5).

## Previewing

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## The page — five full-screen "scrolls"

| # | Section | Content |
| --- | --- | --- |
| 1 | **Home** | Cinematic real-time 3D scene: a groomed bichon-style dog on a velvet podium, with a key-light beam, soap bubbles and golden dust. The camera sweeps in as the letterbox bars open, then drifts slowly. The dog breathes, blinks, wags its tail and turns its head to follow the cursor. Scrolling pushes the camera in. |
| 2 | **The Parlour** | Introduction, 4.7 rating / 190 reviews / 25+ services, four care pillars |
| 3 | **Services** | Every listed service, grouped: Signature full groom, Grooming & Styling, Bath & Care, Dental, Convenience |
| 4 | **Reviews** | 4.7 score and three Google review quotes, link to Google |
| 5 | **Visit & Book** | Phone, address, hours, directions, embedded map, footer |

On desktop the sections snap gently, and dots on the right show which section is in view.
On phones a **Call to book / Directions** bar appears after the first screen.

## The 3D scene

- Source: `assets/js/src/hero-scene.js` (Three.js, built from code with no model files).
- The page loads the bundled, minified copy: `assets/js/hero-scene.js`.
- It only renders while the hero is on screen, lowers its resolution automatically on slow
  devices, and shows a still frame for visitors who ask for reduced motion. If WebGL is
  unavailable, a gradient backdrop is shown instead.

After editing the source, rebuild the bundle:

```bash
npm i --no-save three esbuild
npx esbuild assets/js/src/hero-scene.js --bundle --minify --format=esm --outfile=assets/js/hero-scene.js
```

## To confirm with the owner

- **Opening hours.** The Google listing only showed "Closes 5 pm", so section 5 says
  "Open until 5pm · appointments by phone". Replace it with the full weekly hours.
- **Domain.** Add `<link rel="canonical">`, `og:url` and a `sitemap.xml` once the domain is known.

## Deploying

Drag the folder onto <https://app.netlify.com/drop>, or connect the repository to Netlify or
Vercel. `netlify.toml` and `vercel.json` are already set up, and there is no build command.
