/**
 * Password policy.
 *
 * Length-based, with a breach check, and deliberately NO composition rules
 * ("must contain a symbol"). Composition rules push people toward
 * `Password1!` and are worse than length. This follows NIST SP 800-63B.
 */

import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/shared/auth-contract';

export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH };

export type PasswordRejection = 'too_short' | 'too_long' | 'breached' | 'contains_email' | 'common';

export interface PasswordCheckResult {
  readonly ok: boolean;
  readonly reasons: readonly PasswordRejection[];
}

/**
 * A small sample of the most-guessed passwords.
 *
 * NOT a substitute for a real breached-password corpus — that is a Phase 12
 * item (checking against Have I Been Pwned's k-anonymity range API). This
 * catches the worst offenders at zero cost in the meantime.
 */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd',
  '123456',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty',
  'qwertyuiop',
  'letmein',
  'welcome',
  'admin',
  'iloveyou',
  'monkey',
  'dragon',
  'football',
  'baseball',
  'abc123',
  'changeme',
  'trustno1',
  'sunshine',
  'princess',
]);

export function checkPassword(password: string, email?: string): PasswordCheckResult {
  const reasons: PasswordRejection[] = [];

  if (password.length < MIN_PASSWORD_LENGTH) reasons.push('too_short');
  // An upper bound matters: Argon2 hashing cost scales with input, so an
  // unbounded password is a cheap denial-of-service.
  if (password.length > MAX_PASSWORD_LENGTH) reasons.push('too_long');

  const normalised = password.toLowerCase();
  if (COMMON_PASSWORDS.has(normalised)) reasons.push('common');

  if (email) {
    const local = email.split('@')[0]?.toLowerCase() ?? '';
    if (local.length >= 3 && normalised.includes(local)) reasons.push('contains_email');
  }

  return { ok: reasons.length === 0, reasons };
}
