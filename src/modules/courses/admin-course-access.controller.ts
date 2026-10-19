import { Controller, Delete, Get, HttpCode, Param, Put } from '@nestjs/common';
import { ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { CurrentUser, Roles } from '../../http/auth/auth.decorators.js';
import type { AuthenticatedUser } from '../../http/auth/role.js';
import { ApiEnvelopeResponse } from '../../http/openapi/api-envelope-response.js';
import { ApiErrorResponses } from '../../http/openapi/api-error-responses.js';
import { ApiSchemaParameters } from '../../http/openapi/api-schema-parameters.js';
import { CourseAccessService } from './course-access.service.js';
import {
  CourseAccessGrantDto,
  type CourseAccessParams,
  courseAccessParamsSchema,
  toCourseAccessGrantDto,
} from './dto/course-access.dto.js';
import { courseIdParamSchema } from './dto/save-course.dto.js';

const { VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND } = baselineErrors;

type CourseIdParam = z.infer<typeof courseIdParamSchema>;

/** Course access grants, admin only (course spec §11.4, §12). Self-grants are allowed (OD-6). */
@Roles('admin')
@ApiTags('admin')
@Controller('admin')
export class AdminCourseAccessController {
  constructor(private readonly access: CourseAccessService) {}

  @Get('courses/:courseId/access-grants')
  @ApiSchemaParameters('path', courseIdParamSchema)
  @ApiEnvelopeResponse(CourseAccessGrantDto, { isArray: true })
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  async list(
    @Param({ schema: courseIdParamSchema }) params: CourseIdParam,
  ): Promise<CourseAccessGrantDto[]> {
    // Unpaginated: a course's grant history is small in V1 (DEFAULT deviation, course spec §11.4).
    const views = await this.access.listForCourse(params.courseId);
    return views.map(toCourseAccessGrantDto);
  }

  @Put('courses/:courseId/access/:userId')
  @ApiSchemaParameters('path', courseAccessParamsSchema)
  @ApiEnvelopeResponse(CourseAccessGrantDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  async grant(
    @Param({ schema: courseAccessParamsSchema }) params: CourseAccessParams,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<CourseAccessGrantDto> {
    return toCourseAccessGrantDto(
      await this.access.grant(params.courseId, params.userId, admin.id),
    );
  }

  @Delete('courses/:courseId/access/:userId')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'The active admin grant, if any, is revoked.' })
  @ApiSchemaParameters('path', courseAccessParamsSchema)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  async revoke(
    @Param({ schema: courseAccessParamsSchema }) params: CourseAccessParams,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<void> {
    await this.access.revoke(params.courseId, params.userId, admin.id);
  }
}
