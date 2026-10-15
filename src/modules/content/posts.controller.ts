import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { Public } from '../../http/auth/auth.decorators.js';
import { ApiEnvelopeResponse } from '../../http/openapi/api-envelope-response.js';
import { ApiErrorResponses } from '../../http/openapi/api-error-responses.js';
import { ApiPaginatedEnvelopeResponse } from '../../http/openapi/api-paginated-envelope-response.js';
import { ApiSchemaParameters } from '../../http/openapi/api-schema-parameters.js';
import { type Page, toPageInfo } from '../../http/pagination/page.js';
import { PostDto, PostSummaryDto, toPostDto, toPostSummaryDto } from './dto/post.dto.js';
import { postsPageQuerySchema } from './dto/post-queries.dto.js';
import { PostsService } from './posts.service.js';

/** The public blog: published posts only (blog spec §5.1). */
@Public()
@ApiTags('posts')
@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  @ApiSchemaParameters('query', postsPageQuerySchema)
  @ApiPaginatedEnvelopeResponse(PostSummaryDto)
  @ApiErrorResponses(baselineErrors.VALIDATION_FAILED)
  async list(
    @Query({ schema: postsPageQuerySchema }) query: z.infer<typeof postsPageQuerySchema>,
  ): Promise<Page<PostSummaryDto>> {
    const { items, totalItems } = await this.posts.listPublished(query);
    return {
      items: items.map(({ post, author }) => toPostSummaryDto(post, author)),
      pageInfo: toPageInfo(query.page, query.pageSize, totalItems),
    };
  }

  @Get(':slug')
  @ApiEnvelopeResponse(PostDto)
  @ApiErrorResponses(baselineErrors.NOT_FOUND)
  async getBySlug(@Param('slug') slug: string): Promise<PostDto> {
    // D7 deviation (blog spec §5.1, as /services/:slug): the slug is an opaque lookup key.
    const { post, author } = await this.posts.getPublishedBySlug(slug);
    return toPostDto(post, author);
  }
}
