import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
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
  courseLessonIdParamSchema,
  courseSectionIdParamSchema,
  type CurriculumOrderInput,
  curriculumOrderSchema,
  type SaveCourseInput,
  type SaveCourseLessonInput,
  type SaveCourseSectionInput,
  saveCourseLessonSchema,
  saveCourseSchema,
  saveCourseSectionSchema,
} from './dto/save-course.dto.js';

const { VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND } = baselineErrors;
const {
  COURSE_SLUG_TAKEN,
  COURSE_SLUG_LOCKED,
  COURSE_NEEDS_PUBLISHED_LESSON,
  LESSON_VIDEO_MISSING,
  LESSON_IS_PUBLISHED,
  SECTION_NOT_EMPTY,
  CURRICULUM_ORDER_MISMATCH,
} = coursesErrors;

type CourseIdParam = z.infer<typeof courseIdParamSchema>;
type CourseSectionIdParam = z.infer<typeof courseSectionIdParamSchema>;
type CourseLessonIdParam = z.infer<typeof courseLessonIdParamSchema>;

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

  @Post('courses/:courseId/sections')
  @ApiSchemaParameters('path', courseIdParamSchema)
  @ApiEnvelopeResponse(AdminCourseDto, { status: 201 })
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  async addSection(
    @Param({ schema: courseIdParamSchema }) params: CourseIdParam,
    @Body({ schema: saveCourseSectionSchema }) input: SaveCourseSectionInput,
  ): Promise<AdminCourseDto> {
    return toAdminCourseDto(await this.courses.addSection(params.courseId, input));
  }

  @Put('course-sections/:sectionId')
  @ApiSchemaParameters('path', courseSectionIdParamSchema)
  @ApiEnvelopeResponse(AdminCourseDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  async renameSection(
    @Param({ schema: courseSectionIdParamSchema }) params: CourseSectionIdParam,
    @Body({ schema: saveCourseSectionSchema }) input: SaveCourseSectionInput,
  ): Promise<AdminCourseDto> {
    return toAdminCourseDto(await this.courses.renameSection(params.sectionId, input));
  }

  @Delete('course-sections/:sectionId')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'The empty section is deleted.' })
  @ApiSchemaParameters('path', courseSectionIdParamSchema)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, SECTION_NOT_EMPTY)
  async deleteSection(
    @Param({ schema: courseSectionIdParamSchema }) params: CourseSectionIdParam,
  ): Promise<void> {
    await this.courses.deleteSection(params.sectionId);
  }

  @Put('courses/:courseId/curriculum-order')
  @ApiSchemaParameters('path', courseIdParamSchema)
  @ApiEnvelopeResponse(AdminCourseDto)
  @ApiErrorResponses(
    VALIDATION_FAILED,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    CURRICULUM_ORDER_MISMATCH,
  )
  async reorder(
    @Param({ schema: courseIdParamSchema }) params: CourseIdParam,
    @Body({ schema: curriculumOrderSchema }) input: CurriculumOrderInput,
  ): Promise<AdminCourseDto> {
    return toAdminCourseDto(await this.courses.reorder(params.courseId, input));
  }

  @Post('course-sections/:sectionId/lessons')
  @ApiSchemaParameters('path', courseSectionIdParamSchema)
  @ApiEnvelopeResponse(AdminCourseDto, { status: 201 })
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  async addLesson(
    @Param({ schema: courseSectionIdParamSchema }) params: CourseSectionIdParam,
    @Body({ schema: saveCourseLessonSchema }) input: SaveCourseLessonInput,
  ): Promise<AdminCourseDto> {
    return toAdminCourseDto(await this.courses.addLesson(params.sectionId, input));
  }

  /** Full replacement: an omitted optional field clears it; an explicit `null` is a 400. */
  @Put('course-lessons/:lessonId')
  @ApiSchemaParameters('path', courseLessonIdParamSchema)
  @ApiEnvelopeResponse(AdminCourseDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, LESSON_VIDEO_MISSING)
  async updateLesson(
    @Param({ schema: courseLessonIdParamSchema }) params: CourseLessonIdParam,
    @Body({ schema: saveCourseLessonSchema }) input: SaveCourseLessonInput,
  ): Promise<AdminCourseDto> {
    return toAdminCourseDto(await this.courses.updateLesson(params.lessonId, input));
  }

  @Post('course-lessons/:lessonId/publish')
  @HttpCode(200)
  @ApiSchemaParameters('path', courseLessonIdParamSchema)
  @ApiEnvelopeResponse(AdminCourseDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, LESSON_VIDEO_MISSING)
  async publishLesson(
    @Param({ schema: courseLessonIdParamSchema }) params: CourseLessonIdParam,
  ): Promise<AdminCourseDto> {
    return toAdminCourseDto(await this.courses.publishLesson(params.lessonId));
  }

  @Post('course-lessons/:lessonId/unpublish')
  @HttpCode(200)
  @ApiSchemaParameters('path', courseLessonIdParamSchema)
  @ApiEnvelopeResponse(AdminCourseDto)
  @ApiErrorResponses(
    VALIDATION_FAILED,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    COURSE_NEEDS_PUBLISHED_LESSON,
  )
  async unpublishLesson(
    @Param({ schema: courseLessonIdParamSchema }) params: CourseLessonIdParam,
  ): Promise<AdminCourseDto> {
    return toAdminCourseDto(await this.courses.unpublishLesson(params.lessonId));
  }

  @Delete('course-lessons/:lessonId')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'The draft lesson is deleted.' })
  @ApiSchemaParameters('path', courseLessonIdParamSchema)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, LESSON_IS_PUBLISHED)
  async deleteLesson(
    @Param({ schema: courseLessonIdParamSchema }) params: CourseLessonIdParam,
  ): Promise<void> {
    await this.courses.deleteLesson(params.lessonId);
  }
}
