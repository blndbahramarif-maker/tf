/**
 * Ownership decisions.
 *
 * An id in a URL is a claim, never a fact. Every route that addresses a
 * resource by id must resolve that resource and compare its owner against the
 * authenticated principal — the id itself proves nothing.
 *
 * Staff with an explicit override permission may reach other people's
 * resources; everyone else may not, and is told the resource does not exist.
 */
import { type AuthorizationDecision, ALLOW, deny, type Principal } from './authorize';

export interface OwnedResource {
  /** The user this resource belongs to. */
  readonly ownerUserId: string;
}

export interface OwnershipRequirement {
  /**
   * Permission that allows reaching resources owned by someone else,
   * e.g. `user:read` for support staff. Omitted means owner-only.
   */
  readonly overridePermission?: string;
}

/**
 * Decides whether the principal may act on this resource.
 *
 * `resource === null` returns `not_owner` rather than a distinct "missing"
 * verdict. The caller maps both to 404, so a non-owner cannot distinguish
 * "exists but not yours" from "does not exist" — otherwise the endpoint
 * becomes an existence oracle for enumerating other people's ids.
 */
export function checkOwnership(
  principal: Principal,
  resource: OwnedResource | null,
  requirement: OwnershipRequirement = {},
): AuthorizationDecision {
  if (resource === null) return deny('not_owner');

  if (resource.ownerUserId === principal.userId) return ALLOW;

  if (
    requirement.overridePermission !== undefined &&
    principal.permissions.has(requirement.overridePermission)
  ) {
    return ALLOW;
  }

  return deny('not_owner');
}
