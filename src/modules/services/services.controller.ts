import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { ApiEnvelopeResponse } from '../../http/openapi/api-envelope-response.js';
import { ApiErrorResponses } from '../../http/openapi/api-error-responses.js';
import { ServiceDto, toServiceDto } from './dto/service.dto.js';
import { ServicesCatalogService } from './services.service.js';

@ApiTags('services')
@Controller('services')
export class ServicesController {
  constructor(private readonly catalog: ServicesCatalogService) {}

  @Get()
  @ApiEnvelopeResponse(ServiceDto, { isArray: true })
  @ApiErrorResponses()
  async list(): Promise<ServiceDto[]> {
    const offerings = await this.catalog.listPublished();
    return offerings.map(toServiceDto); // mapping at the HTTP boundary (D5)
  }

  @Get(':slug')
  @ApiEnvelopeResponse(ServiceDto)
  @ApiErrorResponses(baselineErrors.NOT_FOUND)
  async getBySlug(@Param('slug') slug: string): Promise<ServiceDto> {
    // D7 deviation (plan Task 13): the slug is an opaque lookup key; an impossible slug is simply not found.
    return toServiceDto(await this.catalog.getPublishedBySlug(slug));
  }
}
