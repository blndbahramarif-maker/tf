import { Router } from "express";
import { createOrder, OrderValidationError } from "../models/orders.js";

export const ordersRouter = Router();

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
