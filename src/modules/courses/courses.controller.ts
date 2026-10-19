import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { Public } from '../../http/auth/auth.decorators.js';
import { ApiEnvelopeResponse } from '../../http/openapi/api-envelope-response.js';
import { ApiErrorResponses } from '../../http/openapi/api-error-responses.js';
import { CoursesService } from './courses.service.js';
import { CourseDto, CourseSummaryDto, toCourseDto, toCourseSummaryDto } from './dto/course.dto.js';

@Public() // the catalog and published outlines are public
@ApiTags('courses')
@Controller('courses')
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get()
  @ApiEnvelopeResponse(CourseSummaryDto, { isArray: true })
  @ApiErrorResponses()
  async list(): Promise<CourseSummaryDto[]> {
    // Unpaginated: a handful of courses (DEFAULT deviation, course spec §21, as GET /services).
    const courses = await this.courses.listPublished();
    return courses.map(toCourseSummaryDto);
  }

  @Get(':slug')
  @ApiEnvelopeResponse(CourseDto)
  @ApiErrorResponses(baselineErrors.NOT_FOUND)
  async getBySlug(@Param('slug') slug: string): Promise<CourseDto> {
    // D7 deviation (as posts and services): the slug is an opaque lookup key; an impossible one is not found.
    return toCourseDto(await this.courses.getPublishedOutline(slug));
  }
}
