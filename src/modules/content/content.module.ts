import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG, AppConfigModule } from '../../config/app-config.module.js';
import type { AppConfig } from '../../config/load-config.js';
import { UsersModule } from '../users/users.module.js';
import { AdminMediaController } from './admin-media.controller.js';
import { AdminPostCategoriesController } from './admin-post-categories.controller.js';
import { AdminPostsController } from './admin-posts.controller.js';
import { CategoriesService } from './categories.service.js';
import { PostCategoriesController } from './post-categories.controller.js';
import { ContentCategory, ContentCategoryTranslation } from './category.entity.js';
import { ContentMedia } from './media/media.entity.js';
import { MediaService } from './media/media.service.js';
import { createMediaStorage, MEDIA_STORAGE } from './media/media-storage.js';
import { PostComment } from './discussion/post-comment.entity.js';
import { PostRating } from './discussion/post-rating.entity.js';
import {
  DiscussionController,
  PostCommentsController,
} from './discussion/discussion.controller.js';
import { DiscussionService } from './discussion/discussion.service.js';
import { DISCUSSION_LIMITS } from './discussion/discussion-throttle.guard.js';
import { Post } from './post.entity.js';
import { PostsController } from './posts.controller.js';
import { PostsService } from './posts.service.js';

@Module({
  // The content tables' only registration (I1). UsersModule: for its exported UserProfilesReader (AD14).
  imports: [
    TypeOrmModule.forFeature([
      Post,
      ContentCategory,
      ContentCategoryTranslation,
      ContentMedia,
      PostRating,
      PostComment,
    ]),
    UsersModule,
    AppConfigModule,
    // In-memory store: one API instance today (spec §6.4). Only DiscussionThrottle uses it; no global guard.
    ThrottlerModule.forRoot({ throttlers: DISCUSSION_LIMITS, setHeaders: false }),
  ],
  controllers: [
    PostsController,
    DiscussionController,
    PostCommentsController,
    PostCategoriesController,
    AdminPostsController,
    AdminPostCategoriesController,
    AdminMediaController,
  ],
  providers: [
    PostsService,
    DiscussionService,
    CategoriesService,
    MediaService,
    // The storage gateway is chosen from config (C5, blog completion spec §5.3).
    {
      provide: MEDIA_STORAGE,
      useFactory: (config: AppConfig) => createMediaStorage(config),
      inject: [APP_CONFIG],
    },
  ],
})
export class ContentModule {}
