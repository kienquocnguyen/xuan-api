import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity.js';

export type AuthProvider = 'google';

/** How a user signs in: one row per external identity (database.md §12). */
@Entity('auth_identities')
@Unique('uq_auth_identities_provider_provider_user_id', ['provider', 'providerUserId'])
@Unique('uq_auth_identities_user_id_provider', ['userId', 'provider'])
@Check('ck_auth_identities_provider', `"provider" IN ('google')`)
export class AuthIdentity {
  @PrimaryColumn({
    type: 'uuid',
    default: () => 'uuidv7()',
    primaryKeyConstraintName: 'pk_auth_identities',
  })
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'fk_auth_identities_user_id' })
  user?: User;

  @Column({ type: 'varchar', length: 32 })
  provider!: AuthProvider;

  @Column({ name: 'provider_user_id', type: 'varchar', length: 255 })
  providerUserId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
