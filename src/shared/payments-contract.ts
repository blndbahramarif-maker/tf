import { z } from 'zod';

/**
 * Payment request schemas.
 *
 * Notice how SMALL these are. That is the point, not an omission: a buyer
 * creating an order names a listing and, optionally, an accepted offer. There
 * is no `amount`, no `currency`, no `sellerId`, no `stripeAccountId` and no
 * `commission` field anywhere in this file, because the server derives every
 * one of them from the database.
 *
 * `z.object` STRIPS undeclared keys, so a request carrying `amountMinor` does
 * not merely fail a check — the field never reaches the handler at all. That
 * is the strongest form of "never trust the browser" available: the value has
 * nowhere to arrive.
 */

export const createOrderSchema = z.object({
  listingId: z.string().uuid(),
  /**
   * An accepted offer to price the order from. It is a LOOKUP KEY: the route
   * re-reads the offer scoped to this buyer and this listing, and an offer id
   * belonging to somebody else resolves to nothing.
   */
  offerId: z.string().uuid().optional(),
});

/**
 * Beginning payment takes no body at all.
 *
 * Everything the charge needs is already on the order row, which was written
 * server-side when the order was created and is immutable from that point by
 * database trigger.
 */
export const beginPaymentSchema = z.object({}).strict();

export type CreateOrderRequest = z.infer<typeof createOrderSchema>;

/** Statuses a buyer's order-status poll may see. Mirrors the domain enum. */
export const ORDER_STATUS_VALUES = [
  'DRAFT',
  'PENDING_PAYMENT',
  'PAID',
  'FULFILLING',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'REFUNDING',
  'REFUNDED',
  'DISPUTED',
  'CHARGEBACK',
] as const;
