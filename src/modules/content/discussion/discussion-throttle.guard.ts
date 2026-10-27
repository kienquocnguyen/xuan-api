import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { AppError } from '../../../errors/app-error.js';
import { baselineErrors } from '../../../errors/baseline-errors.js';

/** BD-8: per user, across every discussion write (spec §6.4). */
export const DISCUSSION_LIMITS = [
  { name: 'minute', ttl: 60_000, limit: 5 },
  { name: 'hour', ttl: 3_600_000, limit: 60 },
];

/**
 * Throttles discussion writes per **session user**, never per IP (no `trust proxy` involved). Route guards run
 * after the global CSRF and access guards, so refused requests (401, 403) never use the budget. One budget across
 * routes: the key ignores the handler. Over the limit → `429 RATE_LIMITED` with `Retry-After` in seconds.
 */
@Injectable()
export class DiscussionThrottle extends ThrottlerGuard {
  protected override async getTracker(req: Request): Promise<string> {
    if (!req.user)
      throw new Error('DiscussionThrottle used on a route without an authenticated user.');
    return req.user.id;
  }

  protected override generateKey(
    _context: ExecutionContext,
    tracker: string,
    name: string,
  ): string {
    return createHash('sha256').update(`discussion-${name}-${tracker}`).digest('hex');
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader('Retry-After', String(Math.max(1, detail.timeToBlockExpire)));
    throw new AppError(baselineErrors.RATE_LIMITED);
  }
}
