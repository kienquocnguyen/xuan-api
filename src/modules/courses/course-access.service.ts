import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type Repository } from 'typeorm';
import { isForeignKeyViolation } from '../../database/postgres-errors.js';
import { AppError } from '../../errors/app-error.js';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { UserProfilesReader } from '../users/user-profiles.reader.js';
import {
  ACTIVE_ADMIN_GRANT_PREDICATE,
  CourseAccessGrant,
  type GrantSource,
} from './course-access-grant.entity.js';
import { Course } from './course.entity.js';
import type { GrantView } from './dto/course-access.dto.js';

/** The `RETURNING *` row of the grant upsert: database column names. */
type GrantRow = {
  id: string;
  user_id: string;
  course_id: string;
  source: GrantSource;
  granted_by_user_id: string | null;
  granted_at: Date;
  revoked_at: Date | null;
  revoked_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

function grantFromRow(row: GrantRow): CourseAccessGrant {
  return Object.assign(new CourseAccessGrant(), {
    id: row.id,
    userId: row.user_id,
    courseId: row.course_id,
    source: row.source,
    grantedByUserId: row.granted_by_user_id,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
    revokedByUserId: row.revoked_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/** Grant, revoke and list course access, and the access check (course spec §5.3, AD16). No course lock: single statements. */
@Injectable()
export class CourseAccessService {
  constructor(
    @InjectRepository(CourseAccessGrant) private readonly grants: Repository<CourseAccessGrant>,
    @InjectRepository(Course) private readonly courses: Repository<Course>,
    private readonly profiles: UserProfilesReader,
  ) {}

  /**
   * One upsert on the partial unique index (spike S8): a repeat returns the same active grant. Business-idempotent
   * (same id, `grantedAt`, DTO), but `DO UPDATE` rewrites `updated_at`. The response is the row as of this
   * statement, never a re-read, so a revoke that commits afterwards can't change what this grant reports.
   */
  async grant(courseId: string, userId: string, adminId: string): Promise<GrantView> {
    let row: GrantRow;
    try {
      const result = await this.grants
        .createQueryBuilder()
        .insert()
        .into(CourseAccessGrant)
        .values({ userId, courseId, source: 'admin', grantedByUserId: adminId })
        .orUpdate(['updated_at'], ['user_id', 'course_id'], {
          indexPredicate: ACTIVE_ADMIN_GRANT_PREDICATE,
        })
        .returning('*')
        .updateEntity(false)
        .execute();
      row = (result.raw as GrantRow[])[0];
    } catch (error) {
      throw this.translate(error);
    }
    const [view] = await this.withProfiles([grantFromRow(row)]);
    return view;
  }

  /** Closes the active admin grant, if any (204 either way). Progress is never touched (CP2). */
  async revoke(courseId: string, userId: string, adminId: string): Promise<void> {
    const result = await this.grants
      .createQueryBuilder()
      .update(CourseAccessGrant)
      .set({ revokedAt: () => 'now()', revokedByUserId: adminId })
      .where('user_id = :userId AND course_id = :courseId', { userId, courseId })
      .andWhere(ACTIVE_ADMIN_GRANT_PREDICATE)
      .execute();
    if (result.affected === 0 && !(await this.courses.existsBy({ id: courseId }))) {
      throw new AppError(baselineErrors.NOT_FOUND);
    }
  }

  /** The course's whole grant history, newest first (unpaginated: course spec §11.4). */
  async listForCourse(courseId: string): Promise<GrantView[]> {
    if (!(await this.courses.existsBy({ id: courseId }))) {
      throw new AppError(baselineErrors.NOT_FOUND);
    }
    const grants = await this.grants.find({
      where: { courseId },
      order: { grantedAt: 'DESC', id: 'DESC' },
    });
    return this.withProfiles(grants);
  }

  /** Access ⇔ an active grant of any source. One indexed read per request, never cached (spec §5.2, §7.1). */
  async hasActiveAccess(userId: string, courseId: string): Promise<boolean> {
    return this.grants.exists({ where: { userId, courseId, revokedAt: IsNull() } });
  }

  /** One profile query for every user the grants name (no N+1). */
  private async withProfiles(grants: CourseAccessGrant[]): Promise<GrantView[]> {
    const ids = grants.flatMap((grant) =>
      [grant.userId, grant.grantedByUserId, grant.revokedByUserId].filter(
        (id): id is string => id !== null,
      ),
    );
    const found = await this.profiles.findPublicProfiles(ids);
    const profiles = new Map(found.map((profile) => [profile.id, profile]));
    return grants.map((grant) => ({ grant, profiles }));
  }

  /** D11: the courses service gives the FK violations their meaning (I15); the granter is the session admin. */
  private translate(error: unknown): unknown {
    return isForeignKeyViolation(error, 'fk_course_access_grants_user_id') ||
      isForeignKeyViolation(error, 'fk_course_access_grants_course_id')
      ? new AppError(baselineErrors.NOT_FOUND)
      : error;
  }
}
