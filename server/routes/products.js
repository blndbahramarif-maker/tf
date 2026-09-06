import { Router } from "express";
import { listProducts, getProductBySlug } from "../models/products.js";

export const productsRouter = Router();

productsRouter.get("/", (req, res) => {
  const { category } = req.query;
  const products = listProducts({
    category: typeof category === "string" ? category : undefined,
    includeOutOfStock: true,
  });
  res.json({ products });
});

productsRouter.get("/:slug", (req, res) => {
  const product = getProductBySlug(req.params.slug);
  if (!product) return res.status(404).json({ error: "Product not found." });
  res.json({ product });
});
