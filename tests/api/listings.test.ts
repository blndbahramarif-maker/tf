import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { GET as listSearch, POST as createListing } from '../../app/api/v1/listings/route';
import {
  DELETE as deleteListing,
  GET as getListing,
  PATCH as patchListing,
} from '../../app/api/v1/listings/[id]/route';
import { POST as transition } from '../../app/api/v1/listings/[id]/status/route';
import { POST as startUpload } from '../../app/api/v1/listings/[id]/images/route';
import {
  POST as finaliseImage,
  DELETE as deleteImage,
} from '../../app/api/v1/listings/[id]/images/[imageId]/route';
import { PUT as receiveUpload } from '../../app/api/v1/uploads/[token]/route';
import { GET as getCategory } from '../../app/api/v1/categories/[slug]/route';
import { GET as listCategories } from '../../app/api/v1/categories/route';
import { prisma } from '@/infra/db/client';
import {
  callRoute,
  clearRateLimits,
  createTestListing,
  createTestUser,
  disconnect,
  hasDatabase,
  orphanId,
  type TestUser,
} from './harness';

async function jpegBytes(width = 800, height = 600): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#446' } })
    .jpeg()
    .toBuffer();
}

/** Runs the full upload pipeline for a listing, returning the image id. */
async function uploadImage(
  user: TestUser,
  listingId: string,
  bytes: Buffer,
  finaliseBody: Record<string, unknown> = {},
) {
  const started = await callRoute(startUpload, `/api/v1/listings/${listingId}/images`, {
    method: 'POST',
    token: user.accessToken,
    params: { id: listingId },
    body: {},
  });
  if (started.status !== 201) return { started, finalised: null };

  const upload = started.body.upload as { url: string };
  const token = upload.url.split('/uploads/')[1] ?? '';

  // The bytes go through the real upload receiver, ticket and all.
  const request = new Request(`http://localhost:3000/api/v1/uploads/${token}`, {
    method: 'PUT',
    body: new Uint8Array(bytes),
    headers: { 'content-length': String(bytes.length) },
  });
  await receiveUpload(request, { params: Promise.resolve({ token }) });

  const imageId = started.body.imageId as string;
  const finalised = await callRoute(
    finaliseImage,
    `/api/v1/listings/${listingId}/images/${imageId}`,
    {
      method: 'POST',
      token: user.accessToken,
      params: { id: listingId, imageId },
      body: finaliseBody,
    },
  );

  return { started, finalised, imageId };
}

describe.skipIf(!hasDatabase)('listings', () => {
  let seller: TestUser;
  let otherSeller: TestUser;
  let moderator: TestUser;

  beforeAll(async () => {
    await clearRateLimits();
    seller = await createTestUser({ roles: ['seller'], withSellerProfile: true, stepUp: true });
    otherSeller = await createTestUser({
      roles: ['seller'],
      withSellerProfile: true,
      stepUp: true,
    });
    moderator = await createTestUser({ roles: ['moderator'], twoFactor: true, stepUp: true });
  }, 120_000);

  beforeEach(async () => {
    await clearRateLimits();
  });

  afterAll(async () => {
    await disconnect();
  });

  // ── Categories ────────────────────────────────────────────────────────────

  describe('categories', () => {
    it('returns the active tree with localised names, publicly', async () => {
      const result = await callRoute(listCategories, '/api/v1/categories', {});
      expect(result.status).toBe(200);
      const data = result.body.data as Array<{ slug: string; name: string }>;
      expect(data.map((c) => c.slug).sort()).toEqual([
        'business',
        'cars',
        'kurdish-clothing',
        'mobile-electronics',
      ]);
      expect(data.find((c) => c.slug === 'cars')?.name).toBe('Cars');
    });

    it('returns SORANI names when asked, not an English-only structure', async () => {
      const result = await callRoute(listCategories, '/api/v1/categories', {
        headers: { 'accept-language': 'ckb' },
      });
      const data = result.body.data as Array<{ slug: string; name: string }>;
      const cars = data.find((c) => c.slug === 'cars');
      expect(result.body.locale).toBe('ckb');
      expect(cars?.name).toBe('ئۆتۆمبێل');
    });

    it('exposes transaction behaviour as DATA, so no client branches on a name', async () => {
      const result = await callRoute(listCategories, '/api/v1/categories', {});
      const data = result.body.data as Array<{ slug: string; transactionFlow: string }>;
      expect(data.find((c) => c.slug === 'cars')?.transactionFlow).toBe('FEE_ONLY');
      expect(data.find((c) => c.slug === 'mobile-electronics')?.transactionFlow).toBe('BUY_NOW');
    });

    it('returns a category with its attribute definitions and options', async () => {
      const result = await callRoute(getCategory, '/api/v1/categories/cars', {
        params: { slug: 'cars' },
      });
      expect(result.status).toBe(200);

      const attributes = result.body.attributes as Array<{
        key: string;
        dataType: string;
        isRequired: boolean;
        options: { value: string; label: string }[];
      }>;
      const fuel = attributes.find((a) => a.key === 'fuel_type');
      expect(fuel?.dataType).toBe('ENUM');
      expect(fuel?.options.map((o) => o.value)).toContain('diesel');
      expect(attributes.find((a) => a.key === 'mileage')?.isRequired).toBe(true);
    });

    it('localises attribute labels and option labels', async () => {
      const result = await callRoute(getCategory, '/api/v1/categories/cars', {
        params: { slug: 'cars' },
        headers: { 'accept-language': 'ckb' },
      });
      const attributes = result.body.attributes as Array<{ key: string; label: string }>;
      expect(attributes.find((a) => a.key === 'year')?.label).toBe('ساڵ');
    });

    it('404s an unknown category', async () => {
      const result = await callRoute(getCategory, '/api/v1/categories/nope', {
        params: { slug: 'nope' },
      });
      expect(result.status).toBe(404);
    });
  });

  // ── Creation and validation ───────────────────────────────────────────────

  describe('creation', () => {
    const validPhone = () => ({
      categorySlug: 'mobile-electronics',
      title: 'iPhone 14 Pro 256GB',
      description: 'Excellent condition, boxed with charger and original receipt.',
      priceMinor: '65000',
      currency: 'GBP',
      countryCode: 'GB',
      citySlug: 'london',
      condition: 'LIKE_NEW',
      attributes: { brand: 'Apple', model: 'iPhone 14 Pro', storage_gb: 256 },
    });

    it('creates a DRAFT, never publishing on create', async () => {
      const result = await callRoute(createListing, '/api/v1/listings', {
        method: 'POST',
        token: seller.accessToken,
        body: validPhone(),
      });
      expect(result.status).toBe(201);
      expect(result.body.status).toBe('DRAFT');
    });

    it('writes BOTH the normalised rows and the JSONB projection', async () => {
      const result = await callRoute(createListing, '/api/v1/listings', {
        method: 'POST',
        token: seller.accessToken,
        body: validPhone(),
      });
      const id = result.body.id as string;

      const listing = await prisma.listing.findUniqueOrThrow({
        where: { id },
        select: {
          attributes: true,
          attributeValues: { select: { valueText: true, valueInteger: true } },
        },
      });

      expect(listing.attributes).toMatchObject({ brand: 'Apple', storage_gb: 256 });
      expect(listing.attributeValues.length).toBe(3);
      expect(listing.attributeValues.some((v) => v.valueInteger === 256n)).toBe(true);
    });

    it('rejects an attribute that is not defined for the category', async () => {
      const result = await callRoute(createListing, '/api/v1/listings', {
        method: 'POST',
        token: seller.accessToken,
        body: { ...validPhone(), attributes: { brand: 'Apple', model: 'X', mileage: 90000 } },
      });
      expect(result.status).toBe(422);
      const fields = result.body.error as { fields: { path: string }[] };
      expect(fields.fields.some((f) => f.path === 'attributes.mileage')).toBe(true);
    });

    it('rejects a missing REQUIRED attribute', async () => {
      const result = await callRoute(createListing, '/api/v1/listings', {
        method: 'POST',
        token: seller.accessToken,
        body: { ...validPhone(), attributes: { brand: 'Apple' } },
      });
      expect(result.status).toBe(422);
    });

    it('rejects an out-of-range attribute value', async () => {
      const result = await callRoute(createListing, '/api/v1/listings', {
        method: 'POST',
        token: seller.accessToken,
        // storage_gb is capped at 8192 by the attribute definition.
        body: { ...validPhone(), attributes: { brand: 'Apple', model: 'X', storage_gb: 99_999 } },
      });
      expect(result.status).toBe(422);
      const error = result.body.error as { fields: { path: string }[] };
      expect(error.fields.some((f) => f.path === 'attributes.storage_gb')).toBe(true);
    });

    it('enforces the per-category VERIFIED SELLER requirement', async () => {
      // Cars is flagged requiresVerifiedSeller — a data flag, not a name check.
      const carBody = {
        categorySlug: 'cars',
        title: 'BMW 320d M Sport',
        description: 'A well maintained car with full service history and two keys.',
        priceMinor: '1200000',
        countryCode: 'GB',
        attributes: {
          make: 'BMW',
          model: '320d',
          year: 2018,
          mileage: 50_000,
          fuel_type: 'diesel',
          transmission: 'manual',
        },
      };

      const unverified = await callRoute(createListing, '/api/v1/listings', {
        method: 'POST',
        token: seller.accessToken,
        body: carBody,
      });
      expect(unverified.status).toBe(403);

      // The same seller, once verified, may list.
      const verifiedSeller = await createTestUser({
        roles: ['seller'],
        withSellerProfile: true,
        stepUp: true,
      });
      await prisma.sellerProfile.update({
        where: { id: verifiedSeller.sellerProfileId! },
        data: { verificationStatus: 'VERIFIED' },
      });

      const verified = await callRoute(createListing, '/api/v1/listings', {
        method: 'POST',
        token: verifiedSeller.accessToken,
        body: carBody,
      });
      expect(verified.status).toBe(201);
    });

    it('rejects an out-of-range value in a VERIFIED seller’s car listing', async () => {
      const verifiedSeller = await createTestUser({
        roles: ['seller'],
        withSellerProfile: true,
        stepUp: true,
      });
      await prisma.sellerProfile.update({
        where: { id: verifiedSeller.sellerProfileId! },
        data: { verificationStatus: 'VERIFIED' },
      });

      const result = await callRoute(createListing, '/api/v1/listings', {
        method: 'POST',
        token: verifiedSeller.accessToken,
        body: {
          categorySlug: 'cars',
          title: 'BMW 320d',
          description: 'A well maintained car with full service history.',
          priceMinor: '1200000',
          countryCode: 'GB',
          attributes: {
            make: 'BMW',
            model: '320d',
            year: 1700,
            mileage: 50_000,
            fuel_type: 'diesel',
            transmission: 'manual',
          },
        },
      });
      expect(result.status).toBe(422);
    });

    it('rejects an unknown category and an inactive country', async () => {
      expect(
        (
          await callRoute(createListing, '/api/v1/listings', {
            method: 'POST',
            token: seller.accessToken,
            body: { ...validPhone(), categorySlug: 'submarines' },
          })
        ).status,
      ).toBe(422);

      expect(
        (
          await callRoute(createListing, '/api/v1/listings', {
            method: 'POST',
            token: seller.accessToken,
            body: { ...validPhone(), countryCode: 'DE' },
          })
        ).status,
      ).toBe(422);
    });

    it('requires a price for a FIXED-price listing', async () => {
      const body = validPhone();
      delete (body as Record<string, unknown>).priceMinor;
      const result = await callRoute(createListing, '/api/v1/listings', {
        method: 'POST',
        token: seller.accessToken,
        body,
      });
      expect(result.status).toBe(422);
    });

    it('refuses a user with no seller profile', async () => {
      const buyer = await createTestUser({ roles: ['buyer'] });
      const result = await callRoute(createListing, '/api/v1/listings', {
        method: 'POST',
        token: buyer.accessToken,
        body: validPhone(),
      });
      // Buyers hold no listing:create permission at all.
      expect(result.status).toBe(403);
    });

    it('refuses an unauthenticated caller', async () => {
      const result = await callRoute(createListing, '/api/v1/listings', {
        method: 'POST',
        body: validPhone(),
      });
      expect(result.status).toBe(401);
    });

    it('accepts a Sorani listing and records its authored language', async () => {
      const result = await callRoute(createListing, '/api/v1/listings', {
        method: 'POST',
        token: seller.accessToken,
        body: {
          categorySlug: 'kurdish-clothing',
          title: 'کراس و ڕانکی کوردی',
          description: 'جل و بەرگی کوردی دەستکرد بە کوالیتی باش و نرخی گونجاو.',
          contentLocale: 'ckb',
          priceMinor: '12000',
          countryCode: 'GB',
          attributes: { garment_type: 'kras_u_rank' },
        },
      });
      expect(result.status).toBe(201);

      const listing = await prisma.listing.findUniqueOrThrow({
        where: { id: result.body.id as string },
        select: { contentLocale: true, slug: true },
      });
      // Authored language is recorded, not machine-translated away.
      expect(listing.contentLocale).toBe('ckb');
      // The Sorani title produced a real slug rather than an empty one.
      expect(listing.slug.length).toBeGreaterThan(8);
    });
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('will NOT publish a listing with no image', async () => {
      const listing = await createTestListing({ ownerSellerProfileId: seller.sellerProfileId! });
      const result = await callRoute(transition, `/api/v1/listings/${listing.id}/status`, {
        method: 'POST',
        token: seller.accessToken,
        params: { id: listing.id },
        body: { to: 'ACTIVE' },
      });
      expect(result.status).toBe(409);
    });

    it('publishes straight to ACTIVE when the category needs no approval', async () => {
      const listing = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        withReadyImage: true,
      });
      const result = await callRoute(transition, `/api/v1/listings/${listing.id}/status`, {
        method: 'POST',
        token: seller.accessToken,
        params: { id: listing.id },
        body: { to: 'ACTIVE' },
      });
      expect(result.status).toBe(200);
      expect(result.body.status).toBe('ACTIVE');
      expect(result.body.publishedAt).toBeTruthy();
    });

    it('routes to PENDING_REVIEW when the CATEGORY requires approval', async () => {
      // Cars is flagged requiresApproval — a data flag, not a name check.
      const listing = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        categorySlug: 'cars',
        withReadyImage: true,
      });
      const result = await callRoute(transition, `/api/v1/listings/${listing.id}/status`, {
        method: 'POST',
        token: seller.accessToken,
        params: { id: listing.id },
        body: { to: 'ACTIVE' },
      });
      expect(result.status).toBe(200);
      expect(result.body.status).toBe('PENDING_REVIEW');
    });

    it('does NOT let the owner approve their own listing', async () => {
      const listing = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        status: 'PENDING_REVIEW',
        withReadyImage: true,
      });
      const result = await callRoute(transition, `/api/v1/listings/${listing.id}/status`, {
        method: 'POST',
        token: seller.accessToken,
        params: { id: listing.id },
        body: { to: 'ACTIVE' },
      });
      expect(result.status).toBe(403);

      const after = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
      expect(after.status).toBe('PENDING_REVIEW');
    });

    it('lets a moderator approve', async () => {
      const listing = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        status: 'PENDING_REVIEW',
        withReadyImage: true,
      });
      const result = await callRoute(transition, `/api/v1/listings/${listing.id}/status`, {
        method: 'POST',
        token: moderator.accessToken,
        params: { id: listing.id },
        body: { to: 'ACTIVE' },
      });
      expect(result.status).toBe(200);
      expect(result.body.status).toBe('ACTIVE');
    });

    it('requires a REASON when a moderator rejects', async () => {
      const listing = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        status: 'PENDING_REVIEW',
      });

      const without = await callRoute(transition, `/api/v1/listings/${listing.id}/status`, {
        method: 'POST',
        token: moderator.accessToken,
        params: { id: listing.id },
        body: { to: 'REJECTED' },
      });
      expect(without.status).toBe(422);

      const withReason = await callRoute(transition, `/api/v1/listings/${listing.id}/status`, {
        method: 'POST',
        token: moderator.accessToken,
        params: { id: listing.id },
        body: { to: 'REJECTED', reason: 'Photos do not show the actual item.' },
      });
      expect(withReason.status).toBe(200);

      const after = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
      expect(after.rejectionReason).toContain('Photos');
    });

    it('refuses a transition the state machine does not permit', async () => {
      const listing = await createTestListing({ ownerSellerProfileId: seller.sellerProfileId! });
      const result = await callRoute(transition, `/api/v1/listings/${listing.id}/status`, {
        method: 'POST',
        token: seller.accessToken,
        params: { id: listing.id },
        body: { to: 'SOLD' },
      });
      expect(result.status).toBe(409);
    });

    it('will not edit a LIVE listing in place', async () => {
      const listing = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        status: 'ACTIVE',
        withReadyImage: true,
      });
      const result = await callRoute(patchListing, `/api/v1/listings/${listing.id}`, {
        method: 'PATCH',
        token: seller.accessToken,
        params: { id: listing.id },
        body: { title: 'Completely different item' },
      });
      expect(result.status).toBe(409);
    });

    it('edits a draft and re-validates attributes', async () => {
      const listing = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        attributes: { brand: 'Samsung', model: 'S21' },
      });

      const good = await callRoute(patchListing, `/api/v1/listings/${listing.id}`, {
        method: 'PATCH',
        token: seller.accessToken,
        params: { id: listing.id },
        body: {
          title: 'Samsung Galaxy S21 128GB',
          attributes: { brand: 'Samsung', model: 'S21', storage_gb: 128 },
        },
      });
      expect(good.status).toBe(200);

      const bad = await callRoute(patchListing, `/api/v1/listings/${listing.id}`, {
        method: 'PATCH',
        token: seller.accessToken,
        params: { id: listing.id },
        body: { attributes: { brand: 'Samsung', model: 'S21', mileage: 1000 } },
      });
      expect(bad.status).toBe(422);
    });

    it('soft-deletes rather than destroying the row', async () => {
      const listing = await createTestListing({ ownerSellerProfileId: seller.sellerProfileId! });
      const result = await callRoute(deleteListing, `/api/v1/listings/${listing.id}`, {
        method: 'DELETE',
        token: seller.accessToken,
        params: { id: listing.id },
      });
      expect(result.status).toBe(200);

      const row = await prisma.listing.findUnique({ where: { id: listing.id } });
      expect(row).not.toBeNull();
      expect(row?.deletedAt).not.toBeNull();
    });
  });

  // ── Visibility and IDOR ───────────────────────────────────────────────────

  describe('visibility', () => {
    it('serves an ACTIVE listing to anyone, with no token', async () => {
      const listing = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        status: 'ACTIVE',
        withReadyImage: true,
      });
      const result = await callRoute(getListing, `/api/v1/listings/${listing.id}`, {
        params: { id: listing.id },
      });
      expect(result.status).toBe(200);
      expect(result.body.viewerIsOwner).toBe(false);
    });

    it("404s another seller's DRAFT, leaking nothing", async () => {
      const listing = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        title: 'Secret Unpublished Item',
      });
      const result = await callRoute(getListing, `/api/v1/listings/${listing.id}`, {
        token: otherSeller.accessToken,
        params: { id: listing.id },
      });
      expect(result.status).toBe(404);
      expect(result.raw).not.toContain('Secret Unpublished Item');
    });

    it('gives the same 404 for a foreign draft as for a non-existent id', async () => {
      const listing = await createTestListing({ ownerSellerProfileId: seller.sellerProfileId! });
      const foreign = await callRoute(getListing, '/api/v1/listings/x', {
        token: otherSeller.accessToken,
        params: { id: listing.id },
      });
      const missing = await callRoute(getListing, '/api/v1/listings/x', {
        token: otherSeller.accessToken,
        params: { id: orphanId() },
      });
      expect(foreign.status).toBe(missing.status);
      expect((foreign.body.error as { message: string }).message).toBe(
        (missing.body.error as { message: string }).message,
      );
    });

    it('lets a moderator see an unpublished listing', async () => {
      const listing = await createTestListing({ ownerSellerProfileId: seller.sellerProfileId! });
      const result = await callRoute(getListing, `/api/v1/listings/${listing.id}`, {
        token: moderator.accessToken,
        params: { id: listing.id },
      });
      expect(result.status).toBe(200);
    });

    it('404s a malformed id instead of 500ing', async () => {
      for (const id of ['not-a-uuid', "' OR 1=1--", '../../etc/passwd']) {
        const result = await callRoute(getListing, '/api/v1/listings/x', { params: { id } });
        expect(result.status).toBe(404);
        expect(result.raw).not.toMatch(/prisma|stack|node_modules/i);
      }
    });
  });

  describe('IDOR against listings', () => {
    it("cannot edit another seller's listing", async () => {
      const listing = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        title: 'Original Title',
      });
      const result = await callRoute(patchListing, `/api/v1/listings/${listing.id}`, {
        method: 'PATCH',
        token: otherSeller.accessToken,
        params: { id: listing.id },
        body: { title: 'Hijacked' },
      });
      expect(result.status).toBe(404);

      const after = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
      expect(after.title).toBe('Original Title');
    });

    it("cannot transition another seller's listing", async () => {
      const listing = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        withReadyImage: true,
      });
      const result = await callRoute(transition, `/api/v1/listings/${listing.id}/status`, {
        method: 'POST',
        token: otherSeller.accessToken,
        params: { id: listing.id },
        body: { to: 'ACTIVE' },
      });
      expect(result.status).toBe(404);

      const after = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
      expect(after.status).toBe('DRAFT');
    });

    it("cannot delete another seller's listing", async () => {
      const listing = await createTestListing({ ownerSellerProfileId: seller.sellerProfileId! });
      const result = await callRoute(deleteListing, `/api/v1/listings/${listing.id}`, {
        method: 'DELETE',
        token: otherSeller.accessToken,
        params: { id: listing.id },
      });
      expect(result.status).toBe(404);

      const after = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
      expect(after.deletedAt).toBeNull();
    });

    it("cannot attach an image to another seller's listing", async () => {
      const listing = await createTestListing({ ownerSellerProfileId: seller.sellerProfileId! });
      const result = await callRoute(startUpload, `/api/v1/listings/${listing.id}/images`, {
        method: 'POST',
        token: otherSeller.accessToken,
        params: { id: listing.id },
        body: {},
      });
      expect(result.status).toBe(404);
    });

    it('cannot inject a different owner through the body', async () => {
      const result = await callRoute(createListing, '/api/v1/listings', {
        method: 'POST',
        token: seller.accessToken,
        body: {
          categorySlug: 'mobile-electronics',
          title: 'Ownership injection attempt',
          description: 'Trying to create this under another seller profile entirely.',
          priceMinor: '10000',
          countryCode: 'GB',
          attributes: { brand: 'X', model: 'Y' },
          sellerProfileId: otherSeller.sellerProfileId,
          ownerUserId: otherSeller.id,
        },
      });
      expect(result.status).toBe(201);

      const created = await prisma.listing.findUniqueOrThrow({
        where: { id: result.body.id as string },
        select: { sellerProfileId: true },
      });
      expect(created.sellerProfileId).toBe(seller.sellerProfileId);
    });
  });

  // ── Images ────────────────────────────────────────────────────────────────

  describe('image pipeline', () => {
    it('uploads, validates, re-encodes and marks READY', async () => {
      const listing = await createTestListing({ ownerSellerProfileId: seller.sellerProfileId! });
      const { finalised, imageId } = await uploadImage(seller, listing.id, await jpegBytes());

      expect(finalised?.status).toBe(200);
      const image = await prisma.listingImage.findUniqueOrThrow({ where: { id: imageId! } });
      expect(image.uploadStatus).toBe('READY');
      // Format recorded is the DETECTED one.
      expect(image.contentType).toBe('image/jpeg');
      expect(image.width).toBe(800);
      expect(Object.keys(image.variants as object).sort()).toEqual(['card', 'full', 'thumb']);
      expect(image.checksumSha256).toHaveLength(64);
    }, 60_000);

    it('REJECTS an SVG disguised as an upload', async () => {
      const listing = await createTestListing({ ownerSellerProfileId: seller.sellerProfileId! });
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      );
      const { finalised, imageId } = await uploadImage(seller, listing.id, svg);

      expect(finalised?.status).toBe(422);
      const image = await prisma.listingImage.findUniqueOrThrow({ where: { id: imageId! } });
      expect(image.uploadStatus).toBe('FAILED');
      expect(image.failureReason).toBe('unsupported_format');
      expect(image.url).toBe('');
    }, 60_000);

    it('rejects an HTML document named as an image', async () => {
      const listing = await createTestListing({ ownerSellerProfileId: seller.sellerProfileId! });
      const html = Buffer.from('<html><script>fetch("//evil")</script></html>');
      const { finalised } = await uploadImage(seller, listing.id, html);
      expect(finalised?.status).toBe(422);
    }, 60_000);

    it('does not let a forged upload ticket write anywhere', async () => {
      const forged = 'eyJzdG9yYWdlS2V5IjoiLi4vLi4vZXZpbCJ9.not-a-real-signature';
      const request = new Request(`http://localhost:3000/api/v1/uploads/${forged}`, {
        method: 'PUT',
        body: new Uint8Array(await jpegBytes(10, 10)),
      });
      const response = await receiveUpload(request, { params: Promise.resolve({ token: forged }) });
      expect(response.status).toBe(401);
    });

    it('cannot finalise an image id belonging to another listing', async () => {
      const mine = await createTestListing({ ownerSellerProfileId: seller.sellerProfileId! });
      const theirs = await createTestListing({ ownerSellerProfileId: seller.sellerProfileId! });
      const { imageId } = await uploadImage(seller, theirs.id, await jpegBytes(100, 100));

      const result = await callRoute(
        finaliseImage,
        `/api/v1/listings/${mine.id}/images/${imageId}`,
        {
          method: 'POST',
          token: seller.accessToken,
          params: { id: mine.id, imageId: imageId! },
          body: {},
        },
      );
      expect(result.status).toBe(404);
    }, 60_000);

    it('promotes another image to primary when the primary is deleted', async () => {
      const listing = await createTestListing({ ownerSellerProfileId: seller.sellerProfileId! });
      const first = await uploadImage(seller, listing.id, await jpegBytes(200, 200));
      const second = await uploadImage(seller, listing.id, await jpegBytes(220, 220));
      expect(second.finalised?.status).toBe(200);

      await callRoute(deleteImage, `/api/v1/listings/${listing.id}/images/${first.imageId}`, {
        method: 'DELETE',
        token: seller.accessToken,
        params: { id: listing.id, imageId: first.imageId! },
      });

      const remaining = await prisma.listingImage.findUniqueOrThrow({
        where: { id: second.imageId! },
      });
      expect(remaining.isPrimary).toBe(true);
    }, 60_000);

    it('honours isPrimary on finalise, moving the flag off the incumbent', async () => {
      // Regression: `isPrimary` was accepted by the schema and documented in
      // openapi.yaml, but the finalise route never applied it — the field was
      // silently dropped. Found by exercising the live API, not by a test,
      // which is why this test exists now.
      const listing = await createTestListing({ ownerSellerProfileId: seller.sellerProfileId! });

      const first = await uploadImage(seller, listing.id, await jpegBytes(200, 200));
      expect(first.finalised?.status).toBe(200);
      // The first image becomes primary automatically.
      expect((first.finalised?.body.image as { isPrimary: boolean }).isPrimary).toBe(true);

      const second = await uploadImage(seller, listing.id, await jpegBytes(220, 220), {
        isPrimary: true,
      });
      expect(second.finalised?.status).toBe(200);
      expect((second.finalised?.body.image as { isPrimary: boolean }).isPrimary).toBe(true);

      // Exactly one primary survives: the partial unique index would reject two,
      // so a promotion that failed to demote would have thrown instead.
      const rows = await prisma.listingImage.findMany({
        where: { listingId: listing.id },
        select: { id: true, isPrimary: true },
      });
      expect(rows.filter((row) => row.isPrimary).map((row) => row.id)).toEqual([second.imageId]);
    }, 60_000);

    it('refuses to demote the only primary, rather than leaving none', async () => {
      const listing = await createTestListing({ ownerSellerProfileId: seller.sellerProfileId! });
      const only = await uploadImage(seller, listing.id, await jpegBytes(200, 200), {
        isPrimary: false,
      });

      // A listing with images must have a primary to show in the grid, so the
      // demotion is ignored when there is nothing to promote in its place.
      expect((only.finalised?.body.image as { isPrimary: boolean }).isPrimary).toBe(true);
    }, 60_000);

    it('enforces the per-category image cap', async () => {
      const listing = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        categorySlug: 'kurdish-clothing',
      });
      const category = await prisma.category.findUniqueOrThrow({
        where: { slug: 'kurdish-clothing' },
      });

      for (let i = 0; i < category.maxImages; i += 1) {
        await prisma.listingImage.create({
          data: { listingId: listing.id, storageKey: `k-${i}`, position: i, uploadStatus: 'READY' },
        });
      }

      const result = await callRoute(startUpload, `/api/v1/listings/${listing.id}/images`, {
        method: 'POST',
        token: seller.accessToken,
        params: { id: listing.id },
        body: {},
      });
      expect(result.status).toBe(409);
    }, 60_000);
  });

  // ── Search ────────────────────────────────────────────────────────────────

  describe('search and filter', () => {
    beforeAll(async () => {
      const cars = await prisma.category.findUniqueOrThrow({ where: { slug: 'cars' } });
      const country = await prisma.country.findUniqueOrThrow({ where: { code: 'GB' } });
      const london = await prisma.city.findFirstOrThrow({ where: { slug: 'london' } });

      const fixtures = [
        {
          title: 'BMW 320d M Sport Diesel',
          price: 1_200_000n,
          attrs: { make: 'BMW', model: '320d', year: 2018, mileage: 45000, fuel_type: 'diesel' },
        },
        {
          title: 'Audi A4 TDI Estate',
          price: 950_000n,
          attrs: { make: 'Audi', model: 'A4', year: 2016, mileage: 82000, fuel_type: 'diesel' },
        },
        {
          title: 'Nissan Leaf Electric',
          price: 890_000n,
          attrs: {
            make: 'Nissan',
            model: 'Leaf',
            year: 2020,
            mileage: 21000,
            fuel_type: 'electric',
          },
        },
      ];

      for (const fixture of fixtures) {
        const listing = await prisma.listing.create({
          data: {
            sellerProfileId: seller.sellerProfileId!,
            categoryId: cars.id,
            title: fixture.title,
            slug: `search-${fixture.title.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}`,
            description: `${fixture.title} in very good condition, full service history.`,
            priceMinor: fixture.price,
            currency: 'GBP',
            countryId: country.id,
            cityId: london.id,
            status: 'ACTIVE',
            publishedAt: new Date(),
            attributes: fixture.attrs as never,
          },
        });
        await prisma.listingImage.create({
          data: {
            listingId: listing.id,
            storageKey: `s/${listing.id}`,
            url: 'http://localhost/media/x-card.webp',
            uploadStatus: 'READY',
            moderationStatus: 'APPROVED',
            isPrimary: true,
          },
        });
      }
    }, 60_000);

    it('finds listings by free text', async () => {
      const result = await callRoute(listSearch, '/api/v1/listings', {
        searchParams: { q: 'BMW' },
      });
      expect(result.status).toBe(200);
      const items = result.body.data as Array<{ title: string }>;
      expect(items.some((i) => i.title.includes('BMW'))).toBe(true);
    });

    it('matches text in the DESCRIPTION as well as the title', async () => {
      const result = await callRoute(listSearch, '/api/v1/listings', {
        searchParams: { q: 'service history' },
      });
      expect((result.body.data as unknown[]).length).toBeGreaterThan(0);
    });

    it('filters by a category-specific attribute', async () => {
      const result = await callRoute(listSearch, '/api/v1/listings', {
        searchParams: { category: '/cars/', 'attr.fuel_type': 'electric' },
      });
      const items = result.body.data as Array<{ title: string }>;
      expect(items).toHaveLength(1);
      expect(items[0]?.title).toContain('Leaf');
    });

    it('supports a multi-value attribute filter', async () => {
      const url = new URL('http://localhost/api/v1/listings');
      url.searchParams.set('category', '/cars/');
      url.searchParams.append('attr.fuel_type', 'diesel');
      url.searchParams.append('attr.fuel_type', 'electric');
      const request = new Request(url, { headers: { 'x-forwarded-for': '10.1.2.3' } });
      const response = await listSearch(request);
      const body = (await response.json()) as { data: unknown[] };
      expect(body.data.length).toBe(3);
    });

    it('supports a numeric RANGE filter on an attribute', async () => {
      const url = new URL('http://localhost/api/v1/listings');
      url.searchParams.set('category', '/cars/');
      url.searchParams.append('attr.mileage', 'max:50000');
      const response = await listSearch(
        new Request(url, { headers: { 'x-forwarded-for': '10.1.2.4' } }),
      );
      const body = (await response.json()) as { data: { title: string }[] };
      // BMW 45,000 and Leaf 21,000 qualify; Audi at 82,000 does not.
      expect(body.data).toHaveLength(2);
    });

    it('filters by price range', async () => {
      const result = await callRoute(listSearch, '/api/v1/listings', {
        searchParams: { category: '/cars/', minPrice: '900000', maxPrice: '1000000' },
      });
      const items = result.body.data as Array<{ title: string }>;
      expect(items).toHaveLength(1);
      expect(items[0]?.title).toContain('Audi');
    });

    it('sorts by price', async () => {
      const asc = await callRoute(listSearch, '/api/v1/listings', {
        searchParams: { category: '/cars/', sort: 'price_asc' },
      });
      const prices = (asc.body.data as Array<{ priceMinor: string }>).map((i) =>
        BigInt(i.priceMinor),
      );
      expect(prices).toEqual([...prices].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    });

    it('never returns an unpublished listing', async () => {
      const draft = await createTestListing({
        ownerSellerProfileId: seller.sellerProfileId!,
        categorySlug: 'cars',
        title: 'Hidden Draft Ferrari',
      });
      const result = await callRoute(listSearch, '/api/v1/listings', {
        searchParams: { q: 'Ferrari' },
      });
      const ids = (result.body.data as Array<{ id: string }>).map((i) => i.id);
      expect(ids).not.toContain(draft.id);
    });

    it('returns facet counts for the filter panel', async () => {
      const result = await callRoute(listSearch, '/api/v1/listings', {
        searchParams: { category: '/cars/', facets: 'true' },
      });
      const facets = result.body.facets as {
        categories: { value: string; count: number }[];
        attributes: Record<string, { value: string; count: number }[]>;
      };
      expect(facets.categories.some((f) => f.value === 'cars')).toBe(true);
      expect(facets.attributes.fuel_type?.some((f) => f.value === 'diesel')).toBe(true);
    });

    it('paginates with a cursor rather than an offset', async () => {
      const first = await callRoute(listSearch, '/api/v1/listings', {
        searchParams: { category: '/cars/', limit: '2', sort: 'newest' },
      });
      expect((first.body.data as unknown[]).length).toBe(2);
      expect((first.body.page as { hasMore: boolean }).hasMore).toBe(true);

      const cursor = (first.body.page as { nextCursor: string }).nextCursor;
      const second = await callRoute(listSearch, '/api/v1/listings', {
        searchParams: { category: '/cars/', limit: '2', sort: 'newest', cursor },
      });

      const firstIds = (first.body.data as Array<{ id: string }>).map((i) => i.id);
      const secondIds = (second.body.data as Array<{ id: string }>).map((i) => i.id);
      // No overlap between pages.
      expect(secondIds.filter((id) => firstIds.includes(id))).toEqual([]);
    });

    it('does not execute injected SQL in the query string', async () => {
      const result = await callRoute(listSearch, '/api/v1/listings', {
        searchParams: {
          q: "'; DROP TABLE listings; --",
          category: "/cars/'; DELETE FROM listings; --",
        },
      });
      expect(result.status).toBe(200);
      // The table is still there.
      expect(await prisma.listing.count()).toBeGreaterThan(0);
    });
  });
});
