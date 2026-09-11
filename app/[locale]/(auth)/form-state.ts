/**
 * Shared form state for the auth actions.
 *
 * Kept out of `actions.ts` because a `"use server"` module may only export
 * async functions — everything it exports becomes a callable server endpoint,
 * so a stray constant is a build error rather than a style issue.
 */
export interface AuthFormState {
  readonly error: string | null;
  /** Set when registration succeeds and the reader must check their email. */
  readonly pendingVerification?: boolean;
  /** Development convenience, surfaced only when the API chose to return it. */
  readonly devVerificationToken?: string | null;
}

export const EMPTY_FORM_STATE: AuthFormState = { error: null };
