'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { validateAttributes } from '@/domain/catalogue/attributes';
import { canTransition, publishTarget, isEditable } from '@/domain/catalogue/listing-status';
import { loadAttributeDefinitions, loadCategoryBySlug } from '@/infra/catalogue/category-service';
import {
  buildListingSlug,
  loadListingForOwner,
  writeAttributes,
} from '@/infra/catalogue/listing-service';
import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import {
  decidePublication,
  recordScreening,
  screenContent,
} from '@/infra/safety/listing-screening';
import { requireActionAccess } from '@/lib/auth/action-guard';
import type { ActionState } from './action-state';

/**
 * Seller dashboard actions.
 *
 * Every one of these follows the same shape, and the order matters:
 *
 *   guard → load the resource → verify OWNERSHIP → act
 *
 * The listing id arrives in a form field, which makes it a claim and not a
 * fact. It is only ever used to LOOK UP a row; the decision to act is made by
 * comparing that row's owner against the user id from the session token. A
 * seller who edits the hidden field gets the same answer as someone using a
 * made-up id: `not_found`. Never 403 — that would confirm the listing exists
 * and turn the dashboard into an id oracle, exactly as the API rule says.
 */

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Loads a listing and proves the caller owns it.
 *
 * Returns `null` for "no such listing" AND for "someone else's listing", so
 * the two are indistinguishable to the caller.
 */
async function loadOwnedListing(listingId: string, userId: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(listingId)
  ) {
    // An unparseable id makes Postgres raise; it cannot name a resource anyway.
    return null;
  }
  const listing = await loadListingForOwner(listingId);
  if (listing === null) return null;
  if (listing.ownerUserId !== userId) return null;
  return listing;
}

/** Reads `attr.<key>` fields into the shape the validator expects. */
function attributesFrom(form: FormData): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (!key.startsWith('attr.')) continue;
    const name = key.slice(5);
    if (typeof value !== 'string' || value.trim() === '') continue;
    attributes[name] = value.trim();
  }
  return attributes;
}

export async function createListingAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireActionAccess(form, { all: ['listing:create'] });
  if (!guard.ok) return { error: guard.error };

  const locale = field(form, 'locale') || 'en';

  const sellerProfile = await prisma.sellerProfile.findUnique({
    where: { userId: guard.principal.userId },
    select: { id: true, verificationStatus: true, deletedAt: true },
  });
  if (!sellerProfile || sellerProfile.deletedAt !== null) {
    return { error: 'forbidden' };
  }

  const category = await loadCategoryBySlug(field(form, 'categorySlug'));
  if (!category || !category.isActive) {
    return { error: 'validation', fieldErrors: { categorySlug: 'unknown_category' } };
  }

  // A per-category FLAG, never a check against a category name.
  if (category.requiresVerifiedSeller && sellerProfile.verificationStatus !== 'VERIFIED') {
    return { error: 'forbidden' };
  }

  const country = await prisma.country.findUnique({
    where: { code: field(form, 'countryCode').toUpperCase() || 'GB' },
    select: { id: true, isActive: true },
  });
  if (!country || !country.isActive) {
    return { error: 'validation', fieldErrors: { countryCode: 'unsupported_country' } };
  }

  const definitions = await loadAttributeDefinitions(category);
  const validated = validateAttributes(definitions, attributesFrom(form));
  if (!validated.ok) {
    return {
      error: 'validation',
      fieldErrors: Object.fromEntries(validated.issues.map((i) => [`attr.${i.key}`, i.code])),
    };
  }

  const title = field(form, 'title');
  const description = field(form, 'description');
  if (title.length < 3 || title.length > 140) {
    return { error: 'validation', fieldErrors: { title: 'length' } };
  }
  if (description.length < 10 || description.length > 10_000) {
    return { error: 'validation', fieldErrors: { description: 'length' } };
  }

  const priceRaw = field(form, 'priceMinor');
  const priceType = field(form, 'priceType') || 'FIXED';
  if (priceRaw !== '' && !/^\d{1,18}$/.test(priceRaw)) {
    return { error: 'validation', fieldErrors: { priceMinor: 'not_an_integer' } };
  }
  const priceMinor = priceRaw === '' ? null : BigInt(priceRaw);
  if (priceType === 'FIXED' && priceMinor === null) {
    return { error: 'validation', fieldErrors: { priceMinor: 'required_for_fixed_price' } };
  }
  if (
    category.minPriceMinor !== null &&
    priceMinor !== null &&
    priceMinor < category.minPriceMinor
  ) {
    return { error: 'validation', fieldErrors: { priceMinor: 'below_category_minimum' } };
  }

  /*
   * Screened BEFORE the row exists. A DRAFT is not public, so this is not
   * strictly required for safety — but storing content we would refuse to
   * publish serves nobody, and telling the seller now rather than at publish
   * is the honest moment to do it.
   */
  const screening = await screenContent({
    title,
    description,
    categoryId: category.id,
    countryId: country.id,
  });
  if (screening.outcome === 'BLOCK') {
    return { error: 'validation', fieldErrors: { title: 'prohibited_content' } };
  }

  const created = await prisma.$transaction(async (tx) => {
    const listing = await tx.listing.create({
      data: {
        sellerProfileId: sellerProfile.id,
        categoryId: category.id,
        title,
        slug: buildListingSlug(title, category.slug),
        description,
        contentLocale: field(form, 'contentLocale') || locale,
        priceMinor,
        currency: (field(form, 'currency') || 'GBP').toUpperCase(),
        priceType: priceType as never,
        countryId: country.id,
        condition: (field(form, 'condition') || 'NOT_APPLICABLE') as never,
        quantity: 1,
        status: 'DRAFT',
      },
      select: { id: true },
    });
    await writeAttributes(tx, {
      listingId: listing.id,
      rows: validated.rows,
      json: validated.json,
    });
    return listing;
  });

  await tryWriteAuditLog(prisma, {
    action: 'listing.created',
    actorType: 'user',
    actorId: guard.principal.userId,
    entityType: 'listing',
    entityId: created.id,
    after: { categorySlug: category.slug, via: 'dashboard' },
  });

  redirect(`/${locale}/dashboard/listings/${created.id}`);
}

export async function updateListingAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireActionAccess(form, { all: ['listing:update_own'] });
  if (!guard.ok) return { error: guard.error };

  const listing = await loadOwnedListing(field(form, 'listingId'), guard.principal.userId);
  if (listing === null) return { error: 'not_found' };

  if (!isEditable(listing.status)) {
    // A live listing must be paused first: a buyer should never see the terms
    // change under them mid-view.
    return { error: 'conflict' };
  }

  const category = await loadCategoryBySlug(listing.category.slug);
  if (!category) return { error: 'conflict' };

  const definitions = await loadAttributeDefinitions(category);
  const validated = validateAttributes(definitions, attributesFrom(form));
  if (!validated.ok) {
    return {
      error: 'validation',
      fieldErrors: Object.fromEntries(validated.issues.map((i) => [`attr.${i.key}`, i.code])),
    };
  }

  const title = field(form, 'title');
  const description = field(form, 'description');
  if (title.length < 3 || title.length > 140) {
    return { error: 'validation', fieldErrors: { title: 'length' } };
  }
  if (description.length < 10 || description.length > 10_000) {
    return { error: 'validation', fieldErrors: { description: 'length' } };
  }

  const priceRaw = field(form, 'priceMinor');
  if (priceRaw !== '' && !/^\d{1,18}$/.test(priceRaw)) {
    return { error: 'validation', fieldErrors: { priceMinor: 'not_an_integer' } };
  }

  await prisma.$transaction(async (tx) => {
    await tx.listing.update({
      where: { id: listing.id },
      data: {
        title,
        description,
        ...(priceRaw === '' ? {} : { priceMinor: BigInt(priceRaw) }),
        ...(field(form, 'priceType') ? { priceType: field(form, 'priceType') as never } : {}),
        ...(field(form, 'condition') ? { condition: field(form, 'condition') as never } : {}),
      },
    });
    await writeAttributes(tx, {
      listingId: listing.id,
      rows: validated.rows,
      json: validated.json,
    });
  });

  await tryWriteAuditLog(prisma, {
    action: 'listing.updated',
    actorType: 'user',
    actorId: guard.principal.userId,
    entityType: 'listing',
    entityId: listing.id,
    after: { via: 'dashboard' },
  });

  revalidatePath(`/${field(form, 'locale') || 'en'}/dashboard/listings/${listing.id}`);
  return { error: null, ok: true };
}

export async function transitionListingAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  // Publishing and moderating are different permissions; the dashboard only
  // ever exercises the owner's half.
  const guard = await requireActionAccess(form, { any: ['listing:publish', 'listing:update_own'] });
  if (!guard.ok) return { error: guard.error };

  const listing = await loadOwnedListing(field(form, 'listingId'), guard.principal.userId);
  if (listing === null) return { error: 'not_found' };

  const requested = field(form, 'to');
  let target =
    requested === 'PUBLISH' ? publishTarget(listing.category.requiresApproval) : requested;

  const decision = canTransition(listing.status as never, target as never, 'owner');
  if (!decision.allowed) return { error: 'conflict' };

  if (target === 'ACTIVE' || target === 'PENDING_REVIEW') {
    const images = await prisma.listingImage.count({
      where: { listingId: listing.id, uploadStatus: 'READY' },
    });
    if (images === 0) return { error: 'validation', fieldErrors: { images: 'required' } };

    /*
     * Screened from the STORED text, at the moment of publication.
     *
     * Not from the form, and not only at creation: a seller can write a clean
     * draft, have it pass, then edit it to something prohibited and publish.
     * The text that matters is the text that is about to become public.
     *
     * The decision can also OVERRIDE the requested target — a listing in a
     * category that needs no approval still goes to PENDING_REVIEW when
     * screening found something worth a human looking at.
     */
    const publication = await decidePublication(listing.id);
    if (publication === null) return { error: 'not_found' };

    if (!publication.ok) {
      await recordScreening({
        listingId: listing.id,
        screening: publication.screening,
        outcome: 'blocked',
      });
      return { error: 'validation', fieldErrors: { title: 'prohibited_content' } };
    }

    if (publication.status === 'PENDING_REVIEW') {
      target = 'PENDING_REVIEW';
      await recordScreening({
        listingId: listing.id,
        screening: publication.screening,
        outcome: 'sent_for_review',
      });
    }
  }

  const now = new Date();
  await prisma.listing.update({
    where: { id: listing.id },
    data: {
      status: target as never,
      ...(target === 'ACTIVE'
        ? {
            publishedAt: listing.publishedAt ?? now,
            expiresAt: new Date(
              now.getTime() + listing.category.listingDurationDays * 24 * 60 * 60 * 1000,
            ),
          }
        : {}),
      ...(target === 'SOLD' ? { soldAt: now } : {}),
    },
  });

  await tryWriteAuditLog(prisma, {
    action: 'listing.transitioned',
    actorType: 'user',
    actorId: guard.principal.userId,
    entityType: 'listing',
    entityId: listing.id,
    before: { status: listing.status },
    after: { status: target, via: 'dashboard' },
  });

  revalidatePath(`/${field(form, 'locale') || 'en'}/dashboard/listings/${listing.id}`);
  revalidatePath(`/${field(form, 'locale') || 'en'}/dashboard/listings`);
  return { error: null, ok: true };
}

export async function deleteListingImageAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireActionAccess(form, { all: ['listing:update_own'] });
  if (!guard.ok) return { error: guard.error };

  const listing = await loadOwnedListing(field(form, 'listingId'), guard.principal.userId);
  if (listing === null) return { error: 'not_found' };

  const imageId = field(form, 'imageId');
  // Scoped by listing as well as image: an image id belonging to another
  // listing cannot be deleted through this one.
  const image = await prisma.listingImage.findFirst({
    where: { id: imageId, listingId: listing.id },
    select: { id: true, isPrimary: true },
  });
  if (!image) return { error: 'not_found' };

  await prisma.$transaction(async (tx) => {
    await tx.listingImage.delete({ where: { id: image.id } });
    if (image.isPrimary) {
      const next = await tx.listingImage.findFirst({
        where: { listingId: listing.id, uploadStatus: 'READY' },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      if (next) await tx.listingImage.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
  });

  await tryWriteAuditLog(prisma, {
    action: 'listing.image_deleted',
    actorType: 'user',
    actorId: guard.principal.userId,
    entityType: 'listing_image',
    entityId: image.id,
    after: { via: 'dashboard' },
  });

  revalidatePath(`/${field(form, 'locale') || 'en'}/dashboard/listings/${listing.id}`);
  return { error: null, ok: true };
}

export async function updateSellerProfileAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireActionAccess(form, { all: ['seller:update_own_profile'] });
  if (!guard.ok) return { error: guard.error };

  const displayName = field(form, 'displayName');
  if (displayName.length < 2 || displayName.length > 120) {
    return { error: 'validation', fieldErrors: { displayName: 'length' } };
  }

  // Scoped by userId from the TOKEN, so there is no profile id to tamper with.
  const updated = await prisma.sellerProfile.updateMany({
    where: { userId: guard.principal.userId, deletedAt: null },
    data: { displayName, about: field(form, 'about') || null },
  });
  if (updated.count === 0) return { error: 'not_found' };

  await tryWriteAuditLog(prisma, {
    action: 'seller_profile.updated',
    actorType: 'user',
    actorId: guard.principal.userId,
    entityType: 'seller_profile',
    entityId: null,
    after: { via: 'dashboard' },
  });

  revalidatePath(`/${field(form, 'locale') || 'en'}/dashboard/profile`);
  return { error: null, ok: true };
}
