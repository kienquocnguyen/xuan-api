import { ApiProperty } from '@nestjs/swagger';

/** One stored WebP variant (blog completion spec §5.1). */
export class MediaImageVariantDto {
  @ApiProperty({ example: 1280 }) width!: number;
  @ApiProperty({ example: 853 }) height!: number;
  @ApiProperty({ format: 'uri' }) url!: string;
}

/** An image placed on a post: the media plus the placement's alt text (spec §5.4). */
export class PostImageDto {
  @ApiProperty({ format: 'uri' }) url!: string;
  @ApiProperty({ example: 1280 }) width!: number;
  @ApiProperty({ example: 720 }) height!: number;
  @ApiProperty({ example: 'Ảnh bìa' }) alt!: string;
  @ApiProperty({ type: [MediaImageVariantDto] }) variants!: MediaImageVariantDto[];
}

/** The same in the dashboard, with the media id the post form sends back. */
export class AdminPostImageDto extends PostImageDto {
  @ApiProperty({ format: 'uuid' }) mediaId!: string;
}

/** An uploaded image: `url` is the 1280 variant (or the largest below it); variants ascend by width. */
export class MediaImageDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uri' }) url!: string;
  @ApiProperty({ example: 1280 }) width!: number;
  @ApiProperty({ example: 853 }) height!: number;
  @ApiProperty({ type: [MediaImageVariantDto] }) variants!: MediaImageVariantDto[];
}
