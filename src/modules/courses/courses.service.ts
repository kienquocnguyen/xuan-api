import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { In, type DataSource, type EntityManager, type Repository } from 'typeorm';
import { isForeignKeyViolation, isUniqueViolation } from '../../database/postgres-errors.js';
import { AppError } from '../../errors/app-error.js';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { CourseLesson } from './course-lesson.entity.js';
import { CourseSection } from './course-section.entity.js';
import type { AdminCourseListItem, CourseTree } from './course-tree.js';
import { Course } from './course.entity.js';
import { coursesErrors } from './courses.errors.js';
import { isCompleteCurriculumOrder } from './curriculum-order.js';
import {
  COURSE_SLUG_PATTERN,
  type CurriculumOrderInput,
  type SaveCourseInput,
  type SaveCourseLessonInput,
  type SaveCourseSectionInput,
} from './dto/save-course.dto.js';

type TreeScope = 'all' | 'published';

/** Fixed identifiers only: never built from input. */
const POSITION_LEVELS = {
  sections: { table: 'course_sections', parent: 'course_id' },
  lessons: { table: 'course_lessons', parent: 'section_id' },
} as const;

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
    return this.loadPublishedTree(await this.findPublishedBySlug(slug));
  }

  /** A published course by slug, else 404: drafts too (no existence leak). Shared with the learner routes. */
  async findPublishedBySlug(slug: string): Promise<Course> {
    // An impossible slug can't exist (ck_courses_slug_format); skip the query (a NUL would make Postgres throw).
    if (slug.length > 160 || !COURSE_SLUG_PATTERN.test(slug)) {
      throw new AppError(baselineErrors.NOT_FOUND);
    }
    const course = await this.courses.findOneBy({ slug, status: 'published' });
    if (!course) throw new AppError(baselineErrors.NOT_FOUND);
    return course;
  }

  /** The course's published lessons in curriculum order, sections without one omitted (course spec §4.2). */
  async loadPublishedTree(course: Course): Promise<CourseTree> {
    return this.loadTree(this.dataSource.manager, course, 'published');
  }

  /** The same for several courses in two queries, whatever their number (D38: no N+1). Keeps the input order. */
  async loadPublishedTrees(courses: readonly Course[]): Promise<CourseTree[]> {
    if (courses.length === 0) return [];
    const sections = await this.dataSource.manager.find(CourseSection, {
      where: { courseId: In(courses.map((course) => course.id)) },
      order: { position: 'ASC' },
    });
    const lessons =
      sections.length === 0
        ? []
        : await this.dataSource.manager.find(CourseLesson, {
            where: { sectionId: In(sections.map((section) => section.id)), status: 'published' },
            order: { position: 'ASC' },
          });
    return courses.map((course) => ({
      course,
      sections: sections
        .filter((section) => section.courseId === course.id)
        .map((section) => ({
          section,
          lessons: lessons.filter((lesson) => lesson.sectionId === section.id),
        }))
        .filter((entry) => entry.lessons.length > 0),
    }));
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
        const unchanged =
          input.slug === course.slug &&
          input.title === course.title &&
          input.summary === course.summary;
        if (unchanged) return; // no write, so updated_at stays
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

  async addSection(courseId: string, input: SaveCourseSectionInput): Promise<CourseTree> {
    await this.withCourseLock(courseId, async (manager) => {
      await manager.insert(CourseSection, {
        courseId,
        title: input.title,
        position: await this.nextPosition(manager, 'sections', courseId),
      });
      await this.touchCourse(manager, courseId);
    });
    return this.getForAdmin(courseId);
  }

  async renameSection(sectionId: string, input: SaveCourseSectionInput): Promise<CourseTree> {
    const courseId = await this.courseIdOfSection(sectionId);
    await this.withCourseLock(courseId, async (manager) => {
      const section = await this.lockedSection(manager, courseId, sectionId);
      if (section.title === input.title) return; // no write
      await manager.update(CourseSection, { id: sectionId }, { title: input.title });
      await this.touchCourse(manager, courseId);
    });
    return this.getForAdmin(courseId);
  }

  async deleteSection(sectionId: string): Promise<void> {
    const courseId = await this.courseIdOfSection(sectionId);
    await this.withCourseLock(courseId, async (manager) => {
      const section = await this.lockedSection(manager, courseId, sectionId);
      // fk_course_lessons_section_id (RESTRICT) is the backstop; this check gives the meaningful 409.
      if ((await manager.countBy(CourseLesson, { sectionId })) > 0) {
        throw new AppError(coursesErrors.SECTION_NOT_EMPTY);
      }
      await manager.delete(CourseSection, { id: sectionId });
      await this.closeGap(manager, 'sections', courseId, section.position);
      await this.touchCourse(manager, courseId);
    });
  }

  async addLesson(sectionId: string, input: SaveCourseLessonInput): Promise<CourseTree> {
    const courseId = await this.courseIdOfSection(sectionId);
    await this.withCourseLock(courseId, async (manager) => {
      await this.lockedSection(manager, courseId, sectionId);
      await manager.insert(CourseLesson, {
        sectionId,
        title: input.title,
        position: await this.nextPosition(manager, 'lessons', sectionId),
        vimeoVideoId: input.videoId,
        vimeoHash: input.privacyHash,
        durationSeconds: input.durationSeconds,
      });
      await this.touchCourse(manager, courseId);
    });
    return this.getForAdmin(courseId);
  }

  /** Full replacement of the title and Vimeo reference; references stay editable when published (spec §8.2). */
  async updateLesson(lessonId: string, input: SaveCourseLessonInput): Promise<CourseTree> {
    const courseId = await this.courseIdOfLesson(lessonId);
    await this.withCourseLock(courseId, async (manager) => {
      const lesson = await this.lockedLesson(manager, courseId, lessonId);
      // P2 (ck_course_lessons_published_has_video is the backstop).
      if (lesson.status === 'published' && input.videoId === null) {
        throw new AppError(coursesErrors.LESSON_VIDEO_MISSING);
      }
      const unchanged =
        lesson.title === input.title &&
        lesson.vimeoVideoId === input.videoId &&
        lesson.vimeoHash === input.privacyHash &&
        lesson.durationSeconds === input.durationSeconds;
      if (unchanged) return; // no write
      await manager.update(
        CourseLesson,
        { id: lessonId },
        {
          title: input.title,
          vimeoVideoId: input.videoId,
          vimeoHash: input.privacyHash,
          durationSeconds: input.durationSeconds,
        },
      );
      await this.touchCourse(manager, courseId);
    });
    return this.getForAdmin(courseId);
  }

  async publishLesson(lessonId: string): Promise<CourseTree> {
    const courseId = await this.courseIdOfLesson(lessonId);
    await this.withCourseLock(courseId, async (manager) => {
      const lesson = await this.lockedLesson(manager, courseId, lessonId);
      if (lesson.status === 'published') return; // idempotent: no write
      if (lesson.vimeoVideoId === null) throw new AppError(coursesErrors.LESSON_VIDEO_MISSING);
      await manager.update(CourseLesson, { id: lessonId }, { status: 'published' });
      await this.touchCourse(manager, courseId);
    });
    return this.getForAdmin(courseId);
  }

  async unpublishLesson(lessonId: string): Promise<CourseTree> {
    const courseId = await this.courseIdOfLesson(lessonId);
    await this.withCourseLock(courseId, async (manager, course) => {
      const lesson = await this.lockedLesson(manager, courseId, lessonId);
      if (lesson.status === 'draft') return; // idempotent: no write
      // P1: the only operation that lowers the published-lesson count, counted under the lock (spec §10.6).
      if (
        course.status === 'published' &&
        (await this.countPublishedLessons(manager, courseId)) <= 1
      ) {
        throw new AppError(coursesErrors.COURSE_NEEDS_PUBLISHED_LESSON);
      }
      await manager.update(CourseLesson, { id: lessonId }, { status: 'draft' });
      await this.touchCourse(manager, courseId);
    });
    return this.getForAdmin(courseId);
  }

  async deleteLesson(lessonId: string): Promise<void> {
    const courseId = await this.courseIdOfLesson(lessonId);
    try {
      await this.deleteLessonLocked(courseId, lessonId);
    } catch (error) {
      // P5's backstop (spec §10.4): RESTRICT keeps a lesson with learner progress; unpublishing is the way out.
      if (isForeignKeyViolation(error, 'fk_lesson_progress_lesson_id')) {
        throw new AppError(coursesErrors.LESSON_HAS_PROGRESS);
      }
      throw error;
    }
  }

  private async deleteLessonLocked(courseId: string, lessonId: string): Promise<void> {
    await this.withCourseLock(courseId, async (manager) => {
      const lesson = await this.lockedLesson(manager, courseId, lessonId);
      if (lesson.status === 'published') throw new AppError(coursesErrors.LESSON_IS_PUBLISHED);
      await manager.delete(CourseLesson, { id: lessonId });
      await this.closeGap(manager, 'lessons', lesson.sectionId, lesson.position);
      await this.touchCourse(manager, courseId);
    });
  }

  /**
   * Applies a complete order (course spec §10.3): section positions, then each lesson's section and position.
   * The position uniques are checked at commit (S7), so the plain updates in between may collide. Only rows
   * that actually change are written; lesson ids never change.
   */
  async reorder(courseId: string, input: CurriculumOrderInput): Promise<CourseTree> {
    await this.withCourseLock(courseId, async (manager) => {
      const sections = await manager.findBy(CourseSection, { courseId });
      const lessons =
        sections.length === 0
          ? []
          : await manager.findBy(CourseLesson, {
              sectionId: In(sections.map((section) => section.id)),
            });
      const current = {
        sectionIds: sections.map((section) => section.id),
        lessonIds: lessons.map((lesson) => lesson.id),
      };
      if (!isCompleteCurriculumOrder(current, input)) {
        throw new AppError(coursesErrors.CURRICULUM_ORDER_MISMATCH);
      }
      const sectionsById = new Map(sections.map((section) => [section.id, section]));
      const lessonsById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
      let changed = false;
      for (const [position, entry] of input.sections.entries()) {
        if (sectionsById.get(entry.id)?.position !== position) {
          await manager.update(CourseSection, { id: entry.id }, { position });
          changed = true;
        }
        for (const [lessonPosition, lessonId] of entry.lessonIds.entries()) {
          const lesson = lessonsById.get(lessonId);
          if (lesson?.sectionId !== entry.id || lesson.position !== lessonPosition) {
            await manager.update(
              CourseLesson,
              { id: lessonId },
              { sectionId: entry.id, position: lessonPosition },
            );
            changed = true;
          }
        }
      }
      if (changed) await this.touchCourse(manager, courseId);
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

  /**
   * A curriculum change is a change of its course: `courses.updated_at` is the latest meaningful change to the course
   * or its curriculum (database.md §12). Called under L1, after the change, and never for a no-op.
   */
  private async touchCourse(manager: EntityManager, courseId: string): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(Course)
      .set({ updatedAt: () => 'now()' })
      .where('id = :courseId', { courseId })
      .execute();
  }

  /** Plain read before the lock: `course_id` never changes, so the id stays valid (spec §10.6). */
  private async courseIdOfSection(sectionId: string): Promise<string> {
    const section = await this.dataSource.manager.findOneBy(CourseSection, { id: sectionId });
    if (!section) throw new AppError(baselineErrors.NOT_FOUND);
    return section.courseId;
  }

  /** Lessons move only within their course, so the course id read here stays valid under the lock. */
  private async courseIdOfLesson(lessonId: string): Promise<string> {
    const row = await this.dataSource.manager
      .createQueryBuilder(CourseLesson, 'l')
      .innerJoin(CourseSection, 's', 's.id = l.section_id')
      .select('s.course_id', 'courseId')
      .where('l.id = :lessonId', { lessonId })
      .getRawOne<{ courseId: string }>();
    if (!row) throw new AppError(baselineErrors.NOT_FOUND);
    return row.courseId;
  }

  /** Re-read under the lock: a concurrent delete gives 404. */
  private async lockedSection(
    manager: EntityManager,
    courseId: string,
    sectionId: string,
  ): Promise<CourseSection> {
    const section = await manager.findOneBy(CourseSection, { id: sectionId, courseId });
    if (!section) throw new AppError(baselineErrors.NOT_FOUND);
    return section;
  }

  /** Re-read under the lock, joined to the locked course: a concurrent delete gives 404. */
  private async lockedLesson(
    manager: EntityManager,
    courseId: string,
    lessonId: string,
  ): Promise<CourseLesson> {
    const lesson = await manager
      .createQueryBuilder(CourseLesson, 'l')
      .innerJoin(CourseSection, 's', 's.id = l.section_id')
      .where('l.id = :lessonId', { lessonId })
      .andWhere('s.course_id = :courseId', { courseId })
      .getOne();
    if (!lesson) throw new AppError(baselineErrors.NOT_FOUND);
    return lesson;
  }

  /** New sections and lessons append at the end of their parent (spec §10.3). */
  private async nextPosition(
    manager: EntityManager,
    level: 'sections' | 'lessons',
    parentId: string,
  ): Promise<number> {
    const { table, parent } = POSITION_LEVELS[level];
    const [row] = await manager.query<{ next: number }[]>(
      `SELECT COALESCE(MAX("position"), -1) + 1 AS "next" FROM "${table}" WHERE "${parent}" = $1`,
      [parentId],
    );
    return row.next;
  }

  /** Keeps positions `0..n-1` after a delete (database.md §12). */
  private async closeGap(
    manager: EntityManager,
    level: 'sections' | 'lessons',
    parentId: string,
    position: number,
  ): Promise<void> {
    const { table, parent } = POSITION_LEVELS[level];
    await manager.query(
      `UPDATE "${table}" SET "position" = "position" - 1, "updated_at" = now()
       WHERE "${parent}" = $1 AND "position" > $2`,
      [parentId, position],
    );
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
