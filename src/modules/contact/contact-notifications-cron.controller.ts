import { createHash, timingSafeEqual } from 'node:crypto';
import { Controller, Get, Headers, Inject } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { APP_CONFIG } from '../../config/app-config.module.js';
import type { AppConfig } from '../../config/load-config.js';
import { AppError } from '../../errors/app-error.js';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { Public } from '../../http/auth/auth.decorators.js';
import {
  ContactNotificationsService,
  type SweepSummary,
} from './notifications/contact-notifications.service.js';

/** Notifications per scheduled run; each is one awaited provider call (≤ 8 s). */
const SWEEP_LIMIT = 20;

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Scheduled retry of due notifications (contact form design CF-13b), for Vercel Cron, which only sends GET with
 * `Authorization: Bearer <CRON_SECRET>`. The documented exception to "safe methods never mutate"
 * (`api-contract.md` §8): no cookie is read, and a browser can't send the bearer secret cross-site. Not part of the
 * web contract, so not in OpenAPI. Without CRON_SECRET the route doesn't exist (404).
 */
@ApiExcludeController()
@Controller('internal/contact-notifications')
export class ContactNotificationsCronController {
  private readonly expected: Buffer | null;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly notifications: ContactNotificationsService,
  ) {
    this.expected = config.contact.cronSecret
      ? digest(`Bearer ${config.contact.cronSecret}`)
      : null;
  }

  @Public()
  @Get('deliver-due')
  async deliverDue(@Headers('authorization') authorization?: string): Promise<SweepSummary> {
    if (!this.expected) throw new AppError(baselineErrors.NOT_FOUND);
    // Equal-length digests, so the comparison takes the same time whatever was sent.
    if (!authorization || !timingSafeEqual(digest(authorization), this.expected))
      throw new AppError(baselineErrors.UNAUTHENTICATED);
    return this.notifications.deliverDue(SWEEP_LIMIT);
  }
}
