import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../../errors/app-error.js';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { IS_PUBLIC, REQUIRED_ROLES } from '../../http/auth/auth.decorators.js';
import type { Role } from '../../http/auth/role.js';
import { SESSION_COOKIE, SessionsService } from './sessions.service.js';

/**
 * Global default-deny guard (auth design A5): a route needs a valid session unless it is `@Public()`;
 * `@Roles(...)` then requires one of the listed roles. The role is read from `users` on every request, so a
 * demotion applies to existing sessions at once.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = await this.sessions.resolve(request.cookies?.[SESSION_COOKIE]);
    if (!user) throw new AppError(baselineErrors.UNAUTHENTICATED);
    request.user = { id: user.id, role: user.role };

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(REQUIRED_ROLES, targets);
    if (roles && !roles.includes(user.role)) throw new AppError(baselineErrors.FORBIDDEN);
    return true;
  }
}
