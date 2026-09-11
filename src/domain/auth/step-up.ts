/**
 * Step-up authentication.
 *
 * Some actions need proof that the person at the keyboard right now is the
 * account holder, not merely that a valid session exists: changing a password,
 * disabling two-factor, revoking every session, and — from Phase 7 — issuing
 * refunds, releasing payouts and changing commission rules.
 *
 * A session records when it last re-authenticated. Sensitive routes require
 * that moment to be recent.
 */

/** How long a step-up lasts. Short by design. */
export const STEP_UP_WINDOW_MS = 15 * 60_000;

export function isStepUpFresh(
  stepUpAt: Date | null,
  now: Date,
  windowMs: number = STEP_UP_WINDOW_MS,
): boolean {
  if (stepUpAt === null) return false;

  const age = now.getTime() - stepUpAt.getTime();
  // A step-up timestamp in the future means a clock problem or a forged
  // claim. Either way it is not proof of anything, so refuse it.
  if (age < 0) return false;

  return age <= windowMs;
}

export function stepUpExpiresAt(stepUpAt: Date, windowMs: number = STEP_UP_WINDOW_MS): Date {
  return new Date(stepUpAt.getTime() + windowMs);
}
