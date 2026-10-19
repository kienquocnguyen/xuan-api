import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module.js';
import { CourseAccessGrant } from './course-access-grant.entity.js';
import { CourseLesson } from './course-lesson.entity.js';
import { CourseSection } from './course-section.entity.js';
import { Course } from './course.entity.js';
import { AdminCourseAccessController } from './admin-course-access.controller.js';
import { AdminCoursesController } from './admin-courses.controller.js';
import { CourseAccessService } from './course-access.service.js';
import { CoursesController } from './courses.controller.js';
import { LessonProgress } from './lesson-progress.entity.js';
import { CoursesService } from './courses.service.js';
import { LearningController } from './learning.controller.js';
import { LearningService } from './learning.service.js';

@Module({
  // The only registration of the course entities (I1). UsersModule: for its exported UserProfilesReader (AD14).
  imports: [
    TypeOrmModule.forFeature([
      Course,
      CourseSection,
      CourseLesson,
      CourseAccessGrant,
      LessonProgress,
    ]),
    UsersModule,
  ],
  controllers: [
    CoursesController,
    AdminCoursesController,
    AdminCourseAccessController,
    LearningController,
  ],
  providers: [CoursesService, CourseAccessService, LearningService],
})
export class CoursesModule {}
