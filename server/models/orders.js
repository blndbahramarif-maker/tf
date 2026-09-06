import { db } from "../db.js";
import { getProductById, decrementStock } from "./products.js";

function serializeOrder(row, items) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    customerName: row.customer_name,
    phone: row.phone,
    email: row.email,
    fulfilmentType: row.fulfilment_type,
    address: row.address ?? undefined,
    subtotal: row.subtotal,
    deliveryFee: row.delivery_fee,
    total: row.total,
    status: row.status,
    paymentStatus: row.payment_status,
    createdAt: row.created_at,
    items: items.map((i) => ({
      id: i.id,
      productId: i.product_id ?? undefined,
      productName: i.product_name,
      color: i.color ?? undefined,
      storage: i.storage ?? undefined,
      unitPrice: i.unit_price,
      quantity: i.quantity,
    })),
  };
}

function getItemsForOrder(orderId) {
  return db
    .prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY id")
    .all(orderId);
}

export function listOrders() {
  const rows = db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all();
  return rows.map((row) => serializeOrder(row, getItemsForOrder(row.id)));
}

export function getOrderById(id) {
  const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!row) return null;
  return serializeOrder(row, getItemsForOrder(row.id));
}

export function getOrderByStripeSessionId(sessionId) {
  const row = db
    .prepare("SELECT * FROM orders WHERE stripe_checkout_session_id = ?")
    .get(sessionId);
  if (!row) return null;
  return serializeOrder(row, getItemsForOrder(row.id));
}

export function getOrderByPaymentIntentId(paymentIntentId) {
  const row = db
    .prepare("SELECT * FROM orders WHERE stripe_payment_intent_id = ?")
    .get(paymentIntentId);
  if (!row) return null;
  return serializeOrder(row, getItemsForOrder(row.id));
}

export class OrderValidationError extends Error {}

export const createOrder = db.transaction((input) => {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new OrderValidationError("Order must contain at least one item.");
  }

  let subtotal = 0;
  const resolvedItems = [];

  for (const item of input.items) {
    const product = getProductById(item.productId);
    if (!product) {
      throw new OrderValidationError(`Product ${item.productId} no longer exists.`);
    }
    const quantity = Math.max(1, Number(item.quantity) || 1);

    let unitPrice = product.price;
    let availableStock = product.stock;
    if (item.storage && product.storageOptions.length > 0) {
      const option = product.storageOptions.find((o) => o.label === item.storage);
      if (!option) {
        throw new OrderValidationError(
          `${product.name}: storage option "${item.storage}" is no longer available.`
        );
      }
      unitPrice = product.price + option.priceDelta;
      availableStock = option.stock;
    } else if (product.storageOptions.length > 0) {
      throw new OrderValidationError(`${product.name} requires a storage option.`);
    }

    if (availableStock < quantity) {
      throw new OrderValidationError(
        `${product.name} only has ${availableStock} left in stock.`
      );
    }

    subtotal += unitPrice * quantity;
    resolvedItems.push({
      product,
      quantity,
      unitPrice,
      color: item.color || null,
      storage: item.storage || null,
    });
  }

  const deliveryFee = input.fulfilmentType === "delivery" ? 3.99 : 0;
  const total = subtotal + deliveryFee;

  // Stock is validated above but NOT decremented here — it is only ever
  // decremented once payment is confirmed (see finalizeOrderPayment), so an
  // abandoned or failed checkout never reserves inventory.
  const placeholderNumber = `PENDING-${Date.now()}`;
  const info = db
    .prepare(
      `INSERT INTO orders
        (order_number, customer_name, phone, email, fulfilment_type, address, subtotal, delivery_fee, total, status, payment_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'unpaid')`
    )
    .run(
      placeholderNumber,
      input.customerName,
      input.phone,
      input.email,
      input.fulfilmentType,
      input.address || null,
      subtotal,
      deliveryFee,
      total
    );

  const orderId = info.lastInsertRowid;
  const orderNumber = `DGN${String(orderId).padStart(6, "0")}`;
  db.prepare("UPDATE orders SET order_number = ? WHERE id = ?").run(
    orderNumber,
    orderId
  );

  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name, color, storage, unit_price, quantity)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  for (const item of resolvedItems) {
    insertItem.run(
      orderId,
      item.product.id,
      item.product.name,
      item.color,
      item.storage,
      item.unitPrice,
      item.quantity
    );
  }

  return getOrderById(orderId);
});

export function updateOrderStatus(id, status) {
  const info = db
    .prepare("UPDATE orders SET status = ? WHERE id = ?")
    .run(status, id);
  if (info.changes === 0) return null;
  return getOrderById(id);
}

export function attachStripeCheckoutSession(orderId, sessionId) {
  db.prepare("UPDATE orders SET stripe_checkout_session_id = ? WHERE id = ?").run(
    sessionId,
    orderId
  );
}

// Called from the Stripe webhook once a payment is confirmed. Stripe may
// deliver the same event more than once, so this only decrements stock and
// flips the order to paid the first time — every later call is a no-op.
export const finalizeOrderPayment = db.transaction((orderId, paymentIntentId) => {
  const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  if (!row) return null;
  if (row.payment_status === "paid") {
    return serializeOrder(row, getItemsForOrder(row.id));
  }

  const items = getItemsForOrder(orderId);
  for (const item of items) {
    if (item.product_id) {
      decrementStock(item.product_id, item.storage, item.quantity);
    }
  }

  db.prepare(
    "UPDATE orders SET payment_status = 'paid', stripe_payment_intent_id = ? WHERE id = ?"
  ).run(paymentIntentId || null, orderId);

  return getOrderById(orderId);
});

export function markOrderPaymentFailed(orderId) {
  const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  if (!row || row.payment_status === "paid") return getOrderById(orderId);
  db.prepare("UPDATE orders SET payment_status = 'failed' WHERE id = ?").run(orderId);
  return getOrderById(orderId);
}

export function getStripePaymentIntentId(orderId) {
  const row = db
    .prepare("SELECT stripe_payment_intent_id FROM orders WHERE id = ?")
    .get(orderId);
  return row?.stripe_payment_intent_id ?? null;
}

export function markOrderRefunded(orderId) {
  const info = db
    .prepare("UPDATE orders SET payment_status = 'refunded' WHERE id = ?")
    .run(orderId);
  if (info.changes === 0) return null;
  return getOrderById(orderId);
}

export { serializeOrder };
