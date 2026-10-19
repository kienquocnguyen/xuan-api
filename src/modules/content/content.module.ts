import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module.js';
import { AdminPostCategoriesController } from './admin-post-categories.controller.js';
import { AdminPostsController } from './admin-posts.controller.js';
import { CategoriesService } from './categories.service.js';
import { ContentCategory, ContentCategoryTranslation } from './category.entity.js';
import { Post } from './post.entity.js';
import { PostsController } from './posts.controller.js';
import { PostsService } from './posts.service.js';

@Module({
  // The content tables' only registration (I1). UsersModule: for its exported UserProfilesReader (AD14).
  imports: [
    TypeOrmModule.forFeature([Post, ContentCategory, ContentCategoryTranslation]),
    UsersModule,
  ],
  controllers: [PostsController, AdminPostsController, AdminPostCategoriesController],
  providers: [PostsService, CategoriesService],
})
export class ContentModule {}
