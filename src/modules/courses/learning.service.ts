import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AppError } from '../../errors/app-error.js';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { CourseAccessService } from './course-access.service.js';
import { CourseLesson } from './course-lesson.entity.js';
import { CourseSection } from './course-section.entity.js';
import type { CourseTree, LearnerCourseListItem } from './course-tree.js';
import { Course } from './course.entity.js';
import { coursesErrors } from './courses.errors.js';
import { CoursesService } from './courses.service.js';
import { type LocatedPlayback, locatePlayback } from './playback.js';

/**
 * Learner use cases (course spec §7, §11.2). Every 404 check runs before the access check, so an ungranted user
 * learns nothing beyond the public outline. Access is read per request, never cached (§7.1). Admins have no
 * implicit learner access (§5.3).
 */
@Injectable()
export class LearningService {
  constructor(
    @InjectRepository(Course) private readonly courses: Repository<Course>,
    @InjectRepository(CourseLesson) private readonly lessons: Repository<CourseLesson>,
    private readonly catalog: CoursesService,
    private readonly access: CourseAccessService,
  ) {}

  /** Published courses with an active grant, newest `publishedAt` first; one query plus one grouped count. */
  async listCourses(userId: string): Promise<LearnerCourseListItem[]> {
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
    if (courses.length === 0) return [];
    const rows = await this.lessons
      .createQueryBuilder('l')
      .innerJoin(CourseSection, 's', 's.id = l.section_id')
      .select('s.course_id', 'courseId')
      .addSelect('count(*)::int', 'totalLessons')
      .where(`l.status = 'published'`)
      .andWhere('s.course_id IN (:...courseIds)', { courseIds: courses.map((course) => course.id) })
      .groupBy('s.course_id')
      .getRawMany<{ courseId: string; totalLessons: number }>();
    const byCourse = new Map(rows.map((row) => [row.courseId, row.totalLessons]));
    return courses.map((course) => ({ course, totalLessons: byCourse.get(course.id) ?? 0 }));
  }

  async getCourse(userId: string, slug: string): Promise<CourseTree> {
    const course = await this.catalog.findPublishedBySlug(slug);
    await this.requireAccess(userId, course.id);
    return this.catalog.loadPublishedTree(course);
  }

  /** The lesson must be published and in this course (§7 step 3), else 404, before the access check. */
  async getPlayback(userId: string, slug: string, lessonId: string): Promise<LocatedPlayback> {
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
}
