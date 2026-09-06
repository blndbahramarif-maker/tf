import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSeed } from "./seed.js";
import { productsRouter } from "./routes/products.js";
import { ordersRouter } from "./routes/orders.js";
import { adminRouter } from "./routes/admin.js";
import { stripeWebhookRouter } from "./routes/stripe-webhook.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;

runSeed();

const app = express();
app.use(cors());

// Must be registered before express.json() — Stripe webhook signature
// verification requires the raw, unparsed request body.
app.use("/api/stripe/webhook", stripeWebhookRouter);

app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api/products", productsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/admin", adminRouter);

app.get("/api/health", (req, res) => res.json({ ok: true }));

// In production, serve the built frontend as static files and let the SPA
// router handle everything that isn't an API route.
const distDir = path.join(__dirname, "..", "dist");
if (process.env.NODE_ENV === "production") {
  app.use(express.static(distDir));
  app.get(/^(?!\/api|\/uploads).*/, (req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

app.listen(PORT, () => {
  console.log(`[server] DGN Tech Mobiles API listening on http://localhost:${PORT}`);
});
