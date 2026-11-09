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
import { HumanCheckService } from './recaptcha/human-check.service.js';
import { RECAPTCHA_ACTION } from './recaptcha/recaptcha.js';

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
 * and reCAPTCHA guard the insert, and the one notification attempt runs after the submission has committed.
 */
@Injectable()
export class ContactSubmissionsService {
  private readonly logger = new Logger(ContactSubmissionsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly humanCheck: HumanCheckService,
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
    const human = await this.humanCheck.check(input.recaptchaToken, clientIp, RECAPTCHA_ACTION);
    if (human === 'unavailable') throw new AppError(contactErrors.CONTACT_FORM_UNAVAILABLE);
    if (human === 'refused') {
      // A double click sends one token twice and Google refuses the second (CF-7): answer it like the first.
      // The email's lock helps only if the first request already holds it; if that one is still waiting on
      // Google, this check finds nothing and this request gets 403 while the other still saves.
      const first = await this.dataSource.transaction(async (tx) => {
        await this.lockEmail(tx, input.email);
        return this.findDuplicate(tx, input);
      });
      if (first) return first;
      throw new AppError(contactErrors.RECAPTCHA_VERIFICATION_FAILED);
    }

    const notify = this.notifications.enabled;
    const stored = await this.dataSource.transaction(async (tx) => {
      // Serializes submissions for one email, so check-then-insert can't race (CF-7). I8: `tx` only.
      await this.lockEmail(tx, input.email);
      const duplicate = await this.findDuplicate(tx, input);
      if (duplicate) return { id: null, ...duplicate }; // no second row, no second email
      await this.assertWithinLimits(tx, input.email, ipHash);
      // Fields assigned explicitly (I9). With a provider, the one attempt is claimed with the insert (CF-11);
      // without one, nothing will be attempted, so the notification is `failed` from the start (CF-10).
      const [row] = await tx.query<{ id: string; receivedAt: Date }[]>(
        `INSERT INTO contact_submissions
           (name, email, subject, message, client_ip_hash,
            notification_status, notification_attempts, notification_attempted_at, notification_last_error)
         VALUES ($1, $2, $3, $4, $5,
                 CASE WHEN $6::boolean THEN 'pending' ELSE 'failed' END, CASE WHEN $6 THEN 1 ELSE 0 END,
                 CASE WHEN $6 THEN now() END, CASE WHEN $6 THEN NULL ELSE 'NOT_CONFIGURED' END)
         RETURNING id, created_at AS "receivedAt"`,
        [input.name, input.email, input.subject, input.message, ipHash, notify],
      );
      return row;
    });

    if (stored.id === null) return { receivedAt: stored.receivedAt };
    if (notify) {
      // Awaited, never detached (CF-11): the submission has committed, so this can't undo it.
      const { name, email, subject, message } = input;
      await this.notifications.deliverNew({
        id: stored.id,
        name,
        email,
        subject,
        message,
        createdAt: stored.receivedAt,
      });
    } else {
      this.logger.warn(`Contact notification ${stored.id} not sent: no email provider configured.`);
    }
    return { receivedAt: stored.receivedAt };
  }

  /** Held until the transaction ends. */
  private async lockEmail(tx: EntityManager, email: string): Promise<void> {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `contact_submissions:${email}`,
    ]);
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

  /** Keyed, so the stored value can't be reversed by hashing every IPv4 address (CF-6). */
  private hashClientIp(ip: string): string {
    return createHmac('sha256', this.config.auth.cookieSecret)
      .update(`contact-client-ip:${ip}`)
      .digest('hex');
  }
}
