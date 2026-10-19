import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, type Repository } from 'typeorm';
import { isForeignKeyViolation } from '../../database/postgres-errors.js';
import { AppError } from '../../errors/app-error.js';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { CourseAccessService } from './course-access.service.js';
import type { CourseTree, LearnerCourseView, ProgressByLesson } from './course-tree.js';
import { Course } from './course.entity.js';
import { coursesErrors } from './courses.errors.js';
import { CoursesService } from './courses.service.js';
import type { SaveLessonProgressInput } from './dto/save-progress.dto.js';
import { LessonProgress } from './lesson-progress.entity.js';
import { type LocatedPlayback, locatePlayback } from './playback.js';
import { clampPosition, resolveResumeLessonId } from './progress.js';

export type PlaybackView = Readonly<{
  located: LocatedPlayback;
  progress: LessonProgress | undefined;
}>;

/**
 * Learner use cases (course spec §7, §9, §11.2). Every 404 check runs before the access check, so an ungranted
 * user learns nothing beyond the public outline. Access is read per request, never cached (§7.1). Admins have no
 * implicit learner access (§5.3). Progress is only ever the caller's own (I9).
 */
@Injectable()
export class LearningService {
  constructor(
    @InjectRepository(Course) private readonly courses: Repository<Course>,
    @InjectRepository(LessonProgress) private readonly progress: Repository<LessonProgress>,
    private readonly catalog: CoursesService,
    private readonly access: CourseAccessService,
  ) {}

  /**
   * Published courses with an active grant of the caller, newest `publishedAt` first. Four queries whatever the
   * number of courses: the courses, their sections, their published lessons, the caller's progress on those.
   */
  async listCourses(userId: string): Promise<LearnerCourseView[]> {
    const courses = await this.courses
      .createQueryBuilder('c')
      .where(`c.status = 'published'`)
      .andWhere(
        `EXISTS (SELECT 1 FROM course_access_grants g
                 WHERE g.course_id = c.id AND g.user_id = :userId AND g.revoked_at IS NULL)`,
        { userId },
      )
      .orderBy('c.publishedAt', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .getMany();
    const trees = await this.catalog.loadPublishedTrees(courses);
    const progress = await this.progressFor(userId, trees.flatMap(lessonIdsOf));
    // A course whose tree came back empty was unpublished after the course read (review M1): not listed.
    return trees.flatMap((tree) => viewOf(tree, progress) ?? []);
  }

  async getCourse(userId: string, slug: string): Promise<LearnerCourseView> {
    const course = await this.catalog.findPublishedBySlug(slug);
    await this.requireAccess(userId, course.id);
    const tree = await this.catalog.loadPublishedTree(course);
    const view = viewOf(tree, await this.progressFor(userId, lessonIdsOf(tree)));
    if (!view) throw new AppError(baselineErrors.NOT_FOUND); // unpublished since it was read
    return view;
  }

  async getPlayback(userId: string, slug: string, lessonId: string): Promise<PlaybackView> {
    const located = await this.locateForLearner(userId, slug, lessonId);
    const progress = await this.progressFor(userId, [located.lesson.id]);
    return { located, progress: progress.get(located.lesson.id) };
  }

  /**
   * Saves the caller's progress (course spec §9.2): the playback checks first (404s, then 403), then one upsert
   * on `uq_lesson_progress_user_id_lesson_id` (D32). Last write wins by arrival for the position (§9.3); the first
   * completion instant is kept (`COALESCE`). No course lock: a save may wait behind a reorder moving its lesson.
   */
  async saveProgress(
    userId: string,
    slug: string,
    lessonId: string,
    input: SaveLessonProgressInput,
  ): Promise<void> {
    const { lesson } = await this.locateForLearner(userId, slug, lessonId);
    try {
      await this.progress.query(
        `INSERT INTO "lesson_progress" ("user_id", "lesson_id", "position_seconds", "completed_at", "last_watched_at")
         VALUES ($1, $2, $3, CASE WHEN $4::boolean THEN now() END, now())
         ON CONFLICT ON CONSTRAINT "uq_lesson_progress_user_id_lesson_id" DO UPDATE SET
           "position_seconds" = EXCLUDED."position_seconds",
           "last_watched_at" = now(),
           "completed_at" = COALESCE("lesson_progress"."completed_at", EXCLUDED."completed_at"),
           "updated_at" = now()`,
        [
          userId,
          lesson.id,
          clampPosition(input.positionSeconds, lesson.durationSeconds),
          input.completed === true,
        ],
      );
    } catch (error) {
      // Only reachable after unpublish → delete between the check and the write (§9.2, D11).
      if (isForeignKeyViolation(error, 'fk_lesson_progress_lesson_id')) {
        throw new AppError(baselineErrors.NOT_FOUND);
      }
      throw error;
    }
  }

  /** The lesson must be published and in this course (§7 step 3), else 404, before the access check. */
  private async locateForLearner(
    userId: string,
    slug: string,
    lessonId: string,
  ): Promise<LocatedPlayback> {
    const course = await this.catalog.findPublishedBySlug(slug);
    const located = locatePlayback(await this.catalog.loadPublishedTree(course), lessonId);
    if (!located) throw new AppError(baselineErrors.NOT_FOUND);
    await this.requireAccess(userId, course.id);
    return located;
  }

  private async requireAccess(userId: string, courseId: string): Promise<void> {
    if (!(await this.access.hasActiveAccess(userId, courseId))) {
      throw new AppError(coursesErrors.COURSE_ACCESS_REQUIRED);
    }
  }

  /** The caller's rows for these lessons only: one query, on the unique's leading `user_id`. */
  private async progressFor(
    userId: string,
    lessonIds: readonly string[],
  ): Promise<ProgressByLesson> {
    if (lessonIds.length === 0) return new Map();
    const rows = await this.progress.findBy({ userId, lessonId: In([...lessonIds]) });
    return new Map(rows.map((row) => [row.lessonId, row]));
  }
}

function lessonIdsOf(tree: CourseTree): string[] {
  return tree.sections.flatMap(({ lessons }) => lessons.map((lesson) => lesson.id));
}

/**
 * Resume over the published lessons only (§9.4, §10.2); never a draft, deleted or other course's lesson. At every
 * commit a published course has a published lesson (P1, lock rule L1), but the course and its lessons are read
 * by separate statements: a course unpublished, then emptied, between them comes back with no lesson. That
 * course is no longer published, so this returns `null` (callers: not listed, 404) rather than invent a target.
 */
function viewOf(tree: CourseTree, all: ProgressByLesson): LearnerCourseView | null {
  const ids = lessonIdsOf(tree);
  const progress = new Map<string, LessonProgress>();
  for (const id of ids) {
    const row = all.get(id);
    if (row) progress.set(id, row);
  }
  const resumeLessonId = resolveResumeLessonId(ids, progress);
  return resumeLessonId === null ? null : { tree, progress, resumeLessonId };
}
