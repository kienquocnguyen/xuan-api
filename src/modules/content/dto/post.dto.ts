import { ApiProperty, getSchemaPath } from '@nestjs/swagger';
import type { PublicProfile } from '../../users/user-profiles.reader.js';
import type { CategoryRef } from '../categories.service.js';
import type { MediaImage } from '../media/media.service.js';
import { PostImageDto } from './media.dto.js';
import { PostCategoryRefDto } from './category.dto.js';
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
  /** `null` without a category or when it is archived (blog completion spec §4.3). */
  @ApiProperty({ type: PostCategoryRefDto, nullable: true }) category!: PostCategoryRefDto | null;
  /** Blog completion B3 (spec §5.4). */
  @ApiProperty({ type: PostImageDto, nullable: true }) coverImage!: PostImageDto | null;
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
  /** The share image override; its alt is the cover's, else the title. The web falls back to the cover. */
  @ApiProperty({ type: PostImageDto, nullable: true }) ogImage!: PostImageDto | null;
}

type Images = Readonly<{ cover: MediaImage | null; og: MediaImage | null }>;

/** Whitelist by construction (I10). */
export function toPostImageDto(image: MediaImage | null, alt: string): PostImageDto | null {
  if (!image) return null;
  const variants = image.variants.map(({ width, height, url }) => ({ width, height, url }));
  return { url: image.url, width: image.width, height: image.height, alt, variants };
}

export function coverImageOf(post: Post, images: Images): PostImageDto | null {
  return toPostImageDto(images.cover, post.coverAlt ?? post.title);
}

export function ogImageOf(post: Post, images: Images): PostImageDto | null {
  return toPostImageDto(images.og, post.coverAlt ?? post.title);
}

/** Whitelist by construction: only these fields reach the wire (I10). Callers pass published posts only. */
export function toPostSummaryDto(
  post: Post,
  author: PublicProfile,
  category: CategoryRef | null,
  images: Images,
): PostSummaryDto {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    publishedAt: publishedAtOf(post),
    updatedAt: post.updatedAt.toISOString(),
    author: { displayName: author.displayName, avatarUrl: author.avatarUrl },
    category: category?.status === 'active' ? { slug: category.slug, label: category.label } : null,
    coverImage: coverImageOf(post, images),
  };
}

export function toPostDto(
  post: Post,
  author: PublicProfile,
  category: CategoryRef | null,
  images: Images,
): PostDto {
  const summary = toPostSummaryDto(post, author, category, images);
  return {
    id: summary.id,
    slug: summary.slug,
    title: summary.title,
    excerpt: summary.excerpt,
    publishedAt: summary.publishedAt,
    updatedAt: summary.updatedAt,
    author: summary.author,
    category: summary.category,
    coverImage: summary.coverImage,
    language: post.language,
    body: post.body,
    bodyVersion: post.bodyVersion,
    seoTitle: post.seoTitle,
    seoDescription: post.seoDescription,
    tags: [...post.tags],
    ogImage: ogImageOf(post, images),
  };
}

function publishedAtOf(post: Post): string {
  if (!post.publishedAt)
    throw new Error('A published post has published_at (ck_content_posts_published_has_date).');
  return post.publishedAt.toISOString();
}
