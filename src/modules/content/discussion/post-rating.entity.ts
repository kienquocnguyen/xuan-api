import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Post } from '../post.entity.js';

/** Ratings are hidden and restored, never deleted (owner Q2). */
export const RATING_STATUSES = ['visible', 'hidden'] as const;
export type RatingStatus = (typeof RATING_STATUSES)[number];

/**
 * `content_post_ratings` (database.md §12, spec §6.1): one 1–5 rating per user per post, whatever its status
 * (BD-6). The user FKs are declared by entity name (AD14).
 */
@Entity('content_post_ratings')
@Unique('uq_content_post_ratings_post_id_user_id', ['postId', 'userId'])
@Index('ix_content_post_ratings_user_id', ['userId'])
@Check('ck_content_post_ratings_value', `"value" BETWEEN 1 AND 5`)
@Check('ck_content_post_ratings_status', `"status" IN ('visible', 'hidden')`)
@Check(
  'ck_content_post_ratings_moderation_pair',
  `("moderated_by" IS NULL) = ("moderated_at" IS NULL)`,
)
export class PostRating {
  @PrimaryColumn({
    type: 'uuid',
    default: () => 'uuidv7()',
    primaryKeyConstraintName: 'pk_content_post_ratings',
  })
  id!: string;

  @Column({ name: 'post_id', type: 'uuid' })
  @ForeignKey(() => Post, { name: 'fk_content_post_ratings_post_id', onDelete: 'RESTRICT' })
  postId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @ForeignKey('User', { name: 'fk_content_post_ratings_user_id', onDelete: 'RESTRICT' })
  userId!: string;

  @Column({ type: 'smallint' })
  value!: number;

  @Column({ type: 'varchar', length: 16, default: 'visible' })
  status!: RatingStatus;

  @Column({ name: 'moderated_by', type: 'uuid', nullable: true })
  @ForeignKey('User', { name: 'fk_content_post_ratings_moderated_by', onDelete: 'RESTRICT' })
  moderatedBy!: string | null;

  @Column({ name: 'moderated_at', type: 'timestamptz', nullable: true })
  moderatedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
