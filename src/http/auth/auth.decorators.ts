import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser, Role } from './role.js';

export const IS_PUBLIC = 'auth:isPublic';
export const REQUIRED_ROLES = 'auth:roles';

/** Opts a route or controller out of the global session requirement (default deny, auth design A5). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Only these roles may call the route; anyone else signed in gets 403 (explicit lists, A7). */
export const Roles = (...roles: [Role, ...Role[]]) => SetMetadata(REQUIRED_ROLES, roles);

/** The signed-in user that the access guard attached to the request. Only on non-public routes. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const user = context.switchToHttp().getRequest<Request>().user;
    if (!user) throw new Error('CurrentUser used on a route without an authenticated user.');
    return user;
  },
);

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by the global access guard for a valid session. */
    user?: AuthenticatedUser;
  }
}
