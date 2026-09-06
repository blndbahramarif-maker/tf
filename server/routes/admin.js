import { Router } from "express";
import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { findAdminByEmail, verifyPassword } from "../models/admins.js";
import { signAdminToken, requireAdmin } from "../auth.js";
import {
  listProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} from "../models/products.js";
import {
  listOrders,
  getOrderById,
  updateOrderStatus,
} from "../models/orders.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "..", "uploads");

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
  },
});

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      return cb(new Error("Only JPEG, PNG, WEBP, GIF or AVIF images are allowed."));
    }
    cb(null, true);
  },
});

export const adminRouter = Router();

// ---- Auth ----

adminRouter.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  const admin = findAdminByEmail(email);
  if (!admin || !verifyPassword(admin, password)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  const token = signAdminToken(admin);
  res.json({ token, admin: { id: admin.id, email: admin.email } });
});

adminRouter.get("/me", requireAdmin, (req, res) => {
  res.json({ admin: req.admin });
});

// Everything below requires authentication
adminRouter.use(requireAdmin);

// ---- Products ----

adminRouter.get("/products", (req, res) => {
  res.json({ products: listProducts({ includeOutOfStock: true }) });
});

adminRouter.get("/products/:id", (req, res) => {
  const product = getProductById(Number(req.params.id));
  if (!product) return res.status(404).json({ error: "Product not found." });
  res.json({ product });
});

adminRouter.post("/products", (req, res) => {
  const { name, category, price } = req.body || {};
  if (!name || !category || price == null) {
    return res.status(400).json({ error: "Name, category and price are required." });
  }
  const product = createProduct(req.body);
  res.status(201).json({ product });
});

adminRouter.put("/products/:id", (req, res) => {
  const product = updateProduct(Number(req.params.id), req.body || {});
  if (!product) return res.status(404).json({ error: "Product not found." });
  res.json({ product });
});

adminRouter.delete("/products/:id", (req, res) => {
  const ok = deleteProduct(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: "Product not found." });
  res.status(204).end();
});

// ---- Image upload ----

adminRouter.post("/upload", (req, res) => {
  upload.single("image")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "No image file provided." });
    res.status(201).json({ url: `/uploads/${req.file.filename}` });
  });
});

// ---- Orders ----

adminRouter.get("/orders", (req, res) => {
  res.json({ orders: listOrders() });
});

adminRouter.get("/orders/:id", (req, res) => {
  const order = getOrderById(Number(req.params.id));
  if (!order) return res.status(404).json({ error: "Order not found." });
  res.json({ order });
});

const VALID_STATUSES = ["pending", "confirmed", "ready", "completed", "cancelled"];

adminRouter.patch("/orders/:id/status", (req, res) => {
  const { status } = req.body || {};
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }
  const order = updateOrderStatus(Number(req.params.id), status);
  if (!order) return res.status(404).json({ error: "Order not found." });
  res.json({ order });
});
