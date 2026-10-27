import { Body, Controller, HttpCode, Param, Put, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { baselineErrors } from '../../../errors/baseline-errors.js';
import { CurrentUser } from '../../../http/auth/auth.decorators.js';
import type { AuthenticatedUser } from '../../../http/auth/role.js';
import { ApiErrorResponses } from '../../../http/openapi/api-error-responses.js';
import { type SavePostRatingInput, savePostRatingSchema } from '../dto/save-discussion.dto.js';
import { DiscussionService } from './discussion.service.js';
import { DiscussionThrottle } from './discussion-throttle.guard.js';

const { VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, RATE_LIMITED } = baselineErrors;

/** Reader discussion on a published post (blog completion spec §6.2). Signed in; the post slug is an opaque key (D7). */
@ApiTags('posts')
@Controller('posts')
export class DiscussionController {
  constructor(private readonly discussion: DiscussionService) {}

  @Put(':slug/rating')
  @HttpCode(204)
  @UseGuards(DiscussionThrottle)
  @ApiNoContentResponse({ description: 'The rating is saved.' })
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, RATE_LIMITED)
  async rate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body({ schema: savePostRatingSchema }) input: SavePostRatingInput,
  ): Promise<void> {
    await this.discussion.saveRating(actor, slug, input.value);
  }
}
