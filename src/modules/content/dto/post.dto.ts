import { ApiProperty, getSchemaPath } from '@nestjs/swagger';
import type { PublicProfile } from '../../users/user-profiles.reader.js';
import type { PostBodyDocument } from '../body/post-body.schema.js';
import type { Post } from '../post.entity.js';

/** Public author of a post: no id, no email (contract identifier, I19). */
export class PostAuthorDto {
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uri' }) avatarUrl!: string | null;
}

/** A published post in the public list. */
export class PostSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'bai-viet-dau-tien' }) slug!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: String, nullable: true }) excerpt!: string | null;
  @ApiProperty({ format: 'date-time' }) publishedAt!: string;
  /** The last real change; the sitemap's lastmod (blog completion spec §3.3). */
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: PostAuthorDto }) author!: PostAuthorDto;
}

/** A published post, read by slug. */
export class PostDto extends PostSummaryDto {
  @ApiProperty({ example: 'vi' }) language!: string;
  // A recursive document can't be a hand-written class: reference the Zod-generated component (D17 note).
  @ApiProperty({ allOf: [{ $ref: getSchemaPath('PostBodyDocument') }] }) body!: PostBodyDocument;
  @ApiProperty({ example: 1 }) bodyVersion!: number;
  @ApiProperty({ type: String, nullable: true }) seoTitle!: string | null;
  @ApiProperty({ type: String, nullable: true }) seoDescription!: string | null;
  @ApiProperty({ type: [String], example: ['GoPro', 'Đà Lạt'] }) tags!: string[];
}

/** Whitelist by construction: only these fields reach the wire (I10). Callers pass published posts only. */
export function toPostSummaryDto(post: Post, author: PublicProfile): PostSummaryDto {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    publishedAt: publishedAtOf(post),
    updatedAt: post.updatedAt.toISOString(),
    author: { displayName: author.displayName, avatarUrl: author.avatarUrl },
  };
}

export function toPostDto(post: Post, author: PublicProfile): PostDto {
  const summary = toPostSummaryDto(post, author);
  return {
    id: summary.id,
    slug: summary.slug,
    title: summary.title,
    excerpt: summary.excerpt,
    publishedAt: summary.publishedAt,
    updatedAt: summary.updatedAt,
    author: summary.author,
    language: post.language,
    body: post.body,
    bodyVersion: post.bodyVersion,
    seoTitle: post.seoTitle,
    seoDescription: post.seoDescription,
    tags: [...post.tags],
  };
}

function publishedAtOf(post: Post): string {
  if (!post.publishedAt)
    throw new Error('A published post has published_at (ck_content_posts_published_has_date).');
  return post.publishedAt.toISOString();
}
