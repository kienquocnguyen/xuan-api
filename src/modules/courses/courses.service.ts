import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { In, type DataSource, type EntityManager, type Repository } from 'typeorm';
import { AppError } from '../../errors/app-error.js';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { CourseLesson } from './course-lesson.entity.js';
import { CourseSection } from './course-section.entity.js';
import type { CourseTree } from './course-tree.js';
import { Course } from './course.entity.js';
import { COURSE_SLUG_PATTERN } from './dto/save-course.dto.js';

type TreeScope = 'all' | 'published';

/** Course catalog, curriculum and publication use cases (course spec §10, §11.1, §11.3). */
@Injectable()
export class CoursesService {
  constructor(
    @InjectRepository(Course) private readonly courses: Repository<Course>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async listPublished(): Promise<Course[]> {
    return this.courses.find({
      where: { status: 'published' },
      order: { publishedAt: 'DESC', id: 'DESC' },
    });
  }

  async getPublishedOutline(slug: string): Promise<CourseTree> {
    // An impossible slug can't exist (ck_courses_slug_format); skip the query (a NUL would make Postgres throw).
    if (slug.length > 160 || !COURSE_SLUG_PATTERN.test(slug)) {
      throw new AppError(baselineErrors.NOT_FOUND);
    }
    const course = await this.courses.findOneBy({ slug, status: 'published' });
    if (!course) throw new AppError(baselineErrors.NOT_FOUND); // drafts too: no existence leak
    return this.loadTree(this.dataSource.manager, course, 'published');
  }

  /**
   * Two queries, sections then their lessons, each in curriculum order (D38: no N+1). The `published` scope keeps
   * only published lessons and drops sections left without one (course spec §4.2).
   */
  private async loadTree(
    manager: EntityManager,
    course: Course,
    scope: TreeScope,
  ): Promise<CourseTree> {
    const sections = await manager.find(CourseSection, {
      where: { courseId: course.id },
      order: { position: 'ASC' },
    });
    const lessons =
      sections.length === 0
        ? []
        : await manager.find(CourseLesson, {
            where: {
              sectionId: In(sections.map((section) => section.id)),
              ...(scope === 'published' ? { status: 'published' as const } : {}),
            },
            order: { position: 'ASC' },
          });
    const tree = sections.map((section) => ({
      section,
      lessons: lessons.filter((lesson) => lesson.sectionId === section.id),
    }));
    return {
      course,
      sections: scope === 'published' ? tree.filter((entry) => entry.lessons.length > 0) : tree,
    };
  }
}
