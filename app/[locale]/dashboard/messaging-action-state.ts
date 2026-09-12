import type { ActionError } from '@/lib/auth/action-guard';

/**
 * Shared state for the messaging and offer actions.
 *
 * Separate from `messaging-actions.ts` because a `"use server"` module may only
 * export async functions.
 */
export interface MessagingActionState {
  readonly error: ActionError | null;
  /** A domain-level reason, translated by the form (`too_long`, `expired`, …). */
  readonly reason?: string | null;
  readonly ok?: boolean;
}

export const EMPTY_MESSAGING_STATE: MessagingActionState = { error: null };
