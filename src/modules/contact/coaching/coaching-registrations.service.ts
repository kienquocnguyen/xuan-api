import { createHmac } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { APP_CONFIG } from '../../../config/app-config.module.js';
import type { AppConfig } from '../../../config/load-config.js';
import { AppError } from '../../../errors/app-error.js';
import { baselineErrors } from '../../../errors/baseline-errors.js';
import { contactErrors } from '../contact.errors.js';
import { HumanCheckService } from '../recaptcha/human-check.service.js';
import { COACHING_RECAPTCHA_ACTION } from '../recaptcha/recaptcha.js';
import { coachingErrors } from './coaching.errors.js';
import { CoachingNotificationsService } from './coaching-notifications.service.js';
import type { NotifiedRegistration } from './coaching-notification-email.js';
import type { CreateCoachingRegistrationInput } from './dto/create-coaching-registration.dto.js';

/** Accepted registrations per rolling hour (coaching registrations design CR-7). */
export const COACHING_LIMITS = { perEmail: 3, perClientIp: 5 } as const;

/** Over a limit: `429 RATE_LIMITED`; the controller turns `retryAfterSeconds` into `Retry-After`. */
export class CoachingRateLimitedError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super(baselineErrors.RATE_LIMITED);
  }
}

export type CoachingReceipt = Readonly<{ receivedAt: Date }>;

type Limits = {
  emailCount: number;
  emailRetry: number | null;
  ipCount: number;
  ipRetry: number | null;
};

/** The answers as stored: blank optional text is null, and the 3-month fields exist only on that program. */
type StoredAnswers = Omit<NotifiedRegistration, 'id' | 'createdAt'>;

const blankToNull = (value: string | undefined): string | null => (value ? value : null);

/** I9: every stored field is named here; the consent flag and the token are never stored. */
function toStoredAnswers(input: CreateCoachingRegistrationInput): StoredAnswers {
  const threeMonth = input.program === 'youtube_coaching_3_months';
  return {
    program: input.program,
    name: input.name,
    email: input.email,
    youtubeStage: input.youtubeStage,
    youtubeChannelUrl: blankToNull(input.youtubeChannelUrl),
    expertise: input.expertise,
    goals: input.goals,
    challenges: input.challenges,
    challengeOther: blankToNull(input.challengeOther),
    desiredOutcome: threeMonth ? input.desiredOutcome : null,
    practiceCommitment: threeMonth ? input.practiceCommitment : null,
    favoriteCreators: blankToNull(input.favoriteCreators),
  };
}

/**
 * The public coaching registration forms (coaching registrations design): duplicates answer like a success with
 * nothing written, and limits and reCAPTCHA guard the insert. A new registration gets one notification attempt
 * after it commits (CR-12); a duplicate gets none.
 */
@Injectable()
export class CoachingRegistrationsService {
  private readonly logger = new Logger(CoachingRegistrationsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly humanCheck: HumanCheckService,
    private readonly notifications: CoachingNotificationsService,
  ) {}

  async submit(
    input: CreateCoachingRegistrationInput,
    clientIp: string | null,
  ): Promise<CoachingReceipt> {
    if (this.config.contact.recaptcha.mode === 'unconfigured')
      throw new AppError(coachingErrors.COACHING_REGISTRATION_UNAVAILABLE);
    const answers = toStoredAnswers(input);
    const ipHash = clientIp ? this.hashClientIp(clientIp) : null;
    const manager = this.dataSource.manager;

    const earlier = await this.findDuplicate(manager, answers);
    if (earlier) return earlier;
    await this.assertWithinLimits(manager, answers.email, ipHash);
    const human = await this.humanCheck.check(
      input.recaptchaToken,
      clientIp,
      COACHING_RECAPTCHA_ACTION,
    );
    if (human === 'unavailable')
      throw new AppError(coachingErrors.COACHING_REGISTRATION_UNAVAILABLE);
    if (human === 'refused') {
      // A double click sends one token twice and Google refuses the second: answer it like the first.
      // The email's lock helps only if the first request already holds it; if that one is still waiting on
      // Google, this check finds nothing and this request gets 403 while the other still saves.
      const first = await this.dataSource.transaction(async (tx) => {
        await this.lockEmail(tx, answers.email);
        return this.findDuplicate(tx, answers);
      });
      if (first) return first;
      throw new AppError(contactErrors.RECAPTCHA_VERIFICATION_FAILED);
    }

    const notify = this.notifications.enabled;
    const stored = await this.dataSource.transaction(async (tx) => {
      // Serializes registrations for one email, so check-then-insert can't race. I8: `tx` only.
      await this.lockEmail(tx, answers.email);
      const duplicate = await this.findDuplicate(tx, answers);
      if (duplicate) return { id: null, ...duplicate }; // no second row, no second email
      await this.assertWithinLimits(tx, answers.email, ipHash);
      // `consented_at` is the database's clock: the server's time of the visitor's consent (CR-9). With a provider,
      // the one notification attempt is claimed with the insert; without one, nothing will be attempted, so the
      // notification is `failed` (`NOT_CONFIGURED`) from the start (CR-12, as the contact form's CF-10/CF-11).
      const [row] = await tx.query<{ id: string; receivedAt: Date }[]>(
        `INSERT INTO coaching_registrations
           (program, name, email, youtube_stage, youtube_channel_url, expertise, goals, challenges,
            challenge_other, desired_outcome, practice_commitment, favorite_creators,
            consented_at, client_ip_hash,
            notification_status, notification_attempts, notification_attempted_at, notification_last_error)
         VALUES ($1, $2, $3, $4, $5, $6, $7::varchar[], $8::varchar[], $9, $10, $11, $12, now(), $13,
                 CASE WHEN $14::boolean THEN 'pending' ELSE 'failed' END, CASE WHEN $14 THEN 1 ELSE 0 END,
                 CASE WHEN $14 THEN now() END, CASE WHEN $14 THEN NULL ELSE 'NOT_CONFIGURED' END)
         RETURNING id, created_at AS "receivedAt"`,
        [
          answers.program,
          answers.name,
          answers.email,
          answers.youtubeStage,
          answers.youtubeChannelUrl,
          answers.expertise,
          answers.goals,
          answers.challenges,
          answers.challengeOther,
          answers.desiredOutcome,
          answers.practiceCommitment,
          answers.favoriteCreators,
          ipHash,
          notify,
        ],
      );
      return row;
    });

    if (stored.id === null) return { receivedAt: stored.receivedAt };
    if (notify) {
      // Awaited, never detached: the registration has committed, so this can't undo it, and it never throws.
      await this.notifications.deliverNew({
        id: stored.id,
        ...answers,
        createdAt: stored.receivedAt,
      });
    } else {
      this.logger.warn(
        `Coaching notification ${stored.id} not sent: no email provider configured.`,
      );
    }
    return { receivedAt: stored.receivedAt };
  }

  /** Held until the transaction ends. */
  private async lockEmail(tx: EntityManager, email: string): Promise<void> {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `coaching_registrations:${email}`,
    ]);
  }

  /** Same email, program, name and every answer within 24 hours (CR-8); null equals null. */
  private async findDuplicate(
    manager: EntityManager,
    answers: StoredAnswers,
  ): Promise<CoachingReceipt | null> {
    const [row] = await manager.query<CoachingReceipt[]>(
      `SELECT created_at AS "receivedAt" FROM coaching_registrations
        WHERE email = $1 AND program = $2
          AND name IS NOT DISTINCT FROM $12
          AND youtube_stage IS NOT DISTINCT FROM $3
          AND youtube_channel_url IS NOT DISTINCT FROM $4
          AND expertise IS NOT DISTINCT FROM $5
          AND goals IS NOT DISTINCT FROM $6::varchar[]
          AND challenges IS NOT DISTINCT FROM $7::varchar[]
          AND challenge_other IS NOT DISTINCT FROM $8
          AND desired_outcome IS NOT DISTINCT FROM $9
          AND practice_commitment IS NOT DISTINCT FROM $10
          AND favorite_creators IS NOT DISTINCT FROM $11
          AND created_at > now() - interval '24 hours'
        ORDER BY created_at LIMIT 1`,
      [
        answers.email,
        answers.program,
        answers.youtubeStage,
        answers.youtubeChannelUrl,
        answers.expertise,
        answers.goals,
        answers.challenges,
        answers.challengeOther,
        answers.desiredOutcome,
        answers.practiceCommitment,
        answers.favoriteCreators,
        answers.name,
      ],
    );
    return row ?? null;
  }

  private async assertWithinLimits(
    manager: EntityManager,
    email: string,
    ipHash: string | null,
  ): Promise<void> {
    // The wait is until the oldest registration in the window leaves it, computed by the database's clock.
    const [limits] = await manager.query<Limits[]>(
      `SELECT count(*) FILTER (WHERE email = $1)::int AS "emailCount",
              ceil(extract(epoch FROM min(created_at) FILTER (WHERE email = $1)
                   + interval '1 hour' - now()))::int AS "emailRetry",
              count(*) FILTER (WHERE client_ip_hash = $2)::int AS "ipCount",
              ceil(extract(epoch FROM min(created_at) FILTER (WHERE client_ip_hash = $2)
                   + interval '1 hour' - now()))::int AS "ipRetry"
         FROM coaching_registrations
        WHERE created_at > now() - interval '1 hour'
          AND (email = $1 OR client_ip_hash = $2)`,
      [email, ipHash],
    );
    const waits = [
      limits.emailCount >= COACHING_LIMITS.perEmail ? limits.emailRetry : null,
      limits.ipCount >= COACHING_LIMITS.perClientIp ? limits.ipRetry : null,
    ].filter((wait): wait is number => wait !== null);
    if (waits.length > 0) throw new CoachingRateLimitedError(Math.max(1, ...waits));
  }

  /** Keyed, so the stored value can't be reversed by hashing every IPv4 address; a label apart from contact's. */
  private hashClientIp(ip: string): string {
    return createHmac('sha256', this.config.auth.cookieSecret)
      .update(`coaching-client-ip:${ip}`)
      .digest('hex');
  }
}
