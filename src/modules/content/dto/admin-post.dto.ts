import { ApiProperty, getSchemaPath } from '@nestjs/swagger';
import type { PublicProfile } from '../../users/user-profiles.reader.js';
import type { CategoryRef } from '../categories.service.js';
import type { MediaImage } from '../media/media.service.js';
import { AdminPostImageDto, type PostImageDto } from './media.dto.js';
import { coverImageOf, ogImageOf } from './post.dto.js';
import { AdminPostCategoryRefDto } from './category.dto.js';
import type { PostBodyDocument } from '../body/post-body.schema.js';
import { POST_STATUSES, type Post, type PostStatus } from '../post.entity.js';

/** The author as the dashboard sees them (contract identifier, I19). No email. */
export class AdminPostAuthorDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uri' }) avatarUrl!: string | null;
}

/** A post in the authoring list. */
export class AdminPostSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'bai-viet-dau-tien' }) slug!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: POST_STATUSES }) status!: PostStatus;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) publishedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: AdminPostAuthorDto }) author!: AdminPostAuthorDto;
  @ApiProperty({ type: [String], example: ['GoPro', 'Đà Lạt'] }) tags!: string[];
  @ApiProperty({ type: AdminPostCategoryRefDto, nullable: true })
  category!: AdminPostCategoryRefDto | null;
  @ApiProperty({ type: AdminPostImageDto, nullable: true }) coverImage!: AdminPostImageDto | null;
  @ApiProperty({ type: AdminPostImageDto, nullable: true }) ogImage!: AdminPostImageDto | null;
}

type Images = Readonly<{ cover: MediaImage | null; og: MediaImage | null }>;

/** A post as its author (or an admin) edits it. */
export class AdminPostDto extends AdminPostSummaryDto {
  @ApiProperty({ example: 'vi' }) language!: string;
  @ApiProperty({ type: String, nullable: true }) excerpt!: string | null;
  // A recursive document can't be a hand-written class: reference the Zod-generated component (D17 note).
  @ApiProperty({ allOf: [{ $ref: getSchemaPath('PostBodyDocument') }] }) body!: PostBodyDocument;
  @ApiProperty({ example: 1 }) bodyVersion!: number;
  @ApiProperty({ type: String, nullable: true }) seoTitle!: string | null;
  @ApiProperty({ type: String, nullable: true }) seoDescription!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  /**
   * The stored references, exactly as `SavePostDto` takes them back. Present even when this server can't build
   * image URLs (`MEDIA_STORAGE=disabled` without a base), so a full save never drops them (B3 pre-deployment fix).
   */
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) coverMediaId!: string | null;
  @ApiProperty({ type: String, nullable: true }) coverAlt!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) ogMediaId!: string | null;
}

/** Whitelist by construction: only these fields reach the wire (I10). */
export function toAdminPostSummaryDto(
  post: Post,
  author: PublicProfile,
  category: CategoryRef | null,
  images: Images,
): AdminPostSummaryDto {
  const cover = coverImageOf(post, images);
  const og = ogImageOf(post, images);
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    status: post.status,
    publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
    updatedAt: post.updatedAt.toISOString(),
    author: { id: author.id, displayName: author.displayName, avatarUrl: author.avatarUrl },
    tags: [...post.tags],
    category: category
      ? {
          id: category.id,
          key: category.key,
          slug: category.slug,
          label: category.label,
          status: category.status,
        }
      : null,
    coverImage: withMediaId(cover, post.coverMediaId),
    ogImage: withMediaId(og, post.ogMediaId),
  };
}

function withMediaId(image: PostImageDto | null, mediaId: string | null): AdminPostImageDto | null {
  if (!image || !mediaId) return null;
  const { url, width, height, alt, variants } = image;
  return { mediaId, url, width, height, alt, variants };
}

export function toAdminPostDto(
  post: Post,
  author: PublicProfile,
  category: CategoryRef | null,
  images: Images,
): AdminPostDto {
  const summary = toAdminPostSummaryDto(post, author, category, images);
  return {
    id: summary.id,
    slug: summary.slug,
    title: summary.title,
    status: summary.status,
    publishedAt: summary.publishedAt,
    updatedAt: summary.updatedAt,
    author: summary.author,
    tags: summary.tags,
    category: summary.category,
    coverImage: summary.coverImage,
    ogImage: summary.ogImage,
    language: post.language,
    excerpt: post.excerpt,
    body: post.body,
    bodyVersion: post.bodyVersion,
    seoTitle: post.seoTitle,
    seoDescription: post.seoDescription,
    createdAt: post.createdAt.toISOString(),
    coverMediaId: post.coverMediaId,
    coverAlt: post.coverAlt,
    ogMediaId: post.ogMediaId,
  };
}
