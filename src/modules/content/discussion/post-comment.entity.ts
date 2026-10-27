import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Post } from '../post.entity.js';

/** `deleted` is terminal for everyone (owner Q2). */
export const COMMENT_STATUSES = ['visible', 'hidden', 'deleted'] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

/**
 * `content_post_comments` (database.md §12, spec §6.1): a reader's plain-text comment on a post. Never
 * hard-deleted in V1; the author's deletion and moderation change `status`.
 */
@Entity('content_post_comments')
@Index('ix_content_post_comments_post_id_status_created_at_id', [
  'postId',
  'status',
  'createdAt',
  'id',
])
@Index('ix_content_post_comments_user_id', ['userId'])
@Check('ck_content_post_comments_body_not_blank', `"body" ~ '[^[:space:]]'`)
@Check('ck_content_post_comments_status', `"status" IN ('visible', 'hidden', 'deleted')`)
@Check(
  'ck_content_post_comments_moderation_pair',
  `("moderated_by" IS NULL) = ("moderated_at" IS NULL)`,
)
export class PostComment {
  @PrimaryColumn({
    type: 'uuid',
    default: () => 'uuidv7()',
    primaryKeyConstraintName: 'pk_content_post_comments',
  })
  id!: string;

  @Column({ name: 'post_id', type: 'uuid' })
  @ForeignKey(() => Post, { name: 'fk_content_post_comments_post_id', onDelete: 'RESTRICT' })
  postId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @ForeignKey('User', { name: 'fk_content_post_comments_user_id', onDelete: 'RESTRICT' })
  userId!: string;

  @Column({ type: 'varchar', length: 2000 })
  body!: string;

  @Column({ type: 'varchar', length: 16, default: 'visible' })
  status!: CommentStatus;

  /** Set by the author's edit only, never by moderation. */
  @Column({ name: 'edited_at', type: 'timestamptz', nullable: true })
  editedAt!: Date | null;

  @Column({ name: 'moderated_by', type: 'uuid', nullable: true })
  @ForeignKey('User', { name: 'fk_content_post_comments_moderated_by', onDelete: 'RESTRICT' })
  moderatedBy!: string | null;

  @Column({ name: 'moderated_at', type: 'timestamptz', nullable: true })
  moderatedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
