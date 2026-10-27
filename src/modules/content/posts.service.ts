import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { type DataSource, type EntityManager, In, IsNull, Not, type Repository } from 'typeorm';
import { isForeignKeyViolation, isUniqueViolation } from '../../database/postgres-errors.js';
import { AppError } from '../../errors/app-error.js';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { assertCanManageOwnedResource } from '../../http/auth/ownership.js';
import type { AuthenticatedUser } from '../../http/auth/role.js';
import { type PublicProfile, UserProfilesReader } from '../users/user-profiles.reader.js';
import {
  canonicalizePostBody,
  collectMediaSources,
  fitsBodyVersion1,
  hasIncompleteMedia,
  hasMeaningfulText,
} from './body/post-body-content.js';
import { CategoriesService, type CategoryRef } from './categories.service.js';
import { contentErrors } from './content.errors.js';
import { POST_SLUG_PATTERN, type SavePostInput } from './dto/save-post.dto.js';
import { NO_RATINGS, RatingSummaries, type RatingSummary } from './discussion/rating-summaries.js';
import { type MediaImage, MediaService } from './media/media.service.js';
import { declaresOlderBody, omittedFieldsWithData } from './post-compatibility.js';
import { POST_LANGUAGE, Post, type PostStatus } from './post.entity.js';

export type AuthoredPost = Readonly<{
  post: Post;
  author: PublicProfile;
  category: CategoryRef | null;
  /** `null` without one, or when this server can't build media URLs (storage disabled). */
  cover: MediaImage | null;
  og: MediaImage | null;
  /** Visible ratings (blog completion B4); shown on public DTOs only. */
  rating: RatingSummary;
}>;
export type PostPage = Readonly<{ items: AuthoredPost[]; totalItems: number }>;
/** What moderation shows of a post, in any status (blog completion B4). */
export type PostRef = Readonly<{ id: string; slug: string; title: string }>;
type Paging = Readonly<{ page: number; pageSize: number }>;

const RELATED_LIMIT = 3;

/** Blog posts use cases (blog spec §6). */
@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(Post) private readonly posts: Repository<Post>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly profiles: UserProfilesReader,
    private readonly categories: CategoriesService,
    private readonly media: MediaService,
    private readonly ratingSummaries: RatingSummaries,
  ) {}

  async listPublished({
    page,
    pageSize,
    category,
  }: Paging & { category?: string }): Promise<PostPage> {
    let categoryId: string | undefined;
    if (category !== undefined) {
      const found = await this.categories.findActiveBySlug(category);
      if (!found) throw new AppError(baselineErrors.NOT_FOUND); // unknown or archived (spec §4.3)
      categoryId = found.id;
    }
    const [rows, totalItems] = await this.posts.findAndCount({
      where: {
        language: POST_LANGUAGE,
        status: 'published',
        ...(categoryId ? { categoryId } : {}),
      },
      order: { publishedAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items: await this.withAuthors(rows), totalItems };
  }

  async getPublishedBySlug(slug: string): Promise<AuthoredPost> {
    // An impossible slug can't exist (ck_content_posts_slug_format); skip the query (a NUL would make Postgres throw).
    if (slug.length > 160 || !POST_SLUG_PATTERN.test(slug)) {
      throw new AppError(baselineErrors.NOT_FOUND);
    }
    const post = await this.posts.findOneBy({ language: POST_LANGUAGE, slug, status: 'published' });
    if (!post) throw new AppError(baselineErrors.NOT_FOUND); // drafts too: no existence leak (B13)
    return this.withAuthor(post);
  }

  /** The id of a published post, for discussion (spec §6.2); missing, draft or archived → 404, like reads. */
  async findPublishedId(slug: string): Promise<string> {
    if (slug.length > 160 || !POST_SLUG_PATTERN.test(slug)) {
      throw new AppError(baselineErrors.NOT_FOUND);
    }
    const post = await this.posts.findOne({
      select: { id: true },
      where: { language: POST_LANGUAGE, slug, status: 'published' },
    });
    if (!post) throw new AppError(baselineErrors.NOT_FOUND);
    return post.id;
  }

  /** Posts of any status by id, for moderation lists (one query). */
  async findRefs(ids: readonly string[]): Promise<Map<string, PostRef>> {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) return new Map();
    const rows = await this.posts.find({
      select: { id: true, slug: true, title: true },
      where: { id: In(wanted) },
    });
    return new Map(rows.map(({ id, slug, title }) => [id, { id, slug, title }]));
  }

  /** Whether a post is published right now (discussion on an existing comment, spec §6.2). */
  async isPublished(id: string): Promise<boolean> {
    return this.posts.exists({ where: { id, status: 'published' } });
  }

  /**
   * Up to 3 published posts for a published post's footer (spec §4.3): its category's newest first, padded with
   * the newest others; never the post itself. Two queries at most.
   */
  async listRelated(slug: string): Promise<AuthoredPost[]> {
    const { post } = await this.getPublishedBySlug(slug);
    const published = { language: POST_LANGUAGE, status: 'published' as const };
    const order = { publishedAt: 'DESC' as const, id: 'DESC' as const };
    const same = post.categoryId
      ? await this.posts.find({
          where: { ...published, categoryId: post.categoryId, id: Not(post.id) },
          order,
          take: RELATED_LIMIT,
        })
      : [];
    const others =
      same.length < RELATED_LIMIT
        ? await this.posts.find({
            where: { ...published, id: Not(In([post.id, ...same.map((row) => row.id)])) },
            order,
            take: RELATED_LIMIT - same.length,
          })
        : [];
    return this.withAuthors([...same, ...others]);
  }

  async listForActor(
    actor: AuthenticatedUser,
    status: PostStatus | undefined,
    { page, pageSize }: Paging,
  ): Promise<PostPage> {
    const [rows, totalItems] = await this.posts.findAndCount({
      where: {
        ...(actor.role === 'admin' ? {} : { authorId: actor.id }), // editors see only their own (B12)
        ...(status ? { status } : {}),
      },
      order: { updatedAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items: await this.withAuthors(rows), totalItems };
  }

  async getForActor(actor: AuthenticatedUser, id: string): Promise<AuthoredPost> {
    return this.withAuthor(await this.loadManageable(actor, id));
  }

  async create(actor: AuthenticatedUser, input: SavePostInput): Promise<AuthoredPost> {
    let id: string;
    try {
      const categoryId = input.categoryId ?? null;
      await this.assertAssignable(this.dataSource.manager, categoryId, null);
      await this.media.assertLibrarySources(collectMediaSources(input.body));
      await this.media.assertExisting([input.coverMediaId, input.ogMediaId]);
      const result = await this.posts.insert({
        authorId: actor.id,
        slug: input.slug,
        title: input.title,
        excerpt: input.excerpt,
        body: canonicalizePostBody(input.body),
        bodyVersion: fitsBodyVersion1(input.body) ? 1 : 2,
        seoTitle: input.seoTitle,
        seoDescription: input.seoDescription,
        tags: input.tags ?? [],
        categoryId,
        coverMediaId: input.coverMediaId ?? null,
        coverAlt: input.coverAlt ?? null,
        ogMediaId: input.ogMediaId ?? null,
      });
      id = (result.identifiers[0] as { id: string }).id;
    } catch (error) {
      throw this.translate(error);
    }
    return this.getForActor(actor, id);
  }

  async update(actor: AuthenticatedUser, id: string, input: SavePostInput): Promise<AuthoredPost> {
    try {
      // Row lock: a concurrent publish can't slip between these checks and the write (B17, B18).
      await this.dataSource.transaction(async (manager) => {
        const post = await this.lockManageable(manager, actor, id);
        // Q3: an old client omits newer fields; never let its full replacement erase them (spec §3.4).
        const fields = omittedFieldsWithData(input, post);
        if (fields.length > 0) throw new AppError(contentErrors.POST_FIELDS_OMITTED, { fields });
        // ...nor let an editor that can't load version 2 nodes overwrite them (spec §3.4).
        if (declaresOlderBody(input, post)) {
          throw new AppError(contentErrors.POST_BODY_VERSION_UNSUPPORTED);
        }
        // B17: once ever published, the slug is the post's permanent URL.
        if (post.publishedAt !== null && input.slug !== post.slug) {
          throw new AppError(contentErrors.POST_SLUG_LOCKED);
        }
        // B18: a published post can't be emptied.
        if (post.status === 'published' && !hasMeaningfulText(input.body)) {
          throw new AppError(contentErrors.POST_BODY_EMPTY);
        }
        // Spec §5.5: a published post never shows an unfinished before/after block.
        if (post.status === 'published' && hasIncompleteMedia(input.body)) {
          throw new AppError(contentErrors.POST_MEDIA_INCOMPLETE);
        }
        await this.media.assertLibrarySources(collectMediaSources(input.body), manager);
        await this.media.assertExisting([input.coverMediaId, input.ogMediaId], manager);
        // B2: an omitted categoryId reached here only if none is stored (the guard above), so `?? null` keeps it.
        const categoryId = input.categoryId ?? null;
        await this.assertAssignable(manager, categoryId, post.categoryId);
        // A published post keeps its category; a legacy one without a category may stay so (BD-3).
        if (post.status === 'published' && post.categoryId !== null && categoryId === null) {
          throw new AppError(contentErrors.POST_CATEGORY_REQUIRED);
        }
        await manager.update(
          Post,
          { id },
          {
            slug: input.slug,
            title: input.title,
            excerpt: input.excerpt,
            body: canonicalizePostBody(input.body),
            bodyVersion: fitsBodyVersion1(input.body) ? 1 : 2,
            seoTitle: input.seoTitle,
            seoDescription: input.seoDescription,
            tags: input.tags ?? [],
            categoryId,
            coverMediaId: input.coverMediaId ?? null,
            coverAlt: input.coverAlt ?? null,
            ogMediaId: input.ogMediaId ?? null,
          },
        );
      });
    } catch (error) {
      throw this.translate(error);
    }
    return this.getForActor(actor, id);
  }

  async publish(actor: AuthenticatedUser, id: string): Promise<AuthoredPost> {
    // Row lock: a concurrent update can't empty the body between the check and the publish (B18).
    await this.dataSource.transaction(async (manager) => {
      const post = await this.lockManageable(manager, actor, id);
      if (post.status === 'archived') throw new AppError(contentErrors.POST_ARCHIVED);
      if (post.status === 'published') return; // idempotent: no write
      if (!hasMeaningfulText(post.body)) throw new AppError(contentErrors.POST_BODY_EMPTY); // B18
      if (hasIncompleteMedia(post.body)) throw new AppError(contentErrors.POST_MEDIA_INCOMPLETE);
      // BD-3: a new publication needs an active category.
      if (post.categoryId === null) throw new AppError(contentErrors.POST_CATEGORY_REQUIRED);
      const category = (await this.categories.findRefs([post.categoryId], manager)).get(
        post.categoryId,
      );
      if (category?.status !== 'active') throw new AppError(contentErrors.CATEGORY_ARCHIVED);
      await manager
        .createQueryBuilder()
        .update(Post)
        // B16: the first publication's instant is kept forever.
        .set({ status: 'published', publishedAt: () => 'COALESCE("published_at", now())' })
        .where('id = :id', { id })
        .execute();
    });
    return this.getForActor(actor, id);
  }

  async unpublish(actor: AuthenticatedUser, id: string): Promise<AuthoredPost> {
    await this.dataSource.transaction(async (manager) => {
      const post = await this.lockManageable(manager, actor, id);
      if (post.status === 'archived') throw new AppError(contentErrors.POST_ARCHIVED);
      if (post.status === 'draft') return; // idempotent: no write
      // published_at stays, so the slug stays locked (B16, B17).
      await manager.update(Post, { id }, { status: 'draft' });
    });
    return this.getForActor(actor, id);
  }

  /** Retires a draft or published post without deleting it (blog completion spec §3.1, BD-1). */
  async archive(actor: AuthenticatedUser, id: string): Promise<AuthoredPost> {
    await this.dataSource.transaction(async (manager) => {
      const post = await this.lockManageable(manager, actor, id);
      if (post.status === 'archived') return; // idempotent: no write
      await manager.update(Post, { id }, { status: 'archived' }); // published_at kept: the slug stays locked
    });
    return this.getForActor(actor, id);
  }

  /** Archived → draft, never straight to published; any other state is left as it is (spec §3.1). */
  async restore(actor: AuthenticatedUser, id: string): Promise<AuthoredPost> {
    await this.dataSource.transaction(async (manager) => {
      const post = await this.lockManageable(manager, actor, id);
      if (post.status !== 'archived') return; // no write
      await manager.update(Post, { id }, { status: 'draft' });
    });
    return this.getForActor(actor, id);
  }

  /** Hard delete, only for a draft that was never published: anything with a public past is archived (BD-1). */
  async remove(actor: AuthenticatedUser, id: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const post = await this.lockManageable(manager, actor, id);
      if (post.publishedAt !== null) throw new AppError(contentErrors.POST_WAS_PUBLISHED);
      if (post.status === 'archived') throw new AppError(contentErrors.POST_ARCHIVED);
      // The spec's conditional delete (§3.1): a backstop should the checks above ever change.
      const { affected } = await manager.delete(Post, {
        id,
        status: 'draft',
        publishedAt: IsNull(),
      });
      if (affected !== 1) throw new Error('A deletable draft was locked but not deleted.');
    });
  }

  /** 404 if missing, then the ownership rule: editors only their own, reads included (B11, B12). */
  private async loadManageable(actor: AuthenticatedUser, id: string): Promise<Post> {
    const post = await this.posts.findOneBy({ id });
    if (!post) throw new AppError(baselineErrors.NOT_FOUND);
    assertCanManageOwnedResource(actor, post.authorId);
    return post;
  }

  /** loadManageable inside a transaction: the row stays locked until it commits (only `manager`, I8). */
  private async lockManageable(
    manager: EntityManager,
    actor: AuthenticatedUser,
    id: string,
  ): Promise<Post> {
    const post = await manager.findOne(Post, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!post) throw new AppError(baselineErrors.NOT_FOUND);
    assertCanManageOwnedResource(actor, post.authorId);
    return post;
  }

  /**
   * A category the post doesn't have yet must exist and be active (spec §4.4); keeping an archived one is
   * allowed so editing such a post never fails.
   */
  private async assertAssignable(
    manager: EntityManager,
    next: string | null,
    current: string | null,
  ): Promise<void> {
    if (next === null || next === current) return;
    const category = (await this.categories.findRefs([next], manager)).get(next);
    if (!category) throw new AppError(contentErrors.CATEGORY_NOT_FOUND);
    if (category.status !== 'active') throw new AppError(contentErrors.CATEGORY_ARCHIVED);
  }

  private async withAuthor(post: Post): Promise<AuthoredPost> {
    return (await this.withAuthors([post]))[0];
  }

  /** One profile, one category, one media and one rating query per page, not per post. */
  private async withAuthors(rows: Post[]): Promise<AuthoredPost[]> {
    const [profiles, categories, images, ratings] = await Promise.all([
      this.profiles.findPublicProfiles(rows.map((post) => post.authorId)),
      this.categories.findRefs(rows.flatMap((post) => (post.categoryId ? [post.categoryId] : []))),
      this.media.findImages(rows.flatMap((post) => [post.coverMediaId, post.ogMediaId])),
      this.ratingSummaries.forPosts(rows.map((post) => post.id)),
    ]);
    const byId = new Map(profiles.map((profile) => [profile.id, profile]));
    return rows.map((post) => {
      const author = byId.get(post.authorId);
      if (!author) throw new Error('Post author missing despite fk_content_posts_author_id.');
      const category = post.categoryId ? (categories.get(post.categoryId) ?? null) : null;
      if (post.categoryId && !category) {
        throw new Error('Post category missing despite fk_content_posts_category_id.');
      }
      const cover = post.coverMediaId ? (images.get(post.coverMediaId) ?? null) : null;
      const og = post.ogMediaId ? (images.get(post.ogMediaId) ?? null) : null;
      return { post, author, category, cover, og, rating: ratings.get(post.id) ?? NO_RATINGS };
    });
  }

  /** D11: the content service, not HTTP, gives the unique violation its meaning (I15). */
  private translate(error: unknown): unknown {
    if (isUniqueViolation(error, 'uq_content_posts_language_slug')) {
      return new AppError(contentErrors.POST_SLUG_TAKEN);
    }
    // The category was deleted after the check (spec §4.4; the delete holds its row lock).
    if (isForeignKeyViolation(error, 'fk_content_posts_category_id')) {
      return new AppError(contentErrors.CATEGORY_NOT_FOUND);
    }
    if (
      isForeignKeyViolation(error, 'fk_content_posts_cover_media_id') ||
      isForeignKeyViolation(error, 'fk_content_posts_og_media_id')
    ) {
      return new AppError(contentErrors.POST_MEDIA_NOT_FOUND);
    }
    return error;
  }
}
