import { ApiProperty } from '@nestjs/swagger';

/** One stored WebP variant (blog completion spec §5.1). */
export class MediaImageVariantDto {
  @ApiProperty({ example: 1280 }) width!: number;
  @ApiProperty({ example: 853 }) height!: number;
  @ApiProperty({ format: 'uri' }) url!: string;
}

/** An uploaded image: `url` is the 1280 variant (or the largest below it); variants ascend by width. */
export class MediaImageDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uri' }) url!: string;
  @ApiProperty({ example: 1280 }) width!: number;
  @ApiProperty({ example: 853 }) height!: number;
  @ApiProperty({ type: [MediaImageVariantDto] }) variants!: MediaImageVariantDto[];
}
