import { z } from 'zod';

/**
 * Listing request schemas.
 *
 * Category-specific fields are NOT described here — they are validated at
 * runtime against the category's attribute definitions from the database
 * (`src/domain/catalogue/attributes.ts`). A static schema could not express
 * fields an admin adds without a deploy.
 */

export const LISTING_CONDITIONS = [
  'NEW',
  'LIKE_NEW',
  'GOOD',
  'FAIR',
  'FOR_PARTS',
  'NOT_APPLICABLE',
] as const;

export const PRICE_TYPES = ['FIXED', 'NEGOTIABLE', 'ON_REQUEST', 'FREE'] as const;

/**
 * Prices cross the wire as integer minor-unit STRINGS (ADR-0004): a 64-bit
 * amount exceeds JavaScript's safe number range.
 */
export const priceMinorSchema = z
  .string()
  .regex(/^\d{1,18}$/, 'priceMinor must be a non-negative integer string');

export const createListingSchema = z.object({
  categorySlug: z.string().min(1).max(120),
  title: z.string().min(3).max(140),
  description: z.string().min(10).max(10_000),
  /** The language the SELLER wrote in. Never machine-translated silently. */
  contentLocale: z.enum(['en', 'ckb', 'kmr', 'ar']).default('en'),
  priceMinor: priceMinorSchema.optional(),
  currency: z.string().length(3).toUpperCase().default('GBP'),
  priceType: z.enum(PRICE_TYPES).default('FIXED'),
  countryCode: z.string().length(2).toUpperCase(),
  citySlug: z.string().max(80).optional(),
  condition: z.enum(LISTING_CONDITIONS).default('NOT_APPLICABLE'),
  quantity: z.number().int().min(1).max(9999).default(1),
  /** Category-specific values, validated against the category's definitions. */
  attributes: z.record(z.string(), z.unknown()).default({}),
});

export const updateListingSchema = createListingSchema
  .omit({ categorySlug: true, countryCode: true })
  .partial()
  .extend({
    citySlug: z.string().max(80).nullable().optional(),
  });

/**
 * Status changes go through ONE endpoint driven by the state machine, rather
 * than a route per verb. Adding a transition then needs no new route.
 */
export const listingTransitionSchema = z.object({
  to: z.enum(['PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'SOLD', 'DRAFT', 'REMOVED', 'REJECTED']),
  reason: z.string().max(500).optional(),
});

export const createImageUploadSchema = z.object({
  /** Advisory only. The server decides format from magic bytes. */
  declaredContentType: z.string().max(100).optional(),
  altText: z.string().max(200).optional(),
});

export const finaliseImageSchema = z.object({
  altText: z.string().max(200).optional(),
  isPrimary: z.boolean().optional(),
});

export type CreateListingRequest = z.infer<typeof createListingSchema>;
export type UpdateListingRequest = z.infer<typeof updateListingSchema>;

/**
 * Reporting a listing.
 *
 * Deliberately its own schema rather than reusing the messaging one. The
 * reasons someone reports a LISTING are not the reasons they report a
 * conversation: `off_platform_payment` is meaningless here, because every
 * Kurdora transaction is off-platform by design, and `prohibited_item` has no
 * meaning in a chat thread.
 *
 * `other` exists and carries free text, because the point of reporting is to
 * hear about the thing nobody predicted — a fixed list would silently discard
 * exactly the reports worth reading.
 */
export const listingReportSchema = z.object({
  reasonCode: z.enum([
    'prohibited_item',
    'counterfeit',
    'stolen_goods',
    'scam',
    'unsafe_or_illegal',
    'offensive',
    'wrong_category',
    'other',
  ]),
  details: z.string().max(2000).optional(),
});

export type ListingReportRequest = z.infer<typeof listingReportSchema>;
