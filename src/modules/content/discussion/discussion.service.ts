import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AppError } from '../../../errors/app-error.js';
import { baselineErrors } from '../../../errors/baseline-errors.js';
import type { AuthenticatedUser } from '../../../http/auth/role.js';
import { type PublicProfile, UserProfilesReader } from '../../users/user-profiles.reader.js';
import { contentErrors } from '../content.errors.js';
import { PostsService } from '../posts.service.js';
import { PostComment } from './post-comment.entity.js';
import { PostRating } from './post-rating.entity.js';

export type CommentView = Readonly<{ comment: PostComment; author: PublicProfile }>;

/** Reader discussion on published posts (blog completion spec §6.2): ratings and comments, always as the session user. */
@Injectable()
export class DiscussionService {
  constructor(
    private readonly posts: PostsService,
    private readonly profiles: UserProfilesReader,
    @InjectRepository(PostRating) private readonly ratings: Repository<PostRating>,
    @InjectRepository(PostComment) private readonly comments: Repository<PostComment>,
  ) {}

  /**
   * One upsert on the named unique (D32): a repeat changes the value and keeps `status`, so a hidden rating
   * stays hidden (BD-6, Q2). Concurrent first ratings by one user end in one row.
   */
  async saveRating(actor: AuthenticatedUser, slug: string, value: number): Promise<void> {
    const postId = await this.posts.findPublishedId(slug);
    await this.ratings
      .createQueryBuilder()
      .insert()
      .into(PostRating)
      .values({ postId, userId: actor.id, value })
      .orUpdate(['value', 'updated_at'], 'uq_content_post_ratings_post_id_user_id')
      .execute();
  }

  async createComment(actor: AuthenticatedUser, slug: string, body: string): Promise<CommentView> {
    const postId = await this.posts.findPublishedId(slug);
    const result = await this.comments.insert({ postId, userId: actor.id, body });
    return this.view((result.identifiers[0] as { id: string }).id);
  }

  /** The author edits a visible comment on a published post; the guarded update closes the race with moderation. */
  async editComment(actor: AuthenticatedUser, id: string, body: string): Promise<CommentView> {
    const comment = await this.ownComment(actor, id);
    if (comment.status !== 'visible') throw new AppError(contentErrors.COMMENT_NOT_EDITABLE);
    const result = await this.comments.update(
      { id, status: 'visible' },
      { body, editedAt: () => 'now()' },
    );
    if (result.affected !== 1) throw new AppError(contentErrors.COMMENT_NOT_EDITABLE);
    return this.view(id);
  }

  /** Final for everyone (Q2). A hidden comment may still be deleted by its author; a repeat writes nothing. */
  async deleteComment(actor: AuthenticatedUser, id: string): Promise<void> {
    const comment = await this.ownComment(actor, id);
    if (comment.status === 'deleted') return;
    await this.comments.update({ id }, { status: 'deleted' });
  }

  /** Missing, or on a post that isn't published → 404 (no existence leak); someone else's → 403. */
  private async ownComment(actor: AuthenticatedUser, id: string): Promise<PostComment> {
    const comment = await this.comments.findOneBy({ id });
    if (!comment || !(await this.posts.isPublished(comment.postId))) {
      throw new AppError(baselineErrors.NOT_FOUND);
    }
    if (comment.userId !== actor.id) throw new AppError(baselineErrors.FORBIDDEN);
    return comment;
  }

  private async view(id: string): Promise<CommentView> {
    const comment = await this.comments.findOneByOrFail({ id });
    const [author] = await this.profiles.findPublicProfiles([comment.userId]);
    if (!author)
      throw new Error('Comment author missing despite fk_content_post_comments_user_id.');
    return { comment, author };
  }
}
