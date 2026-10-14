import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../src/errors/app-error.js';
import { baselineErrors } from '../../src/errors/baseline-errors.js';
import { CurrentUser, Roles } from '../../src/http/auth/auth.decorators.js';
import { assertCanManageOwnedResource } from '../../src/http/auth/ownership.js';
import type { AuthenticatedUser } from '../../src/http/auth/role.js';

/**
 * Test-only stand-ins for future management routes (auth design §5): role-gated areas and an author-owned
 * resource shaped like a blog post (`authorId` → users.id). No blog module exists yet.
 */
@Controller('__fixture')
class FixtureAccessController {
  @Get('editor-area')
  @Roles('editor', 'admin')
  editorArea(@CurrentUser() user: AuthenticatedUser) {
    return { area: 'editor', role: user.role };
  }

  @Get('admin-area')
  @Roles('admin')
  adminArea(@CurrentUser() user: AuthenticatedUser) {
    return { area: 'admin', role: user.role };
  }
}

type FixturePost = { id: string; authorId: string; title: string; published: boolean };

@Injectable()
class FixturePostsStore {
  readonly posts = new Map<string, FixturePost>();
  get(id: string): FixturePost {
    const post = this.posts.get(id);
    if (!post) throw new AppError(baselineErrors.NOT_FOUND);
    return post;
  }
}

const titleSchema = z.strictObject({ title: z.string().min(1) });

@Roles('editor', 'admin') // role gate; ownership is checked per record below
@Controller('__fixture/posts')
class FixturePostsController {
  constructor(private readonly store: FixturePostsStore) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body({ schema: titleSchema }) body: { title: string },
  ) {
    const post = { id: randomUUID(), authorId: user.id, title: body.title, published: false };
    this.store.posts.set(post.id, post);
    return post;
  }

  @Patch(':id')
  edit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body({ schema: titleSchema }) body: { title: string },
  ) {
    const post = this.store.get(id);
    assertCanManageOwnedResource(user, post.authorId);
    post.title = body.title;
    return post;
  }

  @Post(':id/publish')
  @HttpCode(200)
  publish(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const post = this.store.get(id);
    assertCanManageOwnedResource(user, post.authorId);
    post.published = true;
    return post;
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  unpublish(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const post = this.store.get(id);
    assertCanManageOwnedResource(user, post.authorId);
    post.published = false;
    return post;
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): void {
    assertCanManageOwnedResource(user, this.store.get(id).authorId);
    this.store.posts.delete(id);
  }
}

@Module({
  controllers: [FixtureAccessController, FixturePostsController],
  providers: [FixturePostsStore],
})
export class AuthFixtureModule {}
