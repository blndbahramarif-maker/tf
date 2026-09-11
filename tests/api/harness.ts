import { randomUUID } from 'node:crypto';
import type { NextResponse } from 'next/server';
import { prisma } from '@/infra/db/client';
import { hashPassword } from '@/infra/auth/password-hasher';
import { encryptSecret } from '@/infra/auth/crypto';
import { createSession } from '@/infra/auth/session-service';
import { generateTotpSecret } from '@/infra/auth/totp';
import { getRedis } from '@/infra/redis/client';

export const hasDatabase = Boolean(process.env.TEST_DATABASE_URL);

/**
 * Calls a Next.js route handler directly.
 *
 * This exercises the REAL handler — the same guards, the same database, the
 * same Redis — without an HTTP server in between. Nothing about authorization
 * is stubbed: a test that passes here passes because the production code path
 * allowed it.
 */
export interface CallOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  searchParams?: Record<string, string>;
  ip?: string;
  /**
   * Cookies to send, exercising the BROWSER transport rather than the bearer
   * one. Set this to test what a browser can do, including what it should be
   * refused when a CSRF token is absent or forged.
   */
  cookies?: Record<string, string>;
  /** Convenience: sets the `X-CSRF-Token` header. */
  csrfHeader?: string | null;
}

export interface CallResult {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
  raw: string;
}

/**
 * Next.js route handlers declare their own params shape (`{ id: string }`,
 * `{}`, …). The harness passes whatever the test supplies, so the context type
 * is contravariant here — `any` in this one position keeps every real handler
 * assignable without weakening anything the handlers themselves check.
 */
type Handler = (request: Request, context: any) => Promise<NextResponse> | NextResponse;

export async function callRoute(
  handler: Handler,
  path: string,
  options: CallOptions = {},
): Promise<CallResult> {
  const url = new URL(`http://localhost:3000${path}`);
  for (const [key, value] of Object.entries(options.searchParams ?? {})) {
    url.searchParams.set(key, value);
  }

  const headers = new Headers({
    'content-type': 'application/json',
    // A distinct IP per call by default, so one test's rate-limit counter
    // cannot bleed into the next.
    'x-forwarded-for': options.ip ?? `10.0.0.${Math.floor(Math.random() * 250) + 1}`,
    'x-request-id': randomUUID(),
    ...options.headers,
  });
  if (options.token) headers.set('authorization', `Bearer ${options.token}`);

  if (options.cookies) {
    headers.set(
      'cookie',
      Object.entries(options.cookies)
        .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
        .join('; '),
    );
  }
  if (options.csrfHeader) headers.set('x-csrf-token', options.csrfHeader);

  const request = new Request(url, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  const response = await handler(request, {
    params: Promise.resolve(options.params ?? {}),
  });

  const raw = await response.text();
  let body: Record<string, unknown>;
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    body = { _unparsed: raw };
  }

  return { status: response.status, body, headers: response.headers, raw };
}

// ── Fixtures ────────────────────────────────────────────────────────────────

export interface TestUser {
  id: string;
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  familyId: string;
  sellerProfileId?: string;
  totpSecret?: string;
}

export interface CreateUserOptions {
  roles?: string[];
  emailVerified?: boolean;
  twoFactor?: boolean;
  status?: 'ACTIVE' | 'SUSPENDED' | 'BANNED';
  /** Session begins stepped-up, as a real login does. */
  stepUp?: boolean;
  withSellerProfile?: boolean;
}

const DEFAULT_PASSWORD = 'correct horse battery staple';

let counter = 0;

/** Creates a user with roles, an active session, and optionally a seller profile. */
export async function createTestUser(options: CreateUserOptions = {}): Promise<TestUser> {
  counter += 1;
  const email = `user${counter}.${Date.now()}@example.test`;
  const roles = options.roles ?? ['buyer'];
  const emailVerified = options.emailVerified ?? true;

  const roleRecords = await prisma.role.findMany({ where: { key: { in: roles } } });
  if (roleRecords.length !== roles.length) {
    throw new Error(`Unknown role in ${JSON.stringify(roles)}`);
  }

  const totpSecret = options.twoFactor ? generateTotpSecret() : undefined;

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(DEFAULT_PASSWORD),
      passwordChangedAt: new Date(),
      emailVerifiedAt: emailVerified ? new Date() : null,
      status: options.status ?? 'ACTIVE',
      twoFactorSecretEnc: totpSecret ? encryptSecret(totpSecret) : null,
      twoFactorEnabledAt: totpSecret ? new Date() : null,
      profile: { create: { displayName: `Test User ${counter}` } },
      roles: { create: roleRecords.map((role) => ({ roleId: role.id })) },
    },
    select: { id: true },
  });

  let sellerProfileId: string | undefined;
  if (options.withSellerProfile) {
    const country = await prisma.country.findUniqueOrThrow({ where: { code: 'GB' } });
    const profile = await prisma.sellerProfile.create({
      data: {
        userId: user.id,
        slug: `seller-${counter}-${Date.now()}`,
        displayName: `Seller ${counter}`,
        countryId: country.id,
      },
      select: { id: true },
    });
    sellerProfileId = profile.id;
  }

  const session = await createSession({
    userId: user.id,
    stepUpAt: options.stepUp === false ? null : new Date(),
  });
  if (!session) throw new Error('Failed to create session for test user');

  return {
    id: user.id,
    email,
    password: DEFAULT_PASSWORD,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    familyId: session.familyId,
    ...(sellerProfileId === undefined ? {} : { sellerProfileId }),
    ...(totpSecret === undefined ? {} : { totpSecret }),
  };
}

/**
 * Creates a listing directly in the database, bypassing the API.
 *
 * Used to set up fixtures for tests about something OTHER than creation — the
 * create route itself is tested through the API.
 */
export async function createTestListing(options: {
  ownerSellerProfileId: string;
  categorySlug?: string;
  title?: string;
  status?: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'PENDING_REVIEW';
  priceMinor?: bigint;
  attributes?: Record<string, unknown>;
  withReadyImage?: boolean;
}): Promise<{ id: string; slug: string }> {
  const category = await prisma.category.findUniqueOrThrow({
    where: { slug: options.categorySlug ?? 'mobile-electronics' },
  });
  const country = await prisma.country.findUniqueOrThrow({ where: { code: 'GB' } });

  counter += 1;
  const listing = await prisma.listing.create({
    data: {
      sellerProfileId: options.ownerSellerProfileId,
      categoryId: category.id,
      title: options.title ?? `Test Listing ${counter}`,
      slug: `test-listing-${counter}-${Date.now()}`,
      description: 'A description long enough to pass validation.',
      priceMinor: options.priceMinor ?? 20_000n,
      currency: 'GBP',
      countryId: country.id,
      status: options.status ?? 'DRAFT',
      attributes: (options.attributes ?? {}) as never,
      ...(options.status === 'ACTIVE' ? { publishedAt: new Date() } : {}),
    },
    select: { id: true, slug: true },
  });

  if (options.withReadyImage) {
    await prisma.listingImage.create({
      data: {
        listingId: listing.id,
        storageKey: `listings/${listing.id}/fixture`,
        url: 'http://localhost:3000/media/fixture-card.webp',
        uploadStatus: 'READY',
        moderationStatus: 'APPROVED',
        isPrimary: true,
        width: 720,
        height: 540,
      },
    });
  }

  return listing;
}

/** A syntactically valid UUID that belongs to nobody. */
export function orphanId(): string {
  return randomUUID();
}

export async function countAuditLogs(action: string, actorId?: string): Promise<number> {
  return prisma.auditLog.count({
    where: { action, ...(actorId === undefined ? {} : { actorId }) },
  });
}

export async function latestAuditLog(action: string) {
  return prisma.auditLog.findFirst({
    where: { action },
    orderBy: { createdAt: 'desc' },
  });
}

export async function clearRateLimits(): Promise<void> {
  const redis = getRedis();
  const keys = await redis.keys('ratelimit:*');
  if (keys.length > 0) await redis.del(...keys);
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
  await getRedis().quit();
}

export { DEFAULT_PASSWORD };
