import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { Roles } from '../../http/auth/auth.decorators.js';
import { ApiEnvelopeResponse } from '../../http/openapi/api-envelope-response.js';
import { ApiErrorResponses } from '../../http/openapi/api-error-responses.js';
import { ApiSchemaParameters } from '../../http/openapi/api-schema-parameters.js';
import { type AdminCategory, CategoriesService } from './categories.service.js';
import { contentErrors } from './content.errors.js';
import {
  AdminPostCategoryDto,
  type CreatePostCategoryInput,
  createPostCategorySchema,
  postCategoryIdParamSchema,
  type UpdatePostCategoryInput,
  updatePostCategorySchema,
} from './dto/category.dto.js';

const { VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND } = baselineErrors;
const { CATEGORY_KEY_TAKEN, CATEGORY_SLUG_TAKEN, CATEGORY_IN_USE } = contentErrors;

type Params = z.infer<typeof postCategoryIdParamSchema>;

/** Whitelist by construction (I10). */
const toDto = (category: AdminCategory): AdminPostCategoryDto => ({
  id: category.id,
  key: category.key,
  slug: category.slug,
  label: category.label,
  status: category.status,
  postCount: category.postCount,
  createdAt: category.createdAt.toISOString(),
  updatedAt: category.updatedAt.toISOString(),
});

/** Category management, admin only (blog completion spec §4.2, BD-11). */
@Roles('admin')
@ApiTags('admin')
@Controller('admin/post-categories')
export class AdminPostCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiEnvelopeResponse(AdminPostCategoryDto, { isArray: true })
  @ApiErrorResponses(UNAUTHENTICATED, FORBIDDEN)
  async list(): Promise<AdminPostCategoryDto[]> {
    return (await this.categories.listAdmin()).map(toDto);
  }

  @Post()
  @ApiEnvelopeResponse(AdminPostCategoryDto, { status: 201 })
  @ApiErrorResponses(
    VALIDATION_FAILED,
    UNAUTHENTICATED,
    FORBIDDEN,
    CATEGORY_KEY_TAKEN,
    CATEGORY_SLUG_TAKEN,
  )
  async create(
    @Body({ schema: createPostCategorySchema }) input: CreatePostCategoryInput,
  ): Promise<AdminPostCategoryDto> {
    return toDto(await this.categories.create(input));
  }

  @Put(':categoryId')
  @ApiSchemaParameters('path', postCategoryIdParamSchema)
  @ApiEnvelopeResponse(AdminPostCategoryDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CATEGORY_SLUG_TAKEN)
  async update(
    @Param({ schema: postCategoryIdParamSchema }) params: Params,
    @Body({ schema: updatePostCategorySchema }) input: UpdatePostCategoryInput,
  ): Promise<AdminPostCategoryDto> {
    return toDto(await this.categories.update(params.categoryId, input));
  }

  @Post(':categoryId/archive')
  @HttpCode(200)
  @ApiSchemaParameters('path', postCategoryIdParamSchema)
  @ApiEnvelopeResponse(AdminPostCategoryDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  async archive(@Param({ schema: postCategoryIdParamSchema }) params: Params) {
    return toDto(await this.categories.setStatus(params.categoryId, 'archived'));
  }

  @Post(':categoryId/restore')
  @HttpCode(200)
  @ApiSchemaParameters('path', postCategoryIdParamSchema)
  @ApiEnvelopeResponse(AdminPostCategoryDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  async restore(@Param({ schema: postCategoryIdParamSchema }) params: Params) {
    return toDto(await this.categories.setStatus(params.categoryId, 'active'));
  }

  @Delete(':categoryId')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'The unused category is deleted.' })
  @ApiSchemaParameters('path', postCategoryIdParamSchema)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CATEGORY_IN_USE)
  async remove(@Param({ schema: postCategoryIdParamSchema }) params: Params): Promise<void> {
    await this.categories.remove(params.categoryId);
  }
}
