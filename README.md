# DGN Tech Mobiles

A modern, professional e-commerce website for **DGN Tech Mobiles** — a Purley-based shop selling phones, accessories, repairs, drinks, kitchen & home essentials, kids' toys and age-restricted vape products.

Built with React, TypeScript, Vite, Tailwind CSS and React Router.

## Getting Started

```bash
npm install
npm run dev
```

Open http://localhost:5173 to view it locally.

```bash
npm run build   # production build to dist/
npm run preview # preview the production build locally
```

## Project Structure

- `src/pages/` – one file per route (Home, Shop, Phones, Accessories, Repairs, Drinks, Kitchen, Toys, Vape, About, Contact, Product Detail, Cart, Checkout, Privacy, Terms, 404).
- `src/components/` – shared UI (`ui/`), layout (`layout/`), shop/product cards (`shop/`), home page sections (`home/`), forms (`forms/`), the vape age-gate (`vape/`) and a hand-built SVG product illustration library (`illustrations/`).
- `src/data/` – `products.ts`, `categories.ts` and `repairs.ts`. This is where product names, prices, descriptions and categories live — edit these files to update the shop's catalogue.
- `src/lib/` – cart state (`cart-context.tsx`, persisted to `localStorage`), price formatting and page-meta helpers.

## Updating Content

- **Products, prices & descriptions**: edit `src/data/products.ts`.
- **Repair pricing**: edit `src/data/repairs.ts`.
- **Business details** (address, phone, email): search for the phone number/address strings across `src/components` and `src/pages` (Navbar, Footer, Home, Contact, About).
- **Images**: products currently use a custom illustration system (`src/components/illustrations/Illustrations.tsx`) instead of stock photos, so there are no broken/unrelated images. To swap in real product photography, replace the `<Illustration />` usage in `ProductCard.tsx` / `ProductDetail.tsx` with an `<img>` tag pointing at your image.

## Notes

- The checkout is a fully designed, working preview (contact details, collection/delivery choice, order summary) but does not process real payments yet — card fields are present but disabled, ready to be wired up to a real payment provider (e.g. Stripe) later.
- The repair booking form and contact form validate input and show a success confirmation, but don't yet send data anywhere — connect them to an email service or backend when ready.
- The Vape section includes an 18+ age-verification gate and responsible-retailing messaging in line with UK requirements for age-restricted products.
