import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import type { AuthenticatedUser } from '../../../http/auth/role.js';
import { PostsService } from '../posts.service.js';
import { PostRating } from './post-rating.entity.js';

/** Reader discussion on published posts (blog completion spec §6.2): ratings and comments, always as the session user. */
@Injectable()
export class DiscussionService {
  constructor(
    private readonly posts: PostsService,
    @InjectRepository(PostRating) private readonly ratings: Repository<PostRating>,
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
}
