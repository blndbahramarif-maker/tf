import { db } from "../db.js";

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function uniqueSlug(base, ignoreId) {
  let slug = base || "product";
  let n = 1;
  const existsStmt = db.prepare(
    "SELECT id FROM products WHERE slug = ? AND id != ?"
  );
  while (existsStmt.get(slug, ignoreId ?? -1)) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

function serializeProduct(row) {
  if (!row) return null;
  const colors = db
    .prepare(
      "SELECT id, name, hex FROM product_colors WHERE product_id = ? ORDER BY sort_order, id"
    )
    .all(row.id);
  const storageOptions = db
    .prepare(
      "SELECT id, label, price_delta AS priceDelta, stock FROM product_storage_options WHERE product_id = ? ORDER BY sort_order, id"
    )
    .all(row.id);

  let images = [];
  try {
    images = JSON.parse(row.images || "[]");
  } catch {
    images = [];
  }

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    subcategory: row.subcategory,
    description: row.description,
    shortDescription: row.short_description,
    price: row.price,
    oldPrice: row.old_price ?? undefined,
    brand: row.brand ?? undefined,
    condition: row.condition ?? undefined,
    badge: row.badge ?? undefined,
    icon: row.icon ?? undefined,
    featured: !!row.featured,
    visible: !!row.visible,
    stock: row.stock,
    images,
    colors,
    storageOptions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listProducts({ category, includeOutOfStock = true, visibleOnly = false } = {}) {
  const clauses = [];
  const params = [];
  if (category) {
    clauses.push("category = ?");
    params.push(category);
  }
  if (visibleOnly) {
    clauses.push("visible = 1");
  }
  let sql = "SELECT * FROM products";
  if (clauses.length > 0) sql += ` WHERE ${clauses.join(" AND ")}`;
  sql += " ORDER BY created_at DESC";
  const rows = db.prepare(sql).all(...params);
  return rows
    .map(serializeProduct)
    .filter((p) => includeOutOfStock || totalStock(p) > 0);
}

function totalStock(product) {
  if (product.storageOptions.length > 0) {
    return product.storageOptions.reduce((sum, s) => sum + s.stock, 0);
  }
  return product.stock;
}

export function getProductBySlug(slug, { visibleOnly = false } = {}) {
  const row = db.prepare("SELECT * FROM products WHERE slug = ?").get(slug);
  if (visibleOnly && row && !row.visible) return null;
  return serializeProduct(row);
}

export function getProductById(id) {
  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  return serializeProduct(row);
}

function setColors(productId, colors = []) {
  db.prepare("DELETE FROM product_colors WHERE product_id = ?").run(productId);
  const insert = db.prepare(
    "INSERT INTO product_colors (product_id, name, hex, sort_order) VALUES (?, ?, ?, ?)"
  );
  colors.forEach((c, i) => {
    if (c && c.name && c.hex) insert.run(productId, c.name, c.hex, i);
  });
}

function setStorageOptions(productId, options = []) {
  db.prepare(
    "DELETE FROM product_storage_options WHERE product_id = ?"
  ).run(productId);
  const insert = db.prepare(
    "INSERT INTO product_storage_options (product_id, label, price_delta, stock, sort_order) VALUES (?, ?, ?, ?, ?)"
  );
  options.forEach((o, i) => {
    if (o && o.label) {
      insert.run(productId, o.label, Number(o.priceDelta) || 0, Number(o.stock) || 0, i);
    }
  });
}

export function createProduct(input) {
  const slug = uniqueSlug(slugify(input.slug || input.name));
  const info = db
    .prepare(
      `INSERT INTO products
        (slug, name, category, subcategory, description, short_description, price, old_price, brand, condition, badge, icon, featured, visible, stock, images)
       VALUES (@slug, @name, @category, @subcategory, @description, @shortDescription, @price, @oldPrice, @brand, @condition, @badge, @icon, @featured, @visible, @stock, @images)`
    )
    .run({
      slug,
      name: input.name,
      category: input.category,
      subcategory: input.subcategory || "",
      description: input.description || "",
      shortDescription: input.shortDescription || "",
      price: Number(input.price) || 0,
      oldPrice: input.oldPrice != null && input.oldPrice !== "" ? Number(input.oldPrice) : null,
      brand: input.brand || null,
      condition: input.condition || null,
      badge: input.badge || null,
      icon: input.icon || null,
      featured: input.featured ? 1 : 0,
      visible: input.visible != null ? (input.visible ? 1 : 0) : 1,
      stock: Number(input.stock) || 0,
      images: JSON.stringify(input.images || []),
    });

  const id = info.lastInsertRowid;
  setColors(id, input.colors);
  setStorageOptions(id, input.storageOptions);
  return getProductById(id);
}

export function updateProduct(id, input) {
  const existing = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  if (!existing) return null;

  const slug =
    input.name && slugify(input.name) !== existing.slug
      ? uniqueSlug(slugify(input.name), id)
      : existing.slug;

  db.prepare(
    `UPDATE products SET
      slug = @slug,
      name = @name,
      category = @category,
      subcategory = @subcategory,
      description = @description,
      short_description = @shortDescription,
      price = @price,
      old_price = @oldPrice,
      brand = @brand,
      condition = @condition,
      badge = @badge,
      icon = @icon,
      featured = @featured,
      visible = @visible,
      stock = @stock,
      images = @images,
      updated_at = datetime('now')
     WHERE id = @id`
  ).run({
    id,
    slug,
    name: input.name ?? existing.name,
    category: input.category ?? existing.category,
    subcategory: input.subcategory ?? existing.subcategory,
    description: input.description ?? existing.description,
    shortDescription: input.shortDescription ?? existing.short_description,
    price: input.price != null ? Number(input.price) : existing.price,
    oldPrice:
      input.oldPrice != null && input.oldPrice !== ""
        ? Number(input.oldPrice)
        : null,
    brand: input.brand ?? existing.brand,
    condition: input.condition ?? existing.condition,
    badge: input.badge ?? existing.badge,
    icon: input.icon ?? existing.icon,
    featured: input.featured != null ? (input.featured ? 1 : 0) : existing.featured,
    visible: input.visible != null ? (input.visible ? 1 : 0) : existing.visible,
    stock: input.stock != null ? Number(input.stock) : existing.stock,
    images: input.images != null ? JSON.stringify(input.images) : existing.images,
  });

  if (input.colors != null) setColors(id, input.colors);
  if (input.storageOptions != null) setStorageOptions(id, input.storageOptions);

  return getProductById(id);
}

export function deleteProduct(id) {
  const info = db.prepare("DELETE FROM products WHERE id = ?").run(id);
  return info.changes > 0;
}

export function decrementStock(productId, storageLabel, quantity) {
  const product = getProductById(productId);
  if (!product) return;
  if (storageLabel && product.storageOptions.length > 0) {
    db.prepare(
      "UPDATE product_storage_options SET stock = MAX(0, stock - ?) WHERE product_id = ? AND label = ?"
    ).run(quantity, productId, storageLabel);
  } else {
    db.prepare(
      "UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?"
    ).run(quantity, productId);
  }
}

export { serializeProduct, totalStock, slugify };
