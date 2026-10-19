import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { CurrentUser } from '../../http/auth/auth.decorators.js';
import type { AuthenticatedUser } from '../../http/auth/role.js';
import { ApiEnvelopeResponse } from '../../http/openapi/api-envelope-response.js';
import { ApiErrorResponses } from '../../http/openapi/api-error-responses.js';
import { ApiSchemaParameters } from '../../http/openapi/api-schema-parameters.js';
import { coursesErrors } from './courses.errors.js';
import {
  LearnerCourseDto,
  LearnerCourseSummaryDto,
  type LessonPathParams,
  LessonPlaybackDto,
  lessonPathParamsSchema,
  toLearnerCourseDto,
  toLearnerCourseSummaryDto,
  toLessonPlaybackDto,
} from './dto/learning.dto.js';
import { LearningService } from './learning.service.js';

const { VALIDATION_FAILED, UNAUTHENTICATED, NOT_FOUND } = baselineErrors;
const { COURSE_ACCESS_REQUIRED } = coursesErrors;

/**
 * Signed-in learner routes (course spec §11.2): any role, but every one needs an active grant. Responses are
 * `no-store`, so a revocation never depends on a browser or proxy cache dropping an old one (§7.1).
 */
@ApiTags('learn')
@Controller('learn/courses')
export class LearningController {
  constructor(private readonly learning: LearningService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiEnvelopeResponse(LearnerCourseSummaryDto, { isArray: true })
  @ApiErrorResponses(UNAUTHENTICATED)
  async list(@CurrentUser() user: AuthenticatedUser): Promise<LearnerCourseSummaryDto[]> {
    // Unpaginated: a learner holds a handful of courses (DEFAULT deviation, course spec §11.2).
    const items = await this.learning.listCourses(user.id);
    return items.map(toLearnerCourseSummaryDto);
  }

  @Get(':slug')
  @Header('Cache-Control', 'no-store')
  @ApiEnvelopeResponse(LearnerCourseDto)
  @ApiErrorResponses(UNAUTHENTICATED, NOT_FOUND, COURSE_ACCESS_REQUIRED)
  async getCourse(
    @Param('slug') slug: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LearnerCourseDto> {
    // D7 deviation (as the public outline): the slug is an opaque lookup key.
    return toLearnerCourseDto(await this.learning.getCourse(user.id, slug));
  }

  @Get(':slug/lessons/:lessonId')
  @Header('Cache-Control', 'no-store')
  @ApiSchemaParameters('path', lessonPathParamsSchema)
  @ApiEnvelopeResponse(LessonPlaybackDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, NOT_FOUND, COURSE_ACCESS_REQUIRED)
  async getPlayback(
    @Param({ schema: lessonPathParamsSchema }) params: LessonPathParams,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LessonPlaybackDto> {
    return toLessonPlaybackDto(
      await this.learning.getPlayback(user.id, params.slug, params.lessonId),
    );
  }
}
