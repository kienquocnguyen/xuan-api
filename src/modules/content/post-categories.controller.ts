import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../http/auth/auth.decorators.js';
import { ApiEnvelopeResponse } from '../../http/openapi/api-envelope-response.js';
import { ApiErrorResponses } from '../../http/openapi/api-error-responses.js';
import { CategoriesService } from './categories.service.js';
import { PostCategoryDto } from './dto/category.dto.js';

/** The public category list for the blog's filter (blog completion spec §4.3). */
@Public()
@ApiTags('posts')
@Controller('post-categories')
export class PostCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiEnvelopeResponse(PostCategoryDto, { isArray: true })
  @ApiErrorResponses()
  async list(): Promise<PostCategoryDto[]> {
    return (await this.categories.listPublic()).map(({ slug, label, publishedPostCount }) => ({
      slug,
      label,
      publishedPostCount,
    }));
  }
}
