import { z } from 'zod';

/**
 * Shared API conventions.
 *
 * Every endpoint in /api/v1 uses these shapes. They are defined here (pure,
 * framework-free) so the same definitions drive: runtime validation, the
 * OpenAPI document, the web client, and eventually the mobile clients.
 * See openapi/openapi.yaml and ADR-0004.
 */

/**
 * Machine-readable error codes. Clients switch on `code`, never on `message` —
 * messages are localised and may change.
 */
export const ERROR_CODES = [
  'validation_failed',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'idempotency_key_reused',
  'payment_required',
  'internal_error',
  'service_unavailable',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const fieldErrorSchema = z.object({
  /** Dot path to the offending field, e.g. "listing.priceMinor". */
  path: z.string(),
  message: z.string(),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    /** Human-readable, for developers. Not for display to end users. */
    message: z.string(),
    /** Present for validation_failed. */
    fields: z.array(fieldErrorSchema).optional(),
    /** Correlates a client report with server logs. */
    requestId: z.string(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

/**
 * Cursor pagination, not offset.
 *
 * Offset pagination drifts when rows are inserted mid-scroll, which on a
 * marketplace listing feed means duplicated and skipped results. Cursors are
 * also what mobile infinite-scroll needs.
 */
export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function pageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    page: z.object({
      nextCursor: z.string().nullable(),
      hasMore: z.boolean(),
    }),
  });
}

/**
 * Money on the wire.
 *
 * `amountMinor` is a STRING, not a number: amounts are 64-bit integers in minor
 * units and JavaScript's `number` silently loses precision above 2^53. Sending
 * it as a string keeps the value exact through every client.
 * See docs/03-database-architecture.md.
 */
export const moneySchema = z.object({
  amountMinor: z.string().regex(/^-?\d+$/, 'amountMinor must be an integer string'),
  currency: z.string().length(3).toUpperCase(),
});

export type Money = z.infer<typeof moneySchema>;

export const healthResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  checkedAt: z.iso.datetime(),
  version: z.string(),
  appEnv: z.enum(['local', 'test', 'staging', 'production']),
  dependencies: z.array(
    z.object({
      name: z.string(),
      ok: z.boolean(),
      critical: z.boolean(),
      latencyMs: z.number().optional(),
      detail: z.string().optional(),
    }),
  ),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
