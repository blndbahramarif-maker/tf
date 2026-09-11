import { z } from 'zod';

/**
 * Password bounds live here, in the innermost layer, so both the domain policy
 * and the request schemas can use them without `src/shared` importing outward.
 *
 * The upper bound is a real control, not tidiness: Argon2 cost scales with
 * input length, so an unbounded password is a cheap denial-of-service.
 */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

/**
 * Request and response schemas for the authentication surface.
 *
 * Defined in `src/shared` so the same definitions drive runtime validation,
 * the OpenAPI document and any future client.
 */

export const emailSchema = z.email().max(254).toLowerCase();

export const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH);

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().min(2).max(80),
  countryCode: z.string().length(2).toUpperCase().optional(),
});

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  /** Required when the account has two-factor enabled. */
  totpCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  recoveryCode: z.string().min(8).max(64).optional(),
});

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(16).max(512),
});

export const verifyEmailRequestSchema = z.object({
  token: z.string().min(16).max(512),
});

export const stepUpRequestSchema = z.object({
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  totpCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  newPassword: passwordSchema,
});

export const totpVerifyRequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

export const updateMeRequestSchema = z.object({
  displayName: z.string().min(2).max(80).optional(),
  preferredLocale: z.enum(['en', 'ckb', 'kmr', 'ar']).optional(),
  timezone: z.string().min(1).max(64).optional(),
});

export const createSellerProfileRequestSchema = z.object({
  displayName: z.string().min(2).max(120),
  sellerType: z.enum(['INDIVIDUAL', 'BUSINESS']).default('INDIVIDUAL'),
  countryCode: z.string().length(2).toUpperCase(),
  about: z.string().max(2000).optional(),
});

export const updateSellerProfileRequestSchema = z.object({
  displayName: z.string().min(2).max(120).optional(),
  about: z.string().max(2000).optional(),
});

export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.iso.datetime(),
  refreshToken: z.string(),
  refreshTokenExpiresAt: z.iso.datetime(),
  tokenType: z.literal('Bearer'),
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
