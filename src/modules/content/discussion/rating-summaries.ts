import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { PostRating } from './post-rating.entity.js';

/** Visible ratings only (owner Q2); `average` to 2 decimals, `null` without ratings (spec §6.2). */
export type RatingSummary = Readonly<{ average: number | null; count: number }>;

export function toRatingSummary(count: number, sum: number): RatingSummary {
  return { average: count === 0 ? null : Math.round((sum / count) * 100) / 100, count };
}

export const NO_RATINGS = toRatingSummary(0, 0);

/** The posts' rating summaries in one grouped query (kept apart from DiscussionService, which needs PostsService). */
@Injectable()
export class RatingSummaries {
  constructor(@InjectRepository(PostRating) private readonly ratings: Repository<PostRating>) {}

  async forPosts(postIds: readonly string[]): Promise<Map<string, RatingSummary>> {
    const wanted = [...new Set(postIds)];
    if (wanted.length === 0) return new Map();
    const rows = await this.ratings
      .createQueryBuilder('rating')
      .select('rating.post_id', 'postId')
      .addSelect('count(*)::int', 'count')
      .addSelect('sum(rating.value)::int', 'sum')
      .where('rating.post_id IN (:...wanted)', { wanted })
      .andWhere("rating.status = 'visible'")
      .groupBy('rating.post_id')
      .getRawMany<{ postId: string; count: number; sum: number }>();
    return new Map(rows.map((row) => [row.postId, toRatingSummary(row.count, row.sum)]));
  }
}
