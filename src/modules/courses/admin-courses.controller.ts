import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { Roles } from '../../http/auth/auth.decorators.js';
import { ApiEnvelopeResponse } from '../../http/openapi/api-envelope-response.js';
import { ApiErrorResponses } from '../../http/openapi/api-error-responses.js';
import { ApiSchemaParameters } from '../../http/openapi/api-schema-parameters.js';
import { coursesErrors } from './courses.errors.js';
import { CoursesService } from './courses.service.js';
import {
  AdminCourseDto,
  AdminCourseSummaryDto,
  toAdminCourseDto,
  toAdminCourseSummaryDto,
} from './dto/admin-course.dto.js';
import {
  courseIdParamSchema,
  type SaveCourseInput,
  saveCourseSchema,
} from './dto/save-course.dto.js';

const { VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND } = baselineErrors;
const { COURSE_SLUG_TAKEN, COURSE_SLUG_LOCKED, COURSE_NEEDS_PUBLISHED_LESSON } = coursesErrors;

type CourseIdParam = z.infer<typeof courseIdParamSchema>;

/**
 * Course curriculum and publication, admin only (course spec §11.3, §12). Every write returns the whole
 * `AdminCourseDto`, read after its transaction committed.
 */
@Roles('admin')
@ApiTags('admin')
@Controller('admin')
export class AdminCoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get('courses')
  @ApiEnvelopeResponse(AdminCourseSummaryDto, { isArray: true })
  @ApiErrorResponses(UNAUTHENTICATED, FORBIDDEN)
  async list(): Promise<AdminCourseSummaryDto[]> {
    // Unpaginated: a handful of courses (DEFAULT deviation, course spec §21).
    const items = await this.courses.listForAdmin();
    return items.map(toAdminCourseSummaryDto);
  }

  @Post('courses')
  @ApiEnvelopeResponse(AdminCourseDto, { status: 201 })
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, COURSE_SLUG_TAKEN)
  async create(
    @Body({ schema: saveCourseSchema }) input: SaveCourseInput,
  ): Promise<AdminCourseDto> {
    return toAdminCourseDto(await this.courses.create(input));
  }

  @Get('courses/:courseId')
  @ApiSchemaParameters('path', courseIdParamSchema)
  @ApiEnvelopeResponse(AdminCourseDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  async get(
    @Param({ schema: courseIdParamSchema }) params: CourseIdParam,
  ): Promise<AdminCourseDto> {
    return toAdminCourseDto(await this.courses.getForAdmin(params.courseId));
  }

  @Put('courses/:courseId')
  @ApiSchemaParameters('path', courseIdParamSchema)
  @ApiEnvelopeResponse(AdminCourseDto)
  @ApiErrorResponses(
    VALIDATION_FAILED,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    COURSE_SLUG_TAKEN,
    COURSE_SLUG_LOCKED,
  )
  async update(
    @Param({ schema: courseIdParamSchema }) params: CourseIdParam,
    @Body({ schema: saveCourseSchema }) input: SaveCourseInput,
  ): Promise<AdminCourseDto> {
    return toAdminCourseDto(await this.courses.update(params.courseId, input));
  }

  @Post('courses/:courseId/publish')
  @HttpCode(200)
  @ApiSchemaParameters('path', courseIdParamSchema)
  @ApiEnvelopeResponse(AdminCourseDto)
  @ApiErrorResponses(
    VALIDATION_FAILED,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    COURSE_NEEDS_PUBLISHED_LESSON,
  )
  async publish(
    @Param({ schema: courseIdParamSchema }) params: CourseIdParam,
  ): Promise<AdminCourseDto> {
    return toAdminCourseDto(await this.courses.publish(params.courseId));
  }

  @Post('courses/:courseId/unpublish')
  @HttpCode(200)
  @ApiSchemaParameters('path', courseIdParamSchema)
  @ApiEnvelopeResponse(AdminCourseDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  async unpublish(
    @Param({ schema: courseIdParamSchema }) params: CourseIdParam,
  ): Promise<AdminCourseDto> {
    return toAdminCourseDto(await this.courses.unpublish(params.courseId));
  }
}
