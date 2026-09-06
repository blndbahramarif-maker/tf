import { Router } from "express";
import express from "express";
import { stripe } from "../stripe.js";
import {
  finalizeOrderPayment,
  markOrderPaymentFailed,
  markOrderRefunded,
  getOrderByPaymentIntentId,
} from "../models/orders.js";

export const stripeWebhookRouter = Router();

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Stripe signature verification needs the exact raw bytes of the request
// body, so this route parses as raw (not JSON) and must be mounted before
// the app-wide express.json() middleware.
stripeWebhookRouter.post(
  "/",
  express.raw({ type: "application/json" }),
  (req, res) => {
    if (!stripe || !webhookSecret) {
      console.error("Stripe webhook received but Stripe is not configured.");
      return res.status(503).send("Stripe not configured");
    }

    let event;
    try {
      const signature = req.headers["stripe-signature"];
      event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
    } catch (err) {
      console.error("Stripe webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      handleEvent(event);
    } catch (err) {
      console.error("Error handling Stripe webhook event:", err);
      return res.status(500).send("Webhook handler error");
    }

    res.json({ received: true });
  }
);

function handleEvent(event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const orderId = Number(session.metadata?.orderId);
      if (!orderId) break;
      if (session.payment_status === "paid") {
        finalizeOrderPayment(orderId, session.payment_intent);
      }
      break;
    }
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object;
      const orderId = Number(session.metadata?.orderId);
      if (!orderId) break;
      finalizeOrderPayment(orderId, session.payment_intent);
      break;
    }
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed": {
      const session = event.data.object;
      const orderId = Number(session.metadata?.orderId);
      if (!orderId) break;
      markOrderPaymentFailed(orderId);
      break;
    }
    case "charge.refunded": {
      const charge = event.data.object;
      const order = getOrderByPaymentIntentId(charge.payment_intent);
      if (order) markOrderRefunded(order.id);
      break;
    }
    default:
      break;
  }
}
