/**
 * Authorization decisions. Deny by default.
 *
 * Two checks always run, and both must pass:
 *
 *   1. PERMISSION — does the caller's role set grant this permission?
 *   2. OWNERSHIP  — is this particular resource theirs, or do they hold an
 *                   override permission that covers other people's resources?
 *
 * Permission alone would let any seller edit any listing. That is the single
 * most common authorization bug in a marketplace, so ownership is not optional
 * and is not left to each route to remember.
 *
 * Pure: no database, no request, no framework.
 */

export interface Principal {
  readonly userId: string;
  readonly roles: readonly string[];
  readonly permissions: ReadonlySet<string>;
  readonly emailVerified: boolean;
  readonly twoFactorEnabled: boolean;
  /** True when every role held requires two-factor (staff). */
  readonly requiresTwoFactor: boolean;
  readonly stepUpAt: Date | null;
}

export type DenialReason =
  | 'unauthenticated'
  | 'email_unverified'
  | 'two_factor_required'
  | 'missing_permission'
  | 'not_owner'
  | 'step_up_required'
  | 'account_suspended';

export type AuthorizationDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: DenialReason; readonly missing?: string };

export const ALLOW: AuthorizationDecision = { allowed: true };

export function deny(reason: DenialReason, missing?: string): AuthorizationDecision {
  return missing === undefined ? { allowed: false, reason } : { allowed: false, reason, missing };
}

export interface PermissionRequirement {
  /** Every one of these is required. */
  readonly all?: readonly string[];
  /** At least one of these is required. */
  readonly any?: readonly string[];
}

/**
 * Evaluates a permission requirement against a principal.
 *
 * An EMPTY requirement denies. A route that forgets to declare what it needs
 * must fail closed, not open — this is the deny-by-default rule made literal.
 */
export function checkPermissions(
  principal: Principal,
  requirement: PermissionRequirement,
): AuthorizationDecision {
  const all = requirement.all ?? [];
  const any = requirement.any ?? [];

  if (all.length === 0 && any.length === 0) {
    return deny('missing_permission', '(no requirement declared)');
  }

  for (const permission of all) {
    if (!principal.permissions.has(permission)) {
      return deny('missing_permission', permission);
    }
  }

  if (any.length > 0 && !any.some((permission) => principal.permissions.has(permission))) {
    return deny('missing_permission', any.join('|'));
  }

  return ALLOW;
}

export interface AccessRequirement extends PermissionRequirement {
  /** Require a verified email address. Default true. */
  readonly requireVerifiedEmail?: boolean;
  /** Require a recent re-authentication. */
  readonly requireStepUp?: boolean;
}

export interface AccessContext {
  readonly now: Date;
  readonly stepUpWindowMs: number;
}

/**
 * The full gate for a protected route, minus ownership (which needs the
 * resource and is applied separately by the ownership guard).
 *
 * Order is deliberate: identity problems are reported before permission
 * problems, so a caller is never told "you lack permission X" when the real
 * answer is "you are not properly authenticated".
 */
export function checkAccess(
  principal: Principal | null,
  requirement: AccessRequirement,
  context: AccessContext,
): AuthorizationDecision {
  if (principal === null) return deny('unauthenticated');

  if (requirement.requireVerifiedEmail !== false && !principal.emailVerified) {
    return deny('email_unverified');
  }

  // Staff roles must have two-factor enrolled. Holding the role is not enough:
  // a moderator or finance account without TOTP is refused outright rather
  // than merely nagged.
  if (principal.requiresTwoFactor && !principal.twoFactorEnabled) {
    return deny('two_factor_required');
  }

  const permissionDecision = checkPermissions(principal, requirement);
  if (!permissionDecision.allowed) return permissionDecision;

  if (requirement.requireStepUp === true) {
    const fresh =
      principal.stepUpAt !== null &&
      context.now.getTime() - principal.stepUpAt.getTime() >= 0 &&
      context.now.getTime() - principal.stepUpAt.getTime() <= context.stepUpWindowMs;
    if (!fresh) return deny('step_up_required');
  }

  return ALLOW;
}
