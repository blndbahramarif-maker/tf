import { z } from 'zod';

/**
 * Message size limits.
 *
 * They live here, in the innermost layer, because both the request schemas and
 * the domain validator need them and `src/shared` may not import outward
 * (ADR-0002). The domain imports these; not the other way round.
 */
export const MAX_MESSAGE_LENGTH = 4000;
export const MIN_MESSAGE_LENGTH = 1;
/** Guards the normaliser itself against a megabyte of input. */
export const MAX_RAW_MESSAGE_BYTES = 64 * 1024;

/**
 * Messaging and offer request schemas.
 *
 * These bound the request at the edge. Content RULES — what counts as an
 * acceptable message, how it is scored — live in `src/domain/messaging`, so
 * they are testable without a request.
 */

export const startConversationSchema = z.object({
  /** The listing being enquired about. Required: a conversation with no
   *  subject is how a marketplace inbox becomes unusable. */
  listingId: z.string().uuid(),
  /** The opening message. A conversation is never created empty. */
  body: z.string().min(1).max(MAX_RAW_MESSAGE_BYTES),
});

export const sendMessageSchema = z.object({
  body: z.string().min(1).max(MAX_RAW_MESSAGE_BYTES),
});

export const messagePageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(200).optional(),
});

export const reportSchema = z.object({
  reasonCode: z.enum([
    'spam',
    'scam',
    'harassment',
    'off_platform_payment',
    'illegal_goods',
    'other',
  ]),
  details: z.string().max(2000).optional(),
});

/**
 * Offer amount crosses the wire as an integer minor-unit STRING (ADR-0004).
 * A number would lose precision above 2^53 and invite a float somewhere.
 */
export const offerAmountSchema = z
  .string()
  .regex(/^\d{1,19}$/, 'amountMinor must be a non-negative integer string');

export const createOfferSchema = z.object({
  listingId: z.string().uuid(),
  amountMinor: offerAmountSchema,
  currency: z.string().length(3).toUpperCase().default('GBP'),
  message: z.string().max(MAX_MESSAGE_LENGTH).optional(),
  /** Days the offer stays open. Bounded by the domain. */
  expiresInDays: z.coerce.number().int().min(1).max(30).optional(),
  /** Save without sending. Defaults to sending. */
  asDraft: z.boolean().optional(),
  /**
   * The thread this offer belongs to, when it was made from one.
   *
   * Declared here because `z.object` STRIPS undeclared keys: without this
   * field the route's participation check would receive `undefined` for every
   * request and silently never attach an offer to its conversation. It is a
   * lookup key only — the route proves the caller is in that thread before
   * using it.
   */
  conversationId: z.string().uuid().optional(),
});

/**
 * Offer transitions go through ONE endpoint driven by the state machine,
 * rather than a route per verb — the same shape as listing status changes.
 */
export const offerTransitionSchema = z.object({
  to: z.enum(['SUBMITTED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'CANCELLED']),
  note: z.string().max(500).optional(),
});

export type StartConversationRequest = z.infer<typeof startConversationSchema>;
export type SendMessageRequest = z.infer<typeof sendMessageSchema>;
export type CreateOfferRequest = z.infer<typeof createOfferSchema>;
export type OfferTransitionRequest = z.infer<typeof offerTransitionSchema>;
