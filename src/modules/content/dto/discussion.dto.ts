import { ApiProperty } from '@nestjs/swagger';
import type { PublicProfile } from '../../users/user-profiles.reader.js';
import type { PostComment } from '../discussion/post-comment.entity.js';
import { PostAuthorDto } from './post.dto.js';

/** A visible comment as readers see it (spec §6.2): no author id, no email, no status. */
export class PostCommentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  /** Plain text with `\n` line breaks; the web escapes it (never HTML). */
  @ApiProperty({ example: 'Bài viết rất hay!' }) body!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) editedAt!: string | null;
  @ApiProperty({ type: PostAuthorDto }) author!: PostAuthorDto;
}

/** The signed-in reader's own discussion on a post, so the web can show edit/delete (spec §6.2). */
export class MyPostDiscussionDto {
  /** Their rating in any status (a hidden one still shows to its author). */
  @ApiProperty({ type: Number, nullable: true, example: 4 }) rating!: number | null;
  /** Their visible comments, newest first, at most 500. */
  @ApiProperty({ type: [String], format: 'uuid' }) ownCommentIds!: string[];
}

/** Whitelist by construction (I10). */
export function toPostCommentDto(comment: PostComment, author: PublicProfile): PostCommentDto {
  return {
    id: comment.id,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    editedAt: comment.editedAt ? comment.editedAt.toISOString() : null,
    author: { displayName: author.displayName, avatarUrl: author.avatarUrl },
  };
}
