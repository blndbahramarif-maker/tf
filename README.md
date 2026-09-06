# DGN Tech Mobiles

A full-stack e-commerce website and admin dashboard for **DGN Tech Mobiles** — a Purley-based shop selling phones, accessories, repairs, drinks, kitchen & home essentials, kids' toys and age-restricted vape products.

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query
- **Backend:** Node.js, Express, SQLite (via `better-sqlite3`)
- **Auth:** JWT-based admin login (bcrypt password hashing)
- **File storage:** Uploaded product photos are stored on local disk and served statically

## Quick Start (development)

```bash
npm install
cp .env.example .env   # then edit .env — see "Environment Variables" below
npm run dev
```

This runs the Vite dev server (`http://localhost:5173`) and the Express API (`http://localhost:4000`) together — Vite proxies `/api` and `/uploads` requests to the API automatically. Open **http://localhost:5173**.

The first time the server starts, it automatically:
1. Creates the SQLite database at `server/data/shop.sqlite`.
2. Seeds it with the full existing product catalogue (phones, accessories, drinks, kitchen, toys, vape).
3. Creates one admin account (see below).

Admin dashboard: **http://localhost:5173/admin/login**

## Default Admin Login

Unless overridden by environment variables, the seeded admin account is:

- **Email:** `admin@dgntechmobiles.co.uk`
- **Password:** `ChangeMe123!`

**You must change this before letting anyone else use the site.** Either:
- Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` **before the first run** (the admin account is only created once, the first time the database is empty), or
- Log in with the defaults and add proper password-change functionality before going live (not yet built — see "What's Not Included" below).

## Environment Variables

Copy `.env.example` to `.env` and fill these in:

| Variable | Required | Description |
|---|---|---|
| `PORT` | No (default `4000`) | Port the Express API listens on. |
| `JWT_SECRET` | **Yes, for production** | Secret used to sign admin login tokens. Without it the server runs with an insecure default and prints a warning. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Recommended | Credentials for the admin account created on first run. |
| `DB_PATH` | No | Override where the SQLite file is stored (useful on hosts with a specific persistent-disk path). |

## Production Deployment

This app needs a **persistent Node.js server**, not static hosting — it has a real database and file uploads on disk. It will **not** work on a static-only host (e.g. plain GitHub Pages, Netlify static, S3).

You need a host that runs a long-lived Node process with a **persistent volume/disk**, for example: a VPS (DigitalOcean, Linode, Hetzner), Render, Railway, Fly.io, or similar. Steps:

```bash
npm install
npm run build          # builds the React app into dist/
npm start               # NODE_ENV=production node server/index.js
```

`npm start` runs a single Express process that serves the built frontend **and** the `/api` and `/uploads` routes on one port — point your domain/reverse proxy at that port.

Before going live:
1. Set `JWT_SECRET`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` as real environment variables on your host (never commit these).
2. Make sure `server/data/` and `server/uploads/` live on **persistent** storage — on hosts with ephemeral filesystems (e.g. most serverless platforms, or containers rebuilt on every deploy), the database and uploaded photos will be **wiped** on redeploy. If your host doesn't offer a persistent disk, migrate to a managed database (e.g. Postgres) and object storage (e.g. S3/Cloudinary) — see "What's Not Included" below.
3. Take regular backups of `server/data/shop.sqlite` (it's the only copy of your products and orders).
4. Restrict CORS (`server/index.js`, `app.use(cors())`) to your real domain instead of allowing all origins.
5. Put the app behind HTTPS (via your host or a reverse proxy like Caddy/Nginx).

## Project Structure

```
server/                  Backend (Express + SQLite)
  db.js                  Database connection + schema
  seed.js                First-run seed data (catalogue + admin account)
  auth.js                JWT signing/verification middleware
  models/                Data access layer (products, orders, admins)
  routes/                Express routers (public products/orders, admin CRUD)
  data/                  SQLite database file lives here (gitignored)
  uploads/                Uploaded product photos live here (gitignored)

src/
  pages/                 Customer-facing routes (Home, Shop, Phones, ... Checkout)
  pages/admin/            Admin dashboard routes (Login, Dashboard, Products, Orders)
  components/            UI split into ui/, layout/, shop/, home/, forms/, vape/, admin/, illustrations/
  data/                  Static site data: categories.ts, repairs.ts (not admin-managed)
  data/products.ts        Original static catalogue — kept for reference; no longer used at runtime
                          (live product data now comes from the API/database)
  lib/                   api.ts (API client), cart-context.tsx, admin-auth-context.tsx,
                          useProducts.ts (React Query hooks), queryClient.ts
  types/product.ts        Shared Product/Order TypeScript types matching the API
```

## What You Can Do

**Customers:**
- Browse phones, accessories, drinks, kitchen & home, toys, and (18+ age-gated) vape products
- Search, filter by category/brand/condition, and sort by price
- View a product page with photos (or a placeholder illustration if none uploaded yet), pick a colour and storage option, and see live stock and price update
- Add to basket, review the basket, and check out (collection or delivery) — a real order is created and stock is decremented automatically
- No online payment yet — orders are confirmed and paid for in-store/on delivery (see below)

**Shop owner (`/admin`):**
- Secure login (JWT, bcrypt-hashed password)
- Dashboard with product/order counts, revenue, low-stock and out-of-stock alerts
- Add, edit and delete products
- Upload and reorder product photos (first photo = main image)
- Set price, "was" price, description, badge, and feature products on the homepage
- Manage colours (name + colour swatch) and storage options (label, price adjustment, stock) per product, or a single stock number for products without variants
- View all customer orders, filter by status, see full order/item detail, and update order status (pending → confirmed → ready → completed / cancelled)
- Every change is saved to the database immediately and appears on the live site straight away (no redeploy needed)

## What's Not Included Yet

Built to a professional, working standard, but intentionally out of scope for this pass:

- **Real online payments.** Checkout collects order details and creates a real order with real stock deduction, but the card fields are a visual placeholder — no payment processor is connected. Wire up Stripe (or similar) when ready.
- **Transactional emails.** No order-confirmation or repair-booking emails are sent yet; connect an email provider (e.g. Postmark, SendGrid) in `server/routes/orders.js` and `RepairBookingForm.tsx`/`ContactForm.tsx`.
- **Multiple admin accounts / roles / password reset.** There's one admin login; adding more admins, roles, or self-service password changes would need extra endpoints and UI.
- **Production-grade file storage.** Uploaded photos are stored on local disk. Fine for a single VPS with persistent storage; for multi-server or serverless hosting, move uploads to S3/Cloudinary/etc.
- **Automated tests.** Everything was manually verified end-to-end (build, typecheck, and live click-through testing of the full customer and admin flows), but there's no automated test suite yet.

## Local Development Scripts

```bash
npm run dev          # frontend + backend together (recommended)
npm run dev:client   # frontend only (Vite)
npm run dev:server   # backend only (Express, auto-restarts on change via nodemon)
npm run build        # production build of the frontend
npm start            # run the production server (serves built frontend + API)
npm run lint         # oxlint
```
