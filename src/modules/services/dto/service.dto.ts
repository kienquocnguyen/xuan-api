import { ApiProperty } from '@nestjs/swagger';
import type { ServiceOffering } from '../service-offering.entity.js';

/** Public shape of a service (contract identifier, I19). */
export class ServiceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'channel-kickstart' }) slug!: string;
  @ApiProperty() title!: string;
  @ApiProperty() summary!: string;
}

/** Whitelist by construction: only these fields reach the wire (I10). */
export function toServiceDto(offering: ServiceOffering): ServiceDto {
  return {
    id: offering.id,
    slug: offering.slug,
    title: offering.title,
    summary: offering.summary,
  };
}
