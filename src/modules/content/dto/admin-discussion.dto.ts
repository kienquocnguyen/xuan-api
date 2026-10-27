import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { pageQueryFields } from '../../../http/pagination/page.js';
import type { PublicProfile } from '../../users/user-profiles.reader.js';
import {
  COMMENT_STATUSES,
  type CommentStatus,
  type PostComment,
} from '../discussion/post-comment.entity.js';
import {
  RATING_STATUSES,
  type PostRating,
  type RatingStatus,
} from '../discussion/post-rating.entity.js';
import type { PostRef } from '../posts.service.js';
import { AdminPostAuthorDto } from './admin-post.dto.js';

export const adminPostCommentsQuerySchema = z
  .strictObject({
    status: z.enum(COMMENT_STATUSES).optional(),
    postId: z.uuid().optional(),
    ...pageQueryFields,
  })
  .meta({ id: 'AdminPostCommentsQuery' });
export type AdminPostCommentsQuery = z.infer<typeof adminPostCommentsQuerySchema>;

export const adminPostRatingsQuerySchema = z
  .strictObject({
    status: z.enum(RATING_STATUSES).optional(),
    postId: z.uuid().optional(),
    ...pageQueryFields,
  })
  .meta({ id: 'AdminPostRatingsQuery' });
export type AdminPostRatingsQuery = z.infer<typeof adminPostRatingsQuerySchema>;

export const postRatingIdParamSchema = z
  .strictObject({ ratingId: z.uuid() })
  .meta({ id: 'PostRatingIdParam' });
export type PostRatingIdParam = z.infer<typeof postRatingIdParamSchema>;

/** The post a discussion item belongs to, in any status. */
export class AdminDiscussionPostRefDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'quay-gopro-da-lat' }) slug!: string;
  @ApiProperty({ example: 'Quay GoPro ở Đà Lạt' }) title!: string;
}

/** A comment as admins moderate it (spec §6.3): every status, no emails. */
export class AdminPostCommentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: AdminDiscussionPostRefDto }) post!: AdminDiscussionPostRefDto;
  @ApiProperty({ type: AdminPostAuthorDto }) author!: AdminPostAuthorDto;
  @ApiProperty() body!: string;
  @ApiProperty({ enum: COMMENT_STATUSES }) status!: CommentStatus;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) editedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) moderatedAt!: string | null;
  @ApiProperty({ type: AdminPostAuthorDto, nullable: true })
  moderatedBy!: AdminPostAuthorDto | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

/** A rating as admins moderate it: the comment shape with `value` in place of the body fields. */
export class AdminPostRatingDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: AdminDiscussionPostRefDto }) post!: AdminDiscussionPostRefDto;
  @ApiProperty({ type: AdminPostAuthorDto }) author!: AdminPostAuthorDto;
  @ApiProperty({ minimum: 1, maximum: 5, example: 4 }) value!: number;
  @ApiProperty({ enum: RATING_STATUSES }) status!: RatingStatus;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) moderatedAt!: string | null;
  @ApiProperty({ type: AdminPostAuthorDto, nullable: true })
  moderatedBy!: AdminPostAuthorDto | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

type People = Readonly<{ author: PublicProfile; moderator: PublicProfile | null; post: PostRef }>;

const person = ({ id, displayName, avatarUrl }: PublicProfile) => ({ id, displayName, avatarUrl });
const postRef = ({ id, slug, title }: PostRef) => ({ id, slug, title });

/** Whitelist by construction (I10). */
export function toAdminPostCommentDto(comment: PostComment, people: People): AdminPostCommentDto {
  return {
    id: comment.id,
    post: postRef(people.post),
    author: person(people.author),
    body: comment.body,
    status: comment.status,
    editedAt: comment.editedAt ? comment.editedAt.toISOString() : null,
    moderatedAt: comment.moderatedAt ? comment.moderatedAt.toISOString() : null,
    moderatedBy: people.moderator ? person(people.moderator) : null,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  };
}

export function toAdminPostRatingDto(rating: PostRating, people: People): AdminPostRatingDto {
  return {
    id: rating.id,
    post: postRef(people.post),
    author: person(people.author),
    value: rating.value,
    status: rating.status,
    moderatedAt: rating.moderatedAt ? rating.moderatedAt.toISOString() : null,
    moderatedBy: people.moderator ? person(people.moderator) : null,
    createdAt: rating.createdAt.toISOString(),
    updatedAt: rating.updatedAt.toISOString(),
  };
}
