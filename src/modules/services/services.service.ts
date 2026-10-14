import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
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
}
