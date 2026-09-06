import { Router } from "express";
import {
  createOrder,
  getOrderById,
  OrderValidationError,
  attachStripeCheckoutSession,
  getOrderByStripeSessionId,
} from "../models/orders.js";
import { requireStripe } from "../stripe.js";

export const ordersRouter = Router();

const CLIENT_URL = (process.env.CLIENT_URL || "http://localhost:5173").replace(/\/$/, "");

ordersRouter.post("/", (req, res) => {
  const { customerName, phone, email, fulfilmentType, address, items } = req.body || {};

  if (!customerName || !phone || !email) {
    return res.status(400).json({ error: "Name, phone and email are required." });
  }
  if (!["collection", "delivery"].includes(fulfilmentType)) {
    return res.status(400).json({ error: "Invalid fulfilment type." });
  }
  if (fulfilmentType === "delivery" && !address) {
    return res.status(400).json({ error: "Delivery address is required." });
  }

  try {
    const order = createOrder({
      customerName,
      phone,
      email,
      fulfilmentType,
      address,
      items,
    });
    res.status(201).json({ order });
  } catch (err) {
    if (err instanceof OrderValidationError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Could not place order. Please try again." });
  }
});

// Creates a Stripe Checkout Session for an order that was just placed and is
// still unpaid. Line items are rebuilt from the order's own stored items
// server-side, so the browser never sends prices Stripe will charge.
ordersRouter.post("/:id/checkout-session", async (req, res) => {
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId)) {
    return res.status(400).json({ error: "Invalid order id." });
  }

  try {
    const stripe = requireStripe();
    const order = getOrderById(orderId);
    if (!order) {
      return res.status(404).json({ error: "Order not found." });
    }
    if (order.paymentStatus === "paid") {
      return res.status(400).json({ error: "This order has already been paid." });
    }

    const line_items = order.items.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: "gbp",
        unit_amount: Math.round(item.unitPrice * 100),
        product_data: {
          name: [item.productName, item.color, item.storage].filter(Boolean).join(" – "),
        },
      },
    }));

    if (order.deliveryFee > 0) {
      line_items.push({
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: Math.round(order.deliveryFee * 100),
          product_data: { name: "Delivery" },
        },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: order.email,
      line_items,
      metadata: { orderId: String(order.id) },
      success_url: `${CLIENT_URL}/order-confirmation?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${CLIENT_URL}/checkout?payment=cancelled`,
    });

    attachStripeCheckoutSession(order.id, session.id);
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not start payment. Please try again." });
  }
});

// Public, non-enumerable lookup used by the order confirmation page — keyed
// by the opaque Stripe session id rather than the sequential order id.
ordersRouter.get("/session/:sessionId", (req, res) => {
  const order = getOrderByStripeSessionId(req.params.sessionId);
  if (!order) {
    return res.status(404).json({ error: "Order not found." });
  }
  res.json({ order });
});
