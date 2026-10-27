import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { AppError } from '../../../errors/app-error.js';
import { baselineErrors } from '../../../errors/baseline-errors.js';
import type { AuthenticatedUser } from '../../../http/auth/role.js';
import { type PublicProfile, UserProfilesReader } from '../../users/user-profiles.reader.js';
import { PostsService, type PostRef } from '../posts.service.js';
import {
  type CommentAction,
  nextCommentStatus,
  nextRatingStatus,
  type RatingAction,
} from './moderation.js';
import { type CommentStatus, PostComment } from './post-comment.entity.js';
import { PostRating, type RatingStatus } from './post-rating.entity.js';

type Moderated = PostComment | PostRating;
export type ModeratedView<T extends Moderated> = Readonly<{
  item: T;
  author: PublicProfile;
  moderator: PublicProfile | null;
  post: PostRef;
}>;
type Filter<S> = Readonly<{ status?: S; postId?: string; page: number; pageSize: number }>;

/** Admin moderation of comments and ratings (blog completion spec §6.3, owner Q2). Not throttled. */
@Injectable()
export class ModerationService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(PostComment) private readonly comments: Repository<PostComment>,
    @InjectRepository(PostRating) private readonly ratings: Repository<PostRating>,
    private readonly posts: PostsService,
    private readonly profiles: UserProfilesReader,
  ) {}

  listComments(filter: Filter<CommentStatus>) {
    return this.list(this.comments, filter);
  }

  listRatings(filter: Filter<RatingStatus>) {
    return this.list(this.ratings, filter);
  }

  async moderateComment(admin: AuthenticatedUser, id: string, action: CommentAction) {
    const item = await this.transition(PostComment, admin, id, (status: CommentStatus) =>
      nextCommentStatus(status, action),
    );
    return (await this.views([item]))[0];
  }

  async moderateRating(admin: AuthenticatedUser, id: string, action: RatingAction) {
    const item = await this.transition(PostRating, admin, id, (status: RatingStatus) =>
      nextRatingStatus(status, action),
    );
    return (await this.views([item]))[0];
  }

  /**
   * The row is locked first, so a concurrent author edit or second admin sees the result. A transition to the
   * current state writes nothing (`updated_at` unchanged); a real one records the admin and the time.
   */
  private async transition<T extends Moderated>(
    entity: new () => T,
    admin: AuthenticatedUser,
    id: string,
    next: (status: T['status']) => T['status'],
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(entity, {
        where: { id } as FindOptionsWhere<T>,
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw new AppError(baselineErrors.NOT_FOUND);
      const status = next(row.status);
      if (status === row.status) return row;
      await manager
        .createQueryBuilder()
        .update(entity)
        .set({ status, moderatedBy: admin.id, moderatedAt: () => 'now()' } as never)
        .where('id = :id', { id })
        .execute();
      return manager.findOneByOrFail(entity, { id } as FindOptionsWhere<T>);
    });
  }

  private async list<T extends Moderated>(repository: Repository<T>, filter: Filter<T['status']>) {
    const where = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.postId ? { postId: filter.postId } : {}),
    } as FindOptionsWhere<T>;
    const [rows, totalItems] = await repository.findAndCount({
      where,
      order: { createdAt: 'DESC', id: 'DESC' } as never,
      skip: (filter.page - 1) * filter.pageSize,
      take: filter.pageSize,
    });
    return { items: await this.views(rows), totalItems };
  }

  /** Authors, moderators and posts for a page: one query each. */
  private async views<T extends Moderated>(rows: T[]): Promise<ModeratedView<T>[]> {
    const [profiles, posts] = await Promise.all([
      this.profiles.findPublicProfiles(
        rows.flatMap((row) => (row.moderatedBy ? [row.userId, row.moderatedBy] : [row.userId])),
      ),
      this.posts.findRefs(rows.map((row) => row.postId)),
    ]);
    const byId = new Map(profiles.map((profile) => [profile.id, profile]));
    return rows.map((item) => {
      const author = byId.get(item.userId);
      const post = posts.get(item.postId);
      if (!author || !post)
        throw new Error('Discussion row without its author or post despite the FKs.');
      return {
        item,
        author,
        moderator: item.moderatedBy ? (byId.get(item.moderatedBy) ?? null) : null,
        post,
      };
    });
  }
}
