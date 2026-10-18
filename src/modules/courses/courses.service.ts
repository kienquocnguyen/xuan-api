import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { In, type DataSource, type EntityManager, type Repository } from 'typeorm';
import { isUniqueViolation } from '../../database/postgres-errors.js';
import { AppError } from '../../errors/app-error.js';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { CourseLesson } from './course-lesson.entity.js';
import { CourseSection } from './course-section.entity.js';
import type { AdminCourseListItem, CourseTree } from './course-tree.js';
import { Course } from './course.entity.js';
import { coursesErrors } from './courses.errors.js';
import { COURSE_SLUG_PATTERN, type SaveCourseInput } from './dto/save-course.dto.js';

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

  async listForAdmin(): Promise<AdminCourseListItem[]> {
    const courses = await this.courses.find({ order: { updatedAt: 'DESC', id: 'DESC' } });
    // One grouped query for every course's counts, not one per course.
    const counts = await this.dataSource
      .createQueryBuilder()
      .select('s.course_id', 'courseId')
      .addSelect('count(*)::int', 'lessonCount')
      .addSelect(`count(*) FILTER (WHERE l.status = 'published')::int`, 'publishedLessonCount')
      .from(CourseLesson, 'l')
      .innerJoin(CourseSection, 's', 's.id = l.section_id')
      .groupBy('s.course_id')
      .getRawMany<{ courseId: string; lessonCount: number; publishedLessonCount: number }>();
    const byCourse = new Map(counts.map((row) => [row.courseId, row]));
    return courses.map((course) => ({
      course,
      lessonCount: byCourse.get(course.id)?.lessonCount ?? 0,
      publishedLessonCount: byCourse.get(course.id)?.publishedLessonCount ?? 0,
    }));
  }

  async getForAdmin(courseId: string): Promise<CourseTree> {
    const course = await this.courses.findOneBy({ id: courseId });
    if (!course) throw new AppError(baselineErrors.NOT_FOUND);
    return this.loadTree(this.dataSource.manager, course, 'all');
  }

  async create(input: SaveCourseInput): Promise<CourseTree> {
    let id: string;
    try {
      const result = await this.courses.insert({
        slug: input.slug,
        title: input.title,
        summary: input.summary,
      });
      id = (result.identifiers[0] as { id: string }).id;
    } catch (error) {
      throw this.translate(error);
    }
    return this.getForAdmin(id);
  }

  async update(courseId: string, input: SaveCourseInput): Promise<CourseTree> {
    try {
      await this.withCourseLock(courseId, async (manager, course) => {
        // Once ever published, the slug is the course's permanent URL (course spec §10.1).
        if (course.publishedAt !== null && input.slug !== course.slug) {
          throw new AppError(coursesErrors.COURSE_SLUG_LOCKED);
        }
        await manager.update(
          Course,
          { id: courseId },
          { slug: input.slug, title: input.title, summary: input.summary },
        );
      });
    } catch (error) {
      throw this.translate(error);
    }
    return this.getForAdmin(courseId);
  }

  async publish(courseId: string): Promise<CourseTree> {
    await this.withCourseLock(courseId, async (manager, course) => {
      if (course.status === 'published') return; // idempotent: no write
      // P1: counted under the lock, so a concurrent lesson unpublish can't slip in between (course spec §10.6).
      if ((await this.countPublishedLessons(manager, courseId)) < 1) {
        throw new AppError(coursesErrors.COURSE_NEEDS_PUBLISHED_LESSON);
      }
      await manager
        .createQueryBuilder()
        .update(Course)
        // The first publication's instant is kept forever (as posts, B16).
        .set({ status: 'published', publishedAt: () => 'COALESCE("published_at", now())' })
        .where('id = :courseId', { courseId })
        .execute();
    });
    return this.getForAdmin(courseId);
  }

  async unpublish(courseId: string): Promise<CourseTree> {
    await this.withCourseLock(courseId, async (manager, course) => {
      if (course.status === 'draft') return; // idempotent: no write
      // published_at stays, so the slug stays locked.
      await manager.update(Course, { id: courseId }, { status: 'draft' });
    });
    return this.getForAdmin(courseId);
  }

  /**
   * Lock rule L1 (AD15, course spec §10.6): one transaction whose first statement locks the course row
   * `FOR NO KEY UPDATE`; it serializes every curriculum change of that course without blocking FK `KEY SHARE`
   * checks. `work` uses only `manager` (I8).
   */
  private async withCourseLock<T>(
    courseId: string,
    work: (manager: EntityManager, course: Course) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      const course = await manager.findOne(Course, {
        where: { id: courseId },
        lock: { mode: 'for_no_key_update' },
      });
      if (!course) throw new AppError(baselineErrors.NOT_FOUND);
      return work(manager, course);
    });
  }

  private async countPublishedLessons(manager: EntityManager, courseId: string): Promise<number> {
    return manager
      .createQueryBuilder(CourseLesson, 'l')
      .innerJoin(CourseSection, 's', 's.id = l.section_id')
      .where('s.course_id = :courseId', { courseId })
      .andWhere(`l.status = 'published'`)
      .getCount();
  }

  /** D11: the courses service, not HTTP, gives the unique violation its meaning (I15). */
  private translate(error: unknown): unknown {
    return isUniqueViolation(error, 'uq_courses_slug')
      ? new AppError(coursesErrors.COURSE_SLUG_TAKEN)
      : error;
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
