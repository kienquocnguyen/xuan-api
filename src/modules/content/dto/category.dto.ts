import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { isStorableText, STORABLE_TEXT_MESSAGE } from '../../../http/validation/storable-text.js';
import { CATEGORY_STATUSES, type CategoryStatus } from '../category.entity.js';

/** Same rule as the key and slug CHECKs (database.md §12). */
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const label = z.string().trim().min(1).max(60).refine(isStorableText, STORABLE_TEXT_MESSAGE);
const slug = z.string().max(80).regex(KEBAB);

/** Admin create (blog completion spec §4.2). The key is the stable identity and never changes later. */
export const createPostCategorySchema = z
  .strictObject({ key: z.string().max(60).regex(KEBAB), slug, label })
  .meta({ id: 'CreatePostCategoryDto' });

/** Admin full replacement of the Vietnamese name; the key is not input. */
export const updatePostCategorySchema = z
  .strictObject({ slug, label })
  .meta({ id: 'UpdatePostCategoryDto' });

export const postCategoryIdParamSchema = z
  .strictObject({ categoryId: z.uuid() })
  .meta({ id: 'PostCategoryIdParam' });

export type CreatePostCategoryInput = z.infer<typeof createPostCategorySchema>;
export type UpdatePostCategoryInput = z.infer<typeof updatePostCategorySchema>;

/** A category as the admin manages it. `postCount` counts posts of every status (why a delete is refused). */
export class AdminPostCategoryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'du-lich' }) key!: string;
  @ApiProperty({ example: 'du-lich' }) slug!: string;
  @ApiProperty({ example: 'Du lịch' }) label!: string;
  @ApiProperty({ enum: CATEGORY_STATUSES }) status!: CategoryStatus;
  @ApiProperty() postCount!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

/** An active category on the public blog, with its published posts. */
export class PostCategoryDto {
  @ApiProperty({ example: 'du-lich' }) slug!: string;
  @ApiProperty({ example: 'Du lịch' }) label!: string;
  @ApiProperty() publishedPostCount!: number;
}

/** A post's category on public reads; `null` there when the category is archived. */
export class PostCategoryRefDto {
  @ApiProperty({ example: 'du-lich' }) slug!: string;
  @ApiProperty({ example: 'Du lịch' }) label!: string;
}

/** A post's category in the dashboard, archived ones included. */
export class AdminPostCategoryRefDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'du-lich' }) key!: string;
  @ApiProperty({ example: 'du-lich' }) slug!: string;
  @ApiProperty({ example: 'Du lịch' }) label!: string;
  @ApiProperty({ enum: CATEGORY_STATUSES }) status!: CategoryStatus;
}
