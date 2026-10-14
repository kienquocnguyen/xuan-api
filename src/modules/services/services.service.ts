import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AppError } from '../../errors/app-error.js';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { ServiceOffering } from './service-offering.entity.js';

/** Same rule as ck_services_slug_format (database.md §12). */
const STORABLE_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Public catalog use cases. */
@Injectable()
export class ServicesCatalogService {
  constructor(
    @InjectRepository(ServiceOffering) private readonly offerings: Repository<ServiceOffering>,
  ) {}

  listPublished(): Promise<ServiceOffering[]> {
    return this.offerings.find({
      where: { isPublished: true },
      order: { sortOrder: 'ASC', slug: 'ASC' },
    });
  }

  async getPublishedBySlug(slug: string): Promise<ServiceOffering> {
    // A slug ck_services_slug_format forbids can't exist; skip the query (a NUL byte would make Postgres throw).
    if (slug.length > 80 || !STORABLE_SLUG.test(slug)) throw new AppError(baselineErrors.NOT_FOUND);
    const offering = await this.offerings.findOneBy({ slug, isPublished: true });
    if (!offering) throw new AppError(baselineErrors.NOT_FOUND); // I14: never NotFoundException
    return offering;
  }
}
