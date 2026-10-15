import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { isUniqueViolation } from '../../database/postgres-errors.js';
import { AppError } from '../../errors/app-error.js';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { assertCanManageOwnedResource } from '../../http/auth/ownership.js';
import type { AuthenticatedUser } from '../../http/auth/role.js';
import { type PublicProfile, UserProfilesReader } from '../users/user-profiles.reader.js';
import { canonicalizePostBody, hasMeaningfulText } from './body/post-body-content.js';
import { contentErrors } from './content.errors.js';
import { POST_SLUG_PATTERN, type SavePostInput } from './dto/save-post.dto.js';
import { POST_LANGUAGE, Post, type PostStatus } from './post.entity.js';

export type AuthoredPost = Readonly<{ post: Post; author: PublicProfile }>;
export type PostPage = Readonly<{ items: AuthoredPost[]; totalItems: number }>;
type Paging = Readonly<{ page: number; pageSize: number }>;

/** Blog posts use cases (blog spec §6). */
@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(Post) private readonly posts: Repository<Post>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly profiles: UserProfilesReader,
  ) {}

  async listPublished({ page, pageSize }: Paging): Promise<PostPage> {
    const [rows, totalItems] = await this.posts.findAndCount({
      where: { language: POST_LANGUAGE, status: 'published' },
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
      const result = await this.posts.insert({
        authorId: actor.id,
        slug: input.slug,
        title: input.title,
        excerpt: input.excerpt,
        body: canonicalizePostBody(input.body),
        seoTitle: input.seoTitle,
        seoDescription: input.seoDescription,
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
        // B17: once ever published, the slug is the post's permanent URL.
        if (post.publishedAt !== null && input.slug !== post.slug) {
          throw new AppError(contentErrors.POST_SLUG_LOCKED);
        }
        // B18: a published post can't be emptied.
        if (post.status === 'published' && !hasMeaningfulText(input.body)) {
          throw new AppError(contentErrors.POST_BODY_EMPTY);
        }
        await manager.update(
          Post,
          { id },
          {
            slug: input.slug,
            title: input.title,
            excerpt: input.excerpt,
            body: canonicalizePostBody(input.body),
            seoTitle: input.seoTitle,
            seoDescription: input.seoDescription,
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
      if (post.status === 'published') return; // idempotent: no write
      if (!hasMeaningfulText(post.body)) throw new AppError(contentErrors.POST_BODY_EMPTY); // B18
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
    const post = await this.loadManageable(actor, id);
    if (post.status === 'draft') return this.withAuthor(post); // idempotent: no write
    await this.posts
      .createQueryBuilder()
      .update(Post)
      .set({ status: 'draft' }) // published_at stays, so the slug stays locked (B16, B17)
      .where('id = :id AND status = :published', { id, published: 'published' })
      .execute();
    return this.getForActor(actor, id);
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

  private async withAuthor(post: Post): Promise<AuthoredPost> {
    return (await this.withAuthors([post]))[0];
  }

  /** One profile query per page, not per post. */
  private async withAuthors(rows: Post[]): Promise<AuthoredPost[]> {
    const profiles = await this.profiles.findPublicProfiles(rows.map((post) => post.authorId));
    const byId = new Map(profiles.map((profile) => [profile.id, profile]));
    return rows.map((post) => {
      const author = byId.get(post.authorId);
      if (!author) throw new Error('Post author missing despite fk_content_posts_author_id.');
      return { post, author };
    });
  }

  /** D11: the content service, not HTTP, gives the unique violation its meaning (I15). */
  private translate(error: unknown): unknown {
    return isUniqueViolation(error, 'uq_content_posts_language_slug')
      ? new AppError(contentErrors.POST_SLUG_TAKEN)
      : error;
  }
}
