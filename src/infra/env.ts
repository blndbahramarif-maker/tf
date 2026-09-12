import { z } from 'zod';

/**
 * Typed environment configuration.
 *
 * Two rules this file exists to enforce:
 *   1. The app fails fast at boot on bad configuration, rather than at 3am on
 *      the first payment.
 *   2. Secrets are read here, server-side, and never exposed to the browser.
 *      Anything the client legitimately needs goes in `clientEnv`, which may
 *      only ever contain publishable values.
 */

const appEnv = z.enum(['local', 'test', 'staging', 'production']);

const serverSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: appEnv.default('local'),
    APP_URL: z.url().default('http://localhost:3000'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    /** Scratch database for Prisma Migrate diffs. Optional. */
    SHADOW_DATABASE_URL: z.string().optional(),
    /** Enables tests/db/*. Must never point at a production database. */
    TEST_DATABASE_URL: z.string().optional(),

    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

    /** Signs access tokens (HS256). Phase 3. */
    AUTH_SECRET: z.string().min(32).optional(),
    /** Encrypts TOTP secrets at rest (AES-256-GCM). 32 bytes as 64 hex chars. */
    AUTH_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-f]{64}$/i, 'AUTH_ENCRYPTION_KEY must be 64 hex characters (32 bytes)')
      .optional(),

    /** Object storage. Phase 4. */
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),

    /**
     * Stripe. Phase 7 Part 1 — **TEST MODE ONLY**.
     *
     * The prefix check here catches a pasted publishable or restricted key at
     * boot. Which MODE a key is (`sk_test_` vs `sk_live_`) and whether live
     * mode is permitted at all is decided in `src/infra/stripe/config.ts`,
     * because it is a policy question rather than a shape question.
     */
    STRIPE_SECRET_KEY: z.string().startsWith('sk_').optional(),
    STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_').optional(),

    /** Outbound mail. Phase 5. */
    SMTP_URL: z.string().optional(),
    MAIL_FROM: z.email().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV !== 'production') return;

    // Production has stricter requirements than local development. Checking
    // them here means a misconfigured deploy fails at startup, visibly.
    const requiredInProduction: Array<keyof typeof env> = [
      'AUTH_SECRET',
      'AUTH_ENCRYPTION_KEY',
      'S3_BUCKET',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'MAIL_FROM',
    ];

    for (const key of requiredInProduction) {
      if (!env[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${String(key)} is required when APP_ENV=production`,
        });
      }
    }

    if (env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
      ctx.addIssue({
        code: 'custom',
        path: ['STRIPE_SECRET_KEY'],
        message: 'Refusing to start: a Stripe TEST key is configured with APP_ENV=production.',
      });
    }
  });

/**
 * Values safe to ship to the browser. Publishable by definition — never add a
 * secret here. `kurdora/no-public-env-secrets` guards the common mistakes.
 */
const clientSchema = z.object({
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().startsWith('pk_').optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;
export type ClientEnv = z.infer<typeof clientSchema>;

let cached: ServerEnv | null = null;

/**
 * Parses and caches server environment. Throws with a readable summary of every
 * problem at once, rather than one at a time.
 */
export function serverEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  cached = parsed.data;
  return cached;
}

export function clientEnv(): ClientEnv {
  return clientSchema.parse({
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  });
}

/** Exported for tests and for scripts/check-env.ts. */
export const schemas = { server: serverSchema, client: clientSchema };
