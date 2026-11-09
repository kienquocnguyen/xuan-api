import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { FindOptionsWhere, Repository } from 'typeorm';
import { AppError } from '../../../errors/app-error.js';
import { baselineErrors } from '../../../errors/baseline-errors.js';
import type { CoachingProgram, CoachingRegistrationStatus } from './coaching-options.js';
import { CoachingRegistration } from './coaching-registration.entity.js';

type InboxFilter = Readonly<{
  status?: CoachingRegistrationStatus;
  program?: CoachingProgram;
  page: number;
  pageSize: number;
}>;

/** The admin inbox for coaching registrations: list, read, mark contacted, archive. */
@Injectable()
export class CoachingInboxService {
  constructor(
    @InjectRepository(CoachingRegistration)
    private readonly registrations: Repository<CoachingRegistration>,
  ) {}

  async list(filter: InboxFilter): Promise<{ items: CoachingRegistration[]; totalItems: number }> {
    const where: FindOptionsWhere<CoachingRegistration> = {};
    if (filter.status) where.status = filter.status;
    if (filter.program) where.program = filter.program;
    const [items, totalItems] = await this.registrations.findAndCount({
      where,
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (filter.page - 1) * filter.pageSize,
      take: filter.pageSize,
    });
    return { items, totalItems };
  }

  async get(id: string): Promise<CoachingRegistration> {
    const registration = await this.registrations.findOneBy({ id });
    if (!registration) throw new AppError(baselineErrors.NOT_FOUND);
    return registration;
  }

  /** `new` → `contacted`; contacted and archived registrations stay as they are, with no write. */
  async markContacted(id: string): Promise<CoachingRegistration> {
    await this.registrations
      .createQueryBuilder()
      .update()
      .set({ status: 'contacted' }) // updated_at follows (UpdateDateColumn)
      .where('id = :id AND status = :from', { id, from: 'new' })
      .execute();
    return this.get(id);
  }

  /** Anything not archived → `archived`; idempotent. */
  async archive(id: string): Promise<CoachingRegistration> {
    await this.registrations
      .createQueryBuilder()
      .update()
      .set({ status: 'archived' })
      .where('id = :id AND status <> :to', { id, to: 'archived' })
      .execute();
    return this.get(id);
  }
}
