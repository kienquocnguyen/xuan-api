import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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
}
