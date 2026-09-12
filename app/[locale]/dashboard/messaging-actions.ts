'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/infra/db/client';
import { tryWriteAuditLog } from '@/infra/audit/audit-log';
import {
  appendMessage,
  loadConversationForViewer,
  markConversationRead,
} from '@/infra/messaging/conversation-service';
import {
  OfferConflictError,
  createOffer,
  loadOfferForParty,
  resolveActor,
  transitionOffer,
} from '@/infra/messaging/offer-service';
import { OFFER_STATUSES, type OfferStatus } from '@/domain/offers/offer-status';
import { majorToMinor } from '@/domain/offers/offer-amount';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';
import { consumeRateLimit } from '@/infra/redis/rate-limit';
import { getRedis } from '@/infra/redis/client';
import { requireActionAccess } from '@/lib/auth/action-guard';
import { isUuid } from '@/lib/api/guards';
import type { MessagingActionState } from './messaging-action-state';

/**
 * Messaging and offer actions.
 *
 * A Server Action is a public POST endpoint with a generated URL. Nothing here
 * is protected by being "internal", so every action repeats the whole check in
 * the same order the API routes use:
 *
 *   guard (session, account status, CSRF, permission)
 *     → load the resource SCOPED BY the session's user id
 *       → act
 *
 * Ids arrive in hidden form fields, which makes them claims, not facts. They
 * are only ever lookup keys: `loadConversationForViewer` and
 * `loadOfferForParty` put the caller's id INTO the query, so a forged id
 * returns null and the caller gets `not_found` — never `forbidden`, which
 * would confirm the row exists and turn the dashboard into an id oracle.
 *
 * The rate limits are the same ones the API enforces, keyed on the account.
 * Actions are a second front door to the same operations; leaving them
 * unlimited would make the API's limits decorative.
 */

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function localeOf(form: FormData): string {
  const locale = field(form, 'locale');
  return locale === '' ? 'en' : locale;
}

/** Applies an account-keyed limit, matching what the API route would apply. */
async function limitBySubject(
  rule: (typeof RATE_LIMITS)[keyof typeof RATE_LIMITS],
  userId: string,
): Promise<boolean> {
  const result = await consumeRateLimit(getRedis(), rule, `subject:${userId}`);
  return result.allowed;
}

export async function startConversationAction(
  _previous: MessagingActionState,
  form: FormData,
): Promise<MessagingActionState> {
  const guard = await requireActionAccess(form, { all: ['message:send'] });
  if (!guard.ok) return { error: guard.error };

  const userId = guard.principal.userId;
  if (!(await limitBySubject(RATE_LIMITS.startConversation, userId))) {
    return { error: 'conflict', reason: 'rate_limited' };
  }

  const listingId = field(form, 'listingId');
  if (!isUuid(listingId)) return { error: 'not_found' };

  const listing = await prisma.listing.findFirst({
    where: { id: listingId, status: 'ACTIVE', deletedAt: null },
    select: { id: true, sellerProfile: { select: { userId: true } } },
  });
  // A draft or paused listing answers exactly as a missing one does.
  if (listing === null) return { error: 'not_found' };

  const sellerId = listing.sellerProfile.userId;
  // The seller is read from the LISTING. No form field names a participant,
  // so neither party can be injected.
  if (sellerId === userId) return { error: 'conflict', reason: 'own_listing' };

  const conversation = await prisma.conversation.upsert({
    where: { listingId_buyerId_sellerId: { listingId: listing.id, buyerId: userId, sellerId } },
    create: { listingId: listing.id, buyerId: userId, sellerId, status: 'OPEN' },
    update: {},
    select: { id: true },
  });

  const sent = await appendMessage({
    conversationId: conversation.id,
    senderId: userId,
    rawBody: field(form, 'body'),
  });
  if (!sent.ok) return { error: 'validation', reason: sent.issue };

  await tryWriteAuditLog(prisma, {
    action: 'conversation.started',
    actorType: 'user',
    actorId: userId,
    entityType: 'conversation',
    entityId: conversation.id,
    after: { listingId: listing.id, flagged: sent.flagged },
    ip: null,
    userAgent: null,
    correlationId: null,
  });

  redirect(`/${localeOf(form)}/dashboard/messages/${conversation.id}`);
}

export async function sendMessageAction(
  _previous: MessagingActionState,
  form: FormData,
): Promise<MessagingActionState> {
  const guard = await requireActionAccess(form, { all: ['message:send'] });
  if (!guard.ok) return { error: guard.error };

  const userId = guard.principal.userId;
  if (!(await limitBySubject(RATE_LIMITS.sendMessage, userId))) {
    return { error: 'conflict', reason: 'rate_limited' };
  }

  const conversationId = field(form, 'conversationId');
  if (!isUuid(conversationId)) return { error: 'not_found' };

  // Participation is the query. A non-participant gets null here.
  const conversation = await loadConversationForViewer(conversationId, userId);
  if (conversation === null) return { error: 'not_found' };

  const sent = await appendMessage({
    conversationId: conversation.id,
    senderId: userId,
    rawBody: field(form, 'body'),
  });
  if (!sent.ok) return { error: 'validation', reason: sent.issue };

  revalidatePath(`/${localeOf(form)}/dashboard/messages/${conversation.id}`);
  return { error: null, ok: true };
}

export async function markReadAction(
  _previous: MessagingActionState,
  form: FormData,
): Promise<MessagingActionState> {
  const guard = await requireActionAccess(form, { all: ['message:read_own'] });
  if (!guard.ok) return { error: guard.error };

  const conversationId = field(form, 'conversationId');
  if (!isUuid(conversationId)) return { error: 'not_found' };

  const conversation = await loadConversationForViewer(conversationId, guard.principal.userId);
  if (conversation === null) return { error: 'not_found' };

  await markConversationRead(conversation.id, guard.principal.userId);
  revalidatePath(`/${localeOf(form)}/dashboard/messages`);
  return { error: null, ok: true };
}

const REPORT_REASONS = [
  'spam',
  'scam',
  'harassment',
  'off_platform_payment',
  'illegal_goods',
  'other',
] as const;

export async function reportConversationAction(
  _previous: MessagingActionState,
  form: FormData,
): Promise<MessagingActionState> {
  const guard = await requireActionAccess(form, { all: ['report:create'] });
  if (!guard.ok) return { error: guard.error };

  const userId = guard.principal.userId;
  const conversationId = field(form, 'conversationId');
  if (!isUuid(conversationId)) return { error: 'not_found' };

  // Participants only — otherwise reporting becomes a probe for which
  // conversation ids exist.
  const conversation = await loadConversationForViewer(conversationId, userId);
  if (conversation === null) return { error: 'not_found' };

  const reasonCode = field(form, 'reasonCode');
  if (!REPORT_REASONS.includes(reasonCode as never)) {
    return { error: 'validation', reason: 'reason_required' };
  }

  const details = field(form, 'details').slice(0, 2000);

  await prisma.$transaction(async (tx) => {
    await tx.report.create({
      data: {
        reporterId: userId,
        targetType: 'CONVERSATION',
        targetId: conversation.id,
        reasonCode,
        details: details === '' ? null : details,
        status: 'OPEN',
      },
    });
    // Marked for review. The MESSAGES are untouched: evidence that vanishes
    // when reported is useless to the reviewer it was raised for.
    await tx.conversation.update({
      where: { id: conversation.id },
      data: { status: 'REPORTED' },
    });
  });

  await tryWriteAuditLog(prisma, {
    action: 'conversation.reported',
    actorType: 'user',
    actorId: userId,
    entityType: 'conversation',
    entityId: conversation.id,
    after: { reasonCode },
    ip: null,
    userAgent: null,
    correlationId: null,
  });

  revalidatePath(`/${localeOf(form)}/dashboard/messages/${conversation.id}`);
  return { error: null, ok: true };
}

export async function createOfferAction(
  _previous: MessagingActionState,
  form: FormData,
): Promise<MessagingActionState> {
  const guard = await requireActionAccess(form, { all: ['offer:create'] });
  if (!guard.ok) return { error: guard.error };

  const userId = guard.principal.userId;
  if (!(await limitBySubject(RATE_LIMITS.createOffer, userId))) {
    return { error: 'conflict', reason: 'rate_limited' };
  }

  const listingId = field(form, 'listingId');
  if (!isUuid(listingId)) return { error: 'not_found' };

  /*
   * The form collects MAJOR units because that is what a person types.
   * `majorToMinor` converts with string operations only — see ADR-0006 for
   * why `* 100` is not an option.
   */
  const amountMinor = majorToMinor(field(form, 'amount'));
  if (amountMinor === null) return { error: 'validation', reason: 'not_an_integer' };

  const conversationId = field(form, 'conversationId');
  let thread: string | null = null;
  if (conversationId !== '') {
    if (!isUuid(conversationId)) return { error: 'not_found' };
    // Prove participation before attaching, or an offer could be posted into
    // someone else's thread.
    const conversation = await loadConversationForViewer(conversationId, userId);
    if (conversation === null) return { error: 'not_found' };
    thread = conversation.id;
  }

  const created = await createOffer({
    listingId,
    buyerId: userId,
    amountMinor,
    currency: field(form, 'currency') || 'GBP',
    message: field(form, 'message') || undefined,
    conversationId: thread,
  });

  if (!created.ok) {
    if (created.issue === 'listing_not_found') return { error: 'not_found' };
    if (created.issue === 'own_listing' || created.issue === 'offer_already_open') {
      return { error: 'conflict', reason: created.issue };
    }
    return { error: 'validation', reason: created.issue };
  }

  if (thread !== null && created.status === 'SUBMITTED') {
    await appendMessage({
      conversationId: thread,
      senderId: userId,
      rawBody: field(form, 'message') || 'Made an offer.',
    });
  }

  await tryWriteAuditLog(prisma, {
    action: 'offer.created',
    actorType: 'user',
    actorId: userId,
    entityType: 'offer',
    entityId: created.offerId,
    after: { listingId, status: created.status },
    ip: null,
    userAgent: null,
    correlationId: null,
  });

  redirect(`/${localeOf(form)}/dashboard/offers/${created.offerId}`);
}

export async function transitionOfferAction(
  _previous: MessagingActionState,
  form: FormData,
): Promise<MessagingActionState> {
  // Either half of the offer permissions gets you here; the transition table
  // decides what you can actually do.
  const guard = await requireActionAccess(form, { any: ['offer:create', 'offer:respond'] });
  if (!guard.ok) return { error: guard.error };

  const userId = guard.principal.userId;
  const offerId = field(form, 'offerId');
  if (!isUuid(offerId)) return { error: 'not_found' };

  const offer = await loadOfferForParty(offerId, userId);
  if (offer === null) return { error: 'not_found' };

  // Role comes from the database rows, never from the form.
  const actor = resolveActor(offer, userId);
  if (actor === null) return { error: 'not_found' };

  const to = field(form, 'to');
  if (!OFFER_STATUSES.includes(to as never)) return { error: 'validation', reason: 'unknown_to' };

  let result;
  try {
    result = await transitionOffer({
      offer,
      actor,
      actorId: userId,
      to: to as OfferStatus,
      note: field(form, 'note') || undefined,
    });
  } catch (error) {
    // Someone else moved the offer between the read and the write.
    if (error instanceof OfferConflictError) return { error: 'conflict', reason: 'changed' };
    throw error;
  }

  if (!result.ok) return { error: 'conflict', reason: result.issue };

  if (offer.conversationId !== null) {
    await appendMessage({
      conversationId: offer.conversationId,
      senderId: userId,
      rawBody: field(form, 'note') || `Offer ${result.status.toLowerCase()}.`,
    });
  }

  await tryWriteAuditLog(prisma, {
    action: 'offer.transitioned',
    actorType: 'user',
    actorId: userId,
    entityType: 'offer',
    entityId: offer.id,
    before: { status: offer.status },
    after: { status: result.status, actorRole: actor },
    ip: null,
    userAgent: null,
    correlationId: null,
  });

  const locale = localeOf(form);
  revalidatePath(`/${locale}/dashboard/offers/${offer.id}`);
  revalidatePath(`/${locale}/dashboard/offers`);
  return { error: null, ok: true };
}
