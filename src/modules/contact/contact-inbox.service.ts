import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AppError } from '../../errors/app-error.js';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { ContactSubmission, type ContactSubmissionStatus } from './contact-submission.entity.js';
import { ContactNotificationsService } from './notifications/contact-notifications.service.js';

type InboxFilter = Readonly<{ status?: ContactSubmissionStatus; page: number; pageSize: number }>;

/** The admin inbox (contact form design CF-14): list, read, mark read, archive, retry the notification. */
@Injectable()
export class ContactInboxService {
  constructor(
    @InjectRepository(ContactSubmission)
    private readonly submissions: Repository<ContactSubmission>,
    private readonly notifications: ContactNotificationsService,
  ) {}

  async list(filter: InboxFilter): Promise<{ items: ContactSubmission[]; totalItems: number }> {
    const [items, totalItems] = await this.submissions.findAndCount({
      where: filter.status ? { status: filter.status } : {},
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (filter.page - 1) * filter.pageSize,
      take: filter.pageSize,
    });
    return { items, totalItems };
  }

  async get(id: string): Promise<ContactSubmission> {
    const submission = await this.submissions.findOneBy({ id });
    if (!submission) throw new AppError(baselineErrors.NOT_FOUND);
    return submission;
  }

  /** `new` → `read`; read and archived submissions stay as they are, with no write. */
  async markRead(id: string): Promise<ContactSubmission> {
    await this.submissions
      .createQueryBuilder()
      .update()
      .set({ status: 'read' }) // updated_at follows (UpdateDateColumn)
      .where('id = :id AND status = :from', { id, from: 'new' })
      .execute();
    return this.get(id);
  }

  /** Anything not archived → `archived`; idempotent. */
  async archive(id: string): Promise<ContactSubmission> {
    await this.submissions
      .createQueryBuilder()
      .update()
      .set({ status: 'archived' })
      .where('id = :id AND status <> :to', { id, to: 'archived' })
      .execute();
    return this.get(id);
  }

  /** One delivery attempt now (CF-13c); a sent notification is returned unchanged. */
  async retryNotification(id: string): Promise<ContactSubmission> {
    await this.get(id);
    await this.notifications.retry(id);
    return this.get(id);
  }
}
