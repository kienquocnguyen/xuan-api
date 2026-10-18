import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CourseLesson } from './course-lesson.entity.js';
import { CourseSection } from './course-section.entity.js';
import { Course } from './course.entity.js';

@Module({
  // The only registration of the course entities (I1). No other business module is imported in outcome 1.
  imports: [TypeOrmModule.forFeature([Course, CourseSection, CourseLesson])],
})
export class CoursesModule {}
