import type { ActionError } from '@/lib/auth/action-guard';

/**
 * Shared state for the dashboard actions.
 *
 * Separate from `actions.ts` for the same reason as the auth form state: a
 * `"use server"` module may only export async functions.
 */
export interface ActionState {
  readonly error: ActionError | null;
  readonly fieldErrors?: Readonly<Record<string, string>>;
  readonly ok?: boolean;
}

export const EMPTY_ACTION_STATE: ActionState = { error: null };
