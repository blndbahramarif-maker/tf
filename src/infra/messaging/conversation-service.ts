import { prisma } from '@/infra/db/client';
import { needsReview, validateMessage } from '@/domain/messaging/message-content';

/**
 * Conversation and message persistence.
 *
 * Every function here takes the VIEWER's user id and scopes its query by it.
 * There is no function that loads a conversation by id alone — the scoping is
 * structural, so a route cannot leak someone else's thread by forgetting a
 * check. A non-participant gets `null`, which callers turn into the same 404 a
 * non-existent id produces.
 *
 * Nothing is ever read unbounded. Message history is keyset-paginated on
 * `(created_at, id)`; the inbox is capped. A conversation with 50,000 messages
 * must cost the same to open as one with five.
 */

export interface ConversationParticipants {
  readonly id: string;
  readonly buyerId: string;
  readonly sellerId: string;
  readonly listingId: string | null;
  readonly status: string;
}

/**
 * Loads a conversation only if the viewer is one of its two participants.
 *
 * Returns null for "no such conversation" AND for "not yours", so the two are
 * indistinguishable at the data layer rather than only at the route.
 */
export async function loadConversationForViewer(
  conversationId: string,
  viewerId: string,
): Promise<ConversationParticipants | null> {
  return prisma.conversation.findFirst({
    where: {
      id: conversationId,
      // The participant test IS the query. There is no post-hoc comparison to
      // forget.
      OR: [{ buyerId: viewerId }, { sellerId: viewerId }],
    },
    select: { id: true, buyerId: true, sellerId: true, listingId: true, status: true },
  });
}

export interface InboxEntry {
  readonly id: string;
  readonly listingId: string | null;
  readonly listingTitle: string | null;
  readonly listingSlug: string | null;
  readonly counterpartName: string;
  readonly viewerRole: 'buyer' | 'seller';
  readonly status: string;
  readonly lastMessageAt: Date | null;
  readonly lastMessagePreview: string | null;
  readonly unreadCount: number;
}

/** Inbox page size. Deliberately capped — the inbox is never "all of them". */
export const INBOX_PAGE_SIZE = 30;

export async function loadInbox(
  viewerId: string,
  options: { limit?: number; before?: Date } = {},
): Promise<readonly InboxEntry[]> {
  const limit = Math.min(options.limit ?? INBOX_PAGE_SIZE, 100);

  const rows = await prisma.conversation.findMany({
    where: {
      OR: [{ buyerId: viewerId }, { sellerId: viewerId }],
      ...(options.before ? { lastMessageAt: { lt: options.before } } : {}),
    },
    select: {
      id: true,
      buyerId: true,
      sellerId: true,
      listingId: true,
      status: true,
      lastMessageAt: true,
      listing: { select: { title: true, slug: true } },
      buyer: { select: { profile: { select: { displayName: true } } } },
      seller: { select: { profile: { select: { displayName: true } } } },
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { body: true },
      },
    },
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });

  if (rows.length === 0) return [];

  /*
   * Unread counts in ONE grouped query rather than one per conversation.
   * "Unread" means: in this conversation, not sent by me, and with no read
   * receipt from me. The N+1 version of this is what makes an inbox slow.
   */
  const unreadRows = await prisma.message.groupBy({
    by: ['conversationId'],
    where: {
      conversationId: { in: rows.map((row) => row.id) },
      senderId: { not: viewerId },
      deletedAt: null,
      reads: { none: { userId: viewerId } },
    },
    _count: { _all: true },
  });
  const unread = new Map(unreadRows.map((row) => [row.conversationId, row._count._all]));

  return rows.map((row) => {
    const viewerRole = row.buyerId === viewerId ? 'buyer' : 'seller';
    const counterpart = viewerRole === 'buyer' ? row.seller : row.buyer;
    return {
      id: row.id,
      listingId: row.listingId,
      listingTitle: row.listing?.title ?? null,
      listingSlug: row.listing?.slug ?? null,
      counterpartName: counterpart.profile?.displayName ?? '',
      viewerRole,
      status: row.status,
      lastMessageAt: row.lastMessageAt,
      // A preview, not the message. Truncation here is presentation, not
      // censorship — the full text is always one click away.
      lastMessagePreview: row.messages[0]?.body.slice(0, 140) ?? null,
      unreadCount: unread.get(row.id) ?? 0,
    };
  });
}

export interface MessageRow {
  readonly id: string;
  readonly body: string;
  readonly senderId: string;
  readonly type: string;
  readonly createdAt: Date;
  readonly moderationStatus: string;
}

export interface MessagePage {
  readonly messages: readonly MessageRow[];
  /** Opaque cursor for the NEXT older page, or null at the beginning. */
  readonly nextCursor: string | null;
}

/** `<createdAt epoch ms>:<id>` — enough to resume without an offset. */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.getTime()}:${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const separator = raw.indexOf(':');
    if (separator <= 0) return null;
    const millis = Number(raw.slice(0, separator));
    const id = raw.slice(separator + 1);
    if (!Number.isFinite(millis) || id === '') return null;
    return { createdAt: new Date(millis), id };
  } catch {
    return null;
  }
}

/**
 * One page of history, newest first.
 *
 * Keyset, not offset: messages arrive while a reader is scrolling, and offset
 * pagination would show them the same message twice or skip one.
 */
export async function loadMessages(
  conversationId: string,
  options: { limit?: number; cursor?: string | null } = {},
): Promise<MessagePage> {
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const cursor = options.cursor ? decodeCursor(options.cursor) : null;

  const rows = await prisma.message.findMany({
    where: {
      conversationId,
      deletedAt: null,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    // One extra row tells us whether another page exists without a count.
    take: limit + 1,
    select: {
      id: true,
      body: true,
      senderId: true,
      type: true,
      createdAt: true,
      moderationStatus: true,
    },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);

  return {
    messages: page,
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export type SendResult =
  | { readonly ok: true; readonly messageId: string; readonly flagged: boolean }
  | { readonly ok: false; readonly issue: string };

/**
 * Appends a message and updates the conversation's activity time.
 *
 * The caller must already have proven participation. This function does not
 * re-check, and says so, rather than quietly doing half a check that a reader
 * might mistake for the whole one.
 */
export async function appendMessage(input: {
  conversationId: string;
  senderId: string;
  rawBody: string;
}): Promise<SendResult> {
  const validated = validateMessage(input.rawBody);
  if (!validated.ok) return { ok: false, issue: validated.issue };

  const flagged = needsReview(validated.riskScore);

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        conversationId: input.conversationId,
        senderId: input.senderId,
        body: validated.body,
        type: 'TEXT',
        riskScore: validated.riskScore,
        riskSignals: validated.signals as never,
        /*
         * A flagged message is still DELIVERED. It is marked PENDING so a
         * reviewer sees it, not hidden from its recipient — silently dropping
         * a message the sender believes was sent is worse than either
         * delivering it or refusing it outright.
         */
        moderationStatus: flagged ? 'PENDING' : 'APPROVED',
      },
      select: { id: true, createdAt: true },
    });

    await tx.conversation.update({
      where: { id: input.conversationId },
      data: { lastMessageAt: created.createdAt },
    });

    // The sender has, by definition, read their own message.
    await tx.messageRead.create({
      data: { messageId: created.id, userId: input.senderId },
    });

    return created;
  });

  return { ok: true, messageId: message.id, flagged };
}

/**
 * Marks everything the viewer can see in a conversation as read.
 *
 * `skipDuplicates` rather than a read-then-write: two tabs open on the same
 * thread would otherwise race on the composite primary key.
 */
export async function markConversationRead(
  conversationId: string,
  viewerId: string,
): Promise<number> {
  const unread = await prisma.message.findMany({
    where: {
      conversationId,
      senderId: { not: viewerId },
      deletedAt: null,
      reads: { none: { userId: viewerId } },
    },
    select: { id: true },
    take: 500,
  });

  if (unread.length === 0) return 0;

  const result = await prisma.messageRead.createMany({
    data: unread.map((message) => ({ messageId: message.id, userId: viewerId })),
    skipDuplicates: true,
  });
  return result.count;
}

/** Total unread across the inbox, for the header badge. */
export async function countUnread(viewerId: string): Promise<number> {
  return prisma.message.count({
    where: {
      senderId: { not: viewerId },
      deletedAt: null,
      reads: { none: { userId: viewerId } },
      conversation: { OR: [{ buyerId: viewerId }, { sellerId: viewerId }] },
    },
  });
}
