import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { Role } from '../../http/auth/role.js';

/** An account (database.md §12). Provider-specific data lives in `auth_identities`. */
@Entity('users')
@Unique('uq_users_email', ['email'])
@Check('ck_users_email_lowercase', `"email" = lower("email")`)
@Check('ck_users_display_name_not_blank', `btrim("display_name") <> ''`)
@Check('ck_users_role', `"role" IN ('user', 'editor', 'admin')`)
export class User {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()', primaryKeyConstraintName: 'pk_users' })
  id!: string;

  @Column({ type: 'varchar', length: 320 })
  email!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 200 })
  displayName!: string;

  @Column({ name: 'avatar_url', type: 'varchar', length: 2048, nullable: true })
  avatarUrl!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'user' })
  role!: Role;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
