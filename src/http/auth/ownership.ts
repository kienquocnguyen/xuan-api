import { AppError } from '../../errors/app-error.js';
import { baselineErrors } from '../../errors/baseline-errors.js';
import type { AuthenticatedUser } from './role.js';

/**
 * Resource-ownership rule (auth design §5): an admin manages any owned resource, an editor only their own,
 * a user none. Call it after loading the record; the role-level gate is `@Roles(...)` on the route.
 */
export function canManageOwnedResource(actor: AuthenticatedUser, ownerId: string): boolean {
  if (actor.role === 'admin') return true;
  if (actor.role === 'editor') return actor.id === ownerId;
  return false;
}

export function assertCanManageOwnedResource(actor: AuthenticatedUser, ownerId: string): void {
  if (!canManageOwnedResource(actor, ownerId)) throw new AppError(baselineErrors.FORBIDDEN);
}
