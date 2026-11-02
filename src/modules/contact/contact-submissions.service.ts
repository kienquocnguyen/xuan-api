import { createHmac } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { APP_CONFIG } from '../../config/app-config.module.js';
import type { AppConfig } from '../../config/load-config.js';
import { AppError } from '../../errors/app-error.js';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { contactErrors } from './contact.errors.js';
import type { CreateContactSubmissionInput } from './dto/create-contact-submission.dto.js';
import { ContactNotificationsService } from './notifications/contact-notifications.service.js';
import {
  assessRecaptcha,
  RECAPTCHA_VERIFIER,
  type RecaptchaVerifier,
  RecaptchaUnavailableError,
} from './recaptcha/recaptcha.js';

/** Accepted submissions per rolling hour (contact form design CF-6). */
export const CONTACT_LIMITS = { perEmail: 3, perClientIp: 5 } as const;

/** Over a limit: `429 RATE_LIMITED`; the controller turns `retryAfterSeconds` into `Retry-After`. */
export class ContactRateLimitedError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super(baselineErrors.RATE_LIMITED);
  }
}

export type ContactReceipt = Readonly<{ receivedAt: Date }>;

type Limits = {
  emailCount: number;
  emailRetry: number | null;
  ipCount: number;
  ipRetry: number | null;
};

/**
 * The public contact form (contact form design §3): duplicates answer like a success with nothing written, limits
 * and reCAPTCHA guard the insert, and the notification is attempted after the submission has committed.
 */
@Injectable()
export class ContactSubmissionsService {
  private readonly logger = new Logger(ContactSubmissionsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(RECAPTCHA_VERIFIER) private readonly recaptcha: RecaptchaVerifier,
    private readonly notifications: ContactNotificationsService,
  ) {}

  async submit(
    input: CreateContactSubmissionInput,
    clientIp: string | null,
  ): Promise<ContactReceipt> {
    if (this.config.contact.recaptcha.mode === 'unconfigured')
      throw new AppError(contactErrors.CONTACT_FORM_UNAVAILABLE);
    const ipHash = clientIp ? this.hashClientIp(clientIp) : null;
    const manager = this.dataSource.manager;

    const earlier = await this.findDuplicate(manager, input);
    if (earlier) return earlier;
    await this.assertWithinLimits(manager, input.email, ipHash);
    if (!(await this.isHuman(input.recaptchaToken, clientIp))) {
      // A double click sends one token twice and Google refuses the second (CF-7): answer it like the first.
      const first = await this.findDuplicate(manager, input);
      if (first) return first;
      throw new AppError(contactErrors.RECAPTCHA_VERIFICATION_FAILED);
    }

    const stored = await this.dataSource.transaction(async (tx) => {
      // Serializes submissions for one email, so check-then-insert can't race (CF-7). I8: `tx` only.
      await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `contact_submissions:${input.email}`,
      ]);
      const duplicate = await this.findDuplicate(tx, input);
      if (duplicate) return { id: null, ...duplicate };
      await this.assertWithinLimits(tx, input.email, ipHash);
      // Fields assigned explicitly (I9); the notification is due at once.
      const [row] = await tx.query<{ id: string; receivedAt: Date }[]>(
        `INSERT INTO contact_submissions
           (name, email, subject, message, client_ip_hash, notification_next_attempt_at)
         VALUES ($1, $2, $3, $4, $5, now())
         RETURNING id, created_at AS "receivedAt"`,
        [input.name, input.email, input.subject, input.message, ipHash],
      );
      return row;
    });

    if (stored.id) await this.notifications.deliverNew(stored.id); // awaited, never detached (CF-11)
    return { receivedAt: stored.receivedAt };
  }

  /** Same email, subject and message within 24 hours (CF-7). */
  private async findDuplicate(
    manager: EntityManager,
    input: CreateContactSubmissionInput,
  ): Promise<ContactReceipt | null> {
    const [row] = await manager.query<{ receivedAt: Date }[]>(
      `SELECT created_at AS "receivedAt" FROM contact_submissions
        WHERE email = $1 AND subject = $2 AND message = $3
          AND created_at > now() - interval '24 hours'
        ORDER BY created_at LIMIT 1`,
      [input.email, input.subject, input.message],
    );
    return row ?? null;
  }

  private async assertWithinLimits(
    manager: EntityManager,
    email: string,
    ipHash: string | null,
  ): Promise<void> {
    // The wait is until the oldest submission in the window leaves it, computed by the database's clock.
    const [limits] = await manager.query<Limits[]>(
      `SELECT count(*) FILTER (WHERE email = $1)::int AS "emailCount",
              ceil(extract(epoch FROM min(created_at) FILTER (WHERE email = $1)
                   + interval '1 hour' - now()))::int AS "emailRetry",
              count(*) FILTER (WHERE client_ip_hash = $2)::int AS "ipCount",
              ceil(extract(epoch FROM min(created_at) FILTER (WHERE client_ip_hash = $2)
                   + interval '1 hour' - now()))::int AS "ipRetry"
         FROM contact_submissions
        WHERE created_at > now() - interval '1 hour'
          AND (email = $1 OR client_ip_hash = $2)`,
      [email, ipHash],
    );
    const waits = [
      limits.emailCount >= CONTACT_LIMITS.perEmail ? limits.emailRetry : null,
      limits.ipCount >= CONTACT_LIMITS.perClientIp ? limits.ipRetry : null,
    ].filter((wait): wait is number => wait !== null);
    if (waits.length > 0) throw new ContactRateLimitedError(Math.max(1, ...waits));
  }

  /** CF-4, CF-5. Google unreachable fails closed with 503; a refusal is logged with its reason, never sent. */
  private async isHuman(token: string, clientIp: string | null): Promise<boolean> {
    const settings = this.config.contact.recaptcha;
    if (settings.mode !== 'verify') return true; // `bypass`: development and test only (config)
    let verdict: string;
    try {
      const result = await this.recaptcha.verify(token, clientIp);
      verdict = assessRecaptcha(result, settings, new Date());
      if (verdict !== 'pass' && result.errorCodes.length > 0)
        verdict += ` (${result.errorCodes.join(', ')})`;
    } catch (error) {
      if (!(error instanceof RecaptchaUnavailableError)) throw error;
      this.logger.warn(error.message);
      throw new AppError(contactErrors.CONTACT_FORM_UNAVAILABLE);
    }
    if (verdict === 'pass') return true;
    this.logger.warn(`reCAPTCHA refused a contact submission: ${verdict}`);
    return false;
  }

  /** Keyed, so the stored value can't be reversed by hashing every IPv4 address (CF-6). */
  private hashClientIp(ip: string): string {
    return createHmac('sha256', this.config.auth.cookieSecret)
      .update(`contact-client-ip:${ip}`)
      .digest('hex');
  }
}
