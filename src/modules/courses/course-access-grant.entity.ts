import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Course } from './course.entity.js';

export const GRANT_SOURCES = ['admin'] as const;
export type GrantSource = (typeof GRANT_SOURCES)[number];

/** The partial unique index's predicate; the grant upsert's `ON CONFLICT … WHERE` repeats it (AD16). */
export const ACTIVE_ADMIN_GRANT_PREDICATE = `"source" = 'admin' AND "revoked_at" IS NULL`;

/**
 * `course_access_grants` (database.md §12): one row per grant (course spec §5, OD-1); access ⇔ an active row.
 * The three user FKs are declared by entity name, so this module never imports the users entity (AD14, I2).
 * TypeORM's generate ignores the partial index's predicate (spike S8): changing it needs a hand-written migration.
 */
@Entity('course_access_grants')
@Index('uq_course_access_grants_user_id_course_id_active_admin', ['userId', 'courseId'], {
  unique: true,
  where: ACTIVE_ADMIN_GRANT_PREDICATE,
})
@Index('ix_course_access_grants_user_id_course_id', ['userId', 'courseId'])
@Check('ck_course_access_grants_source', `"source" IN ('admin')`)
@Check(
  'ck_course_access_grants_admin_has_granter',
  `"source" <> 'admin' OR "granted_by_user_id" IS NOT NULL`,
)
@Check(
  'ck_course_access_grants_revocation_pair',
  `("revoked_at" IS NULL) = ("revoked_by_user_id" IS NULL)`,
)
export class CourseAccessGrant {
  @PrimaryColumn({
    type: 'uuid',
    default: () => 'uuidv7()',
    primaryKeyConstraintName: 'pk_course_access_grants',
  })
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @ForeignKey('User', { name: 'fk_course_access_grants_user_id', onDelete: 'RESTRICT' })
  userId!: string;

  @Column({ name: 'course_id', type: 'uuid' })
  @ForeignKey(() => Course, { name: 'fk_course_access_grants_course_id', onDelete: 'RESTRICT' })
  courseId!: string;

  @Column({ type: 'varchar', length: 16 })
  source!: GrantSource;

  @Column({ name: 'granted_by_user_id', type: 'uuid', nullable: true })
  @ForeignKey('User', { name: 'fk_course_access_grants_granted_by_user_id', onDelete: 'RESTRICT' })
  grantedByUserId!: string | null;

  @Column({ name: 'granted_at', type: 'timestamptz', default: () => 'now()' })
  grantedAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'revoked_by_user_id', type: 'uuid', nullable: true })
  @ForeignKey('User', { name: 'fk_course_access_grants_revoked_by_user_id', onDelete: 'RESTRICT' })
  revokedByUserId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  /** Moves on a revocation and on a repeated grant (the upsert's `DO UPDATE`, S8); never on the wire. */
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
