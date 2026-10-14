import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG } from '../../config/app-config.module.js';
import type { AppConfig } from '../../config/load-config.js';
import { AppError } from '../../errors/app-error.js';
import { baselineErrors } from '../../errors/baseline-errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defense in depth for cookie sessions (api-contract.md §8, auth design A13). A state-changing request
 * must carry `X-Requested-With: XMLHttpRequest` (forces a CORS preflight), and an `Origin` header, when the
 * browser sends one, must be an allowed origin. Safe methods never mutate, so they pass.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowedOrigins: ReadonlySet<string>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.allowedOrigins = new Set(config.cors.origins);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;
    const origin = request.headers.origin;
    const hasHeader = request.headers['x-requested-with'] === 'XMLHttpRequest';
    if (!hasHeader || (origin !== undefined && !this.allowedOrigins.has(origin))) {
      throw new AppError(baselineErrors.FORBIDDEN);
    }
    return true;
  }
}
