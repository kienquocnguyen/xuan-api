import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { CurrentUser, Roles } from '../../http/auth/auth.decorators.js';
import type { AuthenticatedUser } from '../../http/auth/role.js';
import { ApiEnvelopeResponse } from '../../http/openapi/api-envelope-response.js';
import { ApiErrorResponses } from '../../http/openapi/api-error-responses.js';
import { ApiPaginatedEnvelopeResponse } from '../../http/openapi/api-paginated-envelope-response.js';
import { ApiSchemaParameters } from '../../http/openapi/api-schema-parameters.js';
import { type Page, toPageInfo } from '../../http/pagination/page.js';
import { contentErrors } from './content.errors.js';
import {
  AdminPostDto,
  AdminPostSummaryDto,
  toAdminPostDto,
  toAdminPostSummaryDto,
} from './dto/admin-post.dto.js';
import { adminPostsQuerySchema, postIdParamSchema } from './dto/post-queries.dto.js';
import { type SavePostInput, savePostSchema } from './dto/save-post.dto.js';
import { type AuthoredPost, PostsService } from './posts.service.js';

const { VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND } = baselineErrors;
const {
  POST_SLUG_TAKEN,
  POST_SLUG_LOCKED,
  POST_BODY_EMPTY,
  POST_ARCHIVED,
  POST_WAS_PUBLISHED,
  POST_FIELDS_OMITTED,
  POST_CATEGORY_REQUIRED,
  CATEGORY_NOT_FOUND,
  CATEGORY_ARCHIVED,
  POST_MEDIA_NOT_FOUND,
  POST_MEDIA_INCOMPLETE,
  POST_BODY_VERSION_UNSUPPORTED,
} = contentErrors;

type PostIdParam = z.infer<typeof postIdParamSchema>;
const toDto = ({ post, author, category, cover, og }: AuthoredPost) =>
  toAdminPostDto(post, author, category, { cover, og });

/**
 * Authoring for editors and admins (blog spec §5.2). Ownership is checked by the service after loading the
 * post: an editor manages and reads only their own posts; an admin any.
 */
@Roles('editor', 'admin')
@ApiTags('admin')
@Controller('admin/posts')
export class AdminPostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  @ApiSchemaParameters('query', adminPostsQuerySchema)
  @ApiPaginatedEnvelopeResponse(AdminPostSummaryDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN)
  async list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query({ schema: adminPostsQuerySchema }) query: z.infer<typeof adminPostsQuerySchema>,
  ): Promise<Page<AdminPostSummaryDto>> {
    const { items, totalItems } = await this.posts.listForActor(actor, query.status, query);
    return {
      items: items.map(({ post, author, category, cover, og }) =>
        toAdminPostSummaryDto(post, author, category, { cover, og }),
      ),
      pageInfo: toPageInfo(query.page, query.pageSize, totalItems),
    };
  }

  @Get(':id')
  @ApiSchemaParameters('path', postIdParamSchema)
  @ApiEnvelopeResponse(AdminPostDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  async get(
    @CurrentUser() actor: AuthenticatedUser,
    @Param({ schema: postIdParamSchema }) params: PostIdParam,
  ): Promise<AdminPostDto> {
    return toDto(await this.posts.getForActor(actor, params.id));
  }

  @Post()
  @ApiEnvelopeResponse(AdminPostDto, { status: 201 })
  @ApiErrorResponses(
    VALIDATION_FAILED,
    UNAUTHENTICATED,
    FORBIDDEN,
    POST_SLUG_TAKEN,
    CATEGORY_NOT_FOUND,
    CATEGORY_ARCHIVED,
    POST_MEDIA_NOT_FOUND,
  )
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body({ schema: savePostSchema }) input: SavePostInput,
  ): Promise<AdminPostDto> {
    return toDto(await this.posts.create(actor, input));
  }

  @Put(':id')
  @ApiSchemaParameters('path', postIdParamSchema)
  @ApiEnvelopeResponse(AdminPostDto)
  @ApiErrorResponses(
    VALIDATION_FAILED,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    POST_SLUG_TAKEN,
    POST_SLUG_LOCKED,
    POST_BODY_EMPTY,
    POST_FIELDS_OMITTED,
    POST_CATEGORY_REQUIRED,
    CATEGORY_NOT_FOUND,
    CATEGORY_ARCHIVED,
    POST_MEDIA_NOT_FOUND,
    POST_MEDIA_INCOMPLETE,
    POST_BODY_VERSION_UNSUPPORTED,
  )
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param({ schema: postIdParamSchema }) params: PostIdParam,
    @Body({ schema: savePostSchema }) input: SavePostInput,
  ): Promise<AdminPostDto> {
    return toDto(await this.posts.update(actor, params.id, input));
  }

  @Post(':id/publish')
  @HttpCode(200)
  @ApiSchemaParameters('path', postIdParamSchema)
  @ApiEnvelopeResponse(AdminPostDto)
  @ApiErrorResponses(
    VALIDATION_FAILED,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    POST_BODY_EMPTY,
    POST_ARCHIVED,
    POST_CATEGORY_REQUIRED,
    CATEGORY_ARCHIVED,
    POST_MEDIA_INCOMPLETE,
  )
  async publish(
    @CurrentUser() actor: AuthenticatedUser,
    @Param({ schema: postIdParamSchema }) params: PostIdParam,
  ): Promise<AdminPostDto> {
    return toDto(await this.posts.publish(actor, params.id));
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @ApiSchemaParameters('path', postIdParamSchema)
  @ApiEnvelopeResponse(AdminPostDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, POST_ARCHIVED)
  async unpublish(
    @CurrentUser() actor: AuthenticatedUser,
    @Param({ schema: postIdParamSchema }) params: PostIdParam,
  ): Promise<AdminPostDto> {
    return toDto(await this.posts.unpublish(actor, params.id));
  }

  @Post(':id/archive')
  @HttpCode(200)
  @ApiSchemaParameters('path', postIdParamSchema)
  @ApiEnvelopeResponse(AdminPostDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  async archive(
    @CurrentUser() actor: AuthenticatedUser,
    @Param({ schema: postIdParamSchema }) params: PostIdParam,
  ): Promise<AdminPostDto> {
    return toDto(await this.posts.archive(actor, params.id));
  }

  @Post(':id/restore')
  @HttpCode(200)
  @ApiSchemaParameters('path', postIdParamSchema)
  @ApiEnvelopeResponse(AdminPostDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  async restore(
    @CurrentUser() actor: AuthenticatedUser,
    @Param({ schema: postIdParamSchema }) params: PostIdParam,
  ): Promise<AdminPostDto> {
    return toDto(await this.posts.restore(actor, params.id));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiSchemaParameters('path', postIdParamSchema)
  @ApiNoContentResponse({ description: 'The never-published draft is deleted.' })
  @ApiErrorResponses(
    VALIDATION_FAILED,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    POST_WAS_PUBLISHED,
    POST_ARCHIVED,
  )
  async remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param({ schema: postIdParamSchema }) params: PostIdParam,
  ): Promise<void> {
    await this.posts.remove(actor, params.id);
  }
}
