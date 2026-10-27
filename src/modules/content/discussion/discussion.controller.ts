import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { baselineErrors } from '../../../errors/baseline-errors.js';
import { CurrentUser, Public } from '../../../http/auth/auth.decorators.js';
import type { AuthenticatedUser } from '../../../http/auth/role.js';
import { ApiEnvelopeResponse } from '../../../http/openapi/api-envelope-response.js';
import { ApiErrorResponses } from '../../../http/openapi/api-error-responses.js';
import { ApiPaginatedEnvelopeResponse } from '../../../http/openapi/api-paginated-envelope-response.js';
import { ApiSchemaParameters } from '../../../http/openapi/api-schema-parameters.js';
import { type Page, toPageInfo } from '../../../http/pagination/page.js';
import { contentErrors } from '../content.errors.js';
import { MyPostDiscussionDto, PostCommentDto, toPostCommentDto } from '../dto/discussion.dto.js';
import {
  type PostCommentIdParam,
  postCommentIdParamSchema,
  type PostCommentsQuery,
  postCommentsQuerySchema,
  type SavePostCommentInput,
  savePostCommentSchema,
  type SavePostRatingInput,
  savePostRatingSchema,
} from '../dto/save-discussion.dto.js';
import { DiscussionService } from './discussion.service.js';
import { DiscussionThrottle } from './discussion-throttle.guard.js';

const { VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, RATE_LIMITED } = baselineErrors;

/** Reader discussion on a published post (blog completion spec §6.2). Signed in; the post slug is an opaque key (D7). */
@ApiTags('posts')
@Controller('posts')
export class DiscussionController {
  constructor(private readonly discussion: DiscussionService) {}

  @Get(':slug/comments')
  @Public()
  @ApiSchemaParameters('query', postCommentsQuerySchema)
  @ApiPaginatedEnvelopeResponse(PostCommentDto)
  @ApiErrorResponses(VALIDATION_FAILED, NOT_FOUND)
  async comments(
    @Param('slug') slug: string,
    @Query({ schema: postCommentsQuerySchema }) query: PostCommentsQuery,
  ): Promise<Page<PostCommentDto>> {
    const { items, totalItems } = await this.discussion.listVisible(slug, query);
    return {
      items: items.map(({ comment, author }) => toPostCommentDto(comment, author)),
      pageInfo: toPageInfo(query.page, query.pageSize, totalItems),
    };
  }

  @Get(':slug/discussion/me')
  @ApiEnvelopeResponse(MyPostDiscussionDto)
  @ApiErrorResponses(UNAUTHENTICATED, NOT_FOUND)
  async mine(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('slug') slug: string,
  ): Promise<MyPostDiscussionDto> {
    const { rating, ownCommentIds } = await this.discussion.mine(actor, slug);
    return { rating, ownCommentIds: [...ownCommentIds] };
  }

  @Put(':slug/rating')
  @HttpCode(204)
  @UseGuards(DiscussionThrottle)
  @ApiNoContentResponse({ description: 'The rating is saved.' })
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, RATE_LIMITED)
  async rate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body({ schema: savePostRatingSchema }) input: SavePostRatingInput,
  ): Promise<void> {
    await this.discussion.saveRating(actor, slug, input.value);
  }

  @Post(':slug/comments')
  @UseGuards(DiscussionThrottle)
  @ApiEnvelopeResponse(PostCommentDto, { status: 201 })
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, RATE_LIMITED)
  async comment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body({ schema: savePostCommentSchema }) input: SavePostCommentInput,
  ): Promise<PostCommentDto> {
    const { comment, author } = await this.discussion.createComment(actor, slug, input.body);
    return toPostCommentDto(comment, author);
  }
}

/** The author's own comment (spec §6.2): only the session user, only while its post is published. */
@ApiTags('posts')
@Controller('post-comments')
export class PostCommentsController {
  constructor(private readonly discussion: DiscussionService) {}

  @Put(':commentId')
  @UseGuards(DiscussionThrottle)
  @ApiSchemaParameters('path', postCommentIdParamSchema)
  @ApiEnvelopeResponse(PostCommentDto)
  @ApiErrorResponses(
    VALIDATION_FAILED,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    RATE_LIMITED,
    contentErrors.COMMENT_NOT_EDITABLE,
  )
  async edit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param({ schema: postCommentIdParamSchema }) params: PostCommentIdParam,
    @Body({ schema: savePostCommentSchema }) input: SavePostCommentInput,
  ): Promise<PostCommentDto> {
    const { comment, author } = await this.discussion.editComment(
      actor,
      params.commentId,
      input.body,
    );
    return toPostCommentDto(comment, author);
  }

  @Delete(':commentId')
  @HttpCode(204)
  @UseGuards(DiscussionThrottle)
  @ApiSchemaParameters('path', postCommentIdParamSchema)
  @ApiNoContentResponse({ description: 'The comment is deleted, for good.' })
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, RATE_LIMITED)
  async remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param({ schema: postCommentIdParamSchema }) params: PostCommentIdParam,
  ): Promise<void> {
    await this.discussion.deleteComment(actor, params.commentId);
  }
}
