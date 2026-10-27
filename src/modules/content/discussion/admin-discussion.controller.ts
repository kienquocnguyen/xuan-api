import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { baselineErrors } from '../../../errors/baseline-errors.js';
import { CurrentUser, Roles } from '../../../http/auth/auth.decorators.js';
import type { AuthenticatedUser } from '../../../http/auth/role.js';
import { ApiEnvelopeResponse } from '../../../http/openapi/api-envelope-response.js';
import { ApiErrorResponses } from '../../../http/openapi/api-error-responses.js';
import { ApiPaginatedEnvelopeResponse } from '../../../http/openapi/api-paginated-envelope-response.js';
import { ApiSchemaParameters } from '../../../http/openapi/api-schema-parameters.js';
import { type Page, toPageInfo } from '../../../http/pagination/page.js';
import { contentErrors } from '../content.errors.js';
import {
  type AdminPostCommentsQuery,
  adminPostCommentsQuerySchema,
  AdminPostCommentDto,
  type AdminPostRatingsQuery,
  adminPostRatingsQuerySchema,
  AdminPostRatingDto,
  type PostRatingIdParam,
  postRatingIdParamSchema,
  toAdminPostCommentDto,
  toAdminPostRatingDto,
} from '../dto/admin-discussion.dto.js';
import { type PostCommentIdParam, postCommentIdParamSchema } from '../dto/save-discussion.dto.js';
import { type ModeratedView, ModerationService } from './moderation.service.js';
import type { PostComment } from './post-comment.entity.js';
import type { PostRating } from './post-rating.entity.js';

const { VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND } = baselineErrors;
const comment = ({ item, ...people }: ModeratedView<PostComment>) =>
  toAdminPostCommentDto(item, people);
const rating = ({ item, ...people }: ModeratedView<PostRating>) =>
  toAdminPostRatingDto(item, people);

/** Moderation (blog completion spec §6.3): admins only; editors and readers → 403. */
@Roles('admin')
@ApiTags('admin')
@Controller('admin')
export class AdminDiscussionController {
  constructor(private readonly moderation: ModerationService) {}

  @Get('post-comments')
  @ApiSchemaParameters('query', adminPostCommentsQuerySchema)
  @ApiPaginatedEnvelopeResponse(AdminPostCommentDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN)
  async comments(
    @Query({ schema: adminPostCommentsQuerySchema }) query: AdminPostCommentsQuery,
  ): Promise<Page<AdminPostCommentDto>> {
    const { items, totalItems } = await this.moderation.listComments(query);
    return {
      items: items.map(comment),
      pageInfo: toPageInfo(query.page, query.pageSize, totalItems),
    };
  }

  @Get('post-ratings')
  @ApiSchemaParameters('query', adminPostRatingsQuerySchema)
  @ApiPaginatedEnvelopeResponse(AdminPostRatingDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN)
  async ratings(
    @Query({ schema: adminPostRatingsQuerySchema }) query: AdminPostRatingsQuery,
  ): Promise<Page<AdminPostRatingDto>> {
    const { items, totalItems } = await this.moderation.listRatings(query);
    return {
      items: items.map(rating),
      pageInfo: toPageInfo(query.page, query.pageSize, totalItems),
    };
  }

  // One route per action keeps each documented and pinned; the path names the action.
  @Post('post-comments/:commentId/hide')
  @HttpCode(200)
  @ApiSchemaParameters('path', postCommentIdParamSchema)
  @ApiEnvelopeResponse(AdminPostCommentDto)
  @ApiErrorResponses(
    VALIDATION_FAILED,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    contentErrors.COMMENT_DELETED,
  )
  async hideComment(
    @CurrentUser() admin: AuthenticatedUser,
    @Param({ schema: postCommentIdParamSchema }) params: PostCommentIdParam,
  ): Promise<AdminPostCommentDto> {
    return comment(await this.moderation.moderateComment(admin, params.commentId, 'hide'));
  }

  @Post('post-comments/:commentId/restore')
  @HttpCode(200)
  @ApiSchemaParameters('path', postCommentIdParamSchema)
  @ApiEnvelopeResponse(AdminPostCommentDto)
  @ApiErrorResponses(
    VALIDATION_FAILED,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    contentErrors.COMMENT_DELETED,
  )
  async restoreComment(
    @CurrentUser() admin: AuthenticatedUser,
    @Param({ schema: postCommentIdParamSchema }) params: PostCommentIdParam,
  ): Promise<AdminPostCommentDto> {
    return comment(await this.moderation.moderateComment(admin, params.commentId, 'restore'));
  }

  @Post('post-comments/:commentId/delete')
  @HttpCode(200)
  @ApiSchemaParameters('path', postCommentIdParamSchema)
  @ApiEnvelopeResponse(AdminPostCommentDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  async deleteComment(
    @CurrentUser() admin: AuthenticatedUser,
    @Param({ schema: postCommentIdParamSchema }) params: PostCommentIdParam,
  ): Promise<AdminPostCommentDto> {
    return comment(await this.moderation.moderateComment(admin, params.commentId, 'delete'));
  }

  @Post('post-ratings/:ratingId/hide')
  @HttpCode(200)
  @ApiSchemaParameters('path', postRatingIdParamSchema)
  @ApiEnvelopeResponse(AdminPostRatingDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  async hideRating(
    @CurrentUser() admin: AuthenticatedUser,
    @Param({ schema: postRatingIdParamSchema }) params: PostRatingIdParam,
  ): Promise<AdminPostRatingDto> {
    return rating(await this.moderation.moderateRating(admin, params.ratingId, 'hide'));
  }

  @Post('post-ratings/:ratingId/restore')
  @HttpCode(200)
  @ApiSchemaParameters('path', postRatingIdParamSchema)
  @ApiEnvelopeResponse(AdminPostRatingDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  async restoreRating(
    @CurrentUser() admin: AuthenticatedUser,
    @Param({ schema: postRatingIdParamSchema }) params: PostRatingIdParam,
  ): Promise<AdminPostRatingDto> {
    return rating(await this.moderation.moderateRating(admin, params.ratingId, 'restore'));
  }
}
