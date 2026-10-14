import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AppError } from '../../errors/app-error.js';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { ServiceOffering } from './service-offering.entity.js';

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
    const offering = await this.offerings.findOneBy({ slug, isPublished: true });
    if (!offering) throw new AppError(baselineErrors.NOT_FOUND); // I14: never NotFoundException
    return offering;
  }
}
