import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { APP_CONFIG } from '../../config/app-config.module.js';
import type { AppConfig } from '../../config/load-config.js';
import { isUniqueViolation } from '../../database/postgres-errors.js';
import { AuthIdentity } from './auth-identity.entity.js';
import { profileFromGoogle, type SyncedProfile } from './google-profile.js';
import type { GoogleIdentity } from './google/google-identity.gateway.js';
import { User } from './user.entity.js';
import { SignInError } from './users.errors.js';

/** Accounts: lookups, Google sign-in and role management. */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.users.findOneBy({ id });
  }

  /**
   * Creates or updates the local account for a verified Google identity (auth design §4):
   * - known identity → sync email, name and avatar (never the role, except the admin bootstrap);
   * - unknown identity, free email → new `user` (or `admin` if allowlisted) + its identity;
   * - an email that belongs to another account → ACCOUNT_CONFLICT (no silent linking, A9).
   * A concurrent first sign-in loses a unique race; it is retried once as a lookup (D11).
   */
  async signInWithGoogle(identity: GoogleIdentity): Promise<User> {
    if (!identity.emailVerified) throw new SignInError('EMAIL_NOT_VERIFIED');
    const profile = profileFromGoogle(identity);
    const bootstrapAdmin = this.config.auth.adminEmails.includes(profile.email);
    const attempt = () =>
      this.dataSource.transaction((manager) =>
        this.upsertGoogleAccount(manager, identity.subject, profile, bootstrapAdmin),
      );
    try {
      return await attempt();
    } catch (error) {
      if (!this.isAccountRace(error)) throw error;
    }
    try {
      return await attempt();
    } catch (error) {
      if (isUniqueViolation(error, 'uq_users_email')) throw new SignInError('ACCOUNT_CONFLICT');
      throw error;
    }
  }

  private isAccountRace(error: unknown): boolean {
    return (
      isUniqueViolation(error, 'uq_users_email') ||
      isUniqueViolation(error, 'uq_auth_identities_provider_provider_user_id')
    );
  }

  /** Runs inside the sign-in transaction: only `manager` is used (I8). */
  private async upsertGoogleAccount(
    manager: EntityManager,
    subject: string,
    profile: SyncedProfile,
    bootstrapAdmin: boolean,
  ): Promise<User> {
    const known = await manager.findOneBy(AuthIdentity, {
      provider: 'google',
      providerUserId: subject,
    });
    if (known) {
      await manager.update(
        User,
        { id: known.userId },
        { ...profile, ...(bootstrapAdmin ? { role: 'admin' as const } : {}) },
      );
      return manager.findOneByOrFail(User, { id: known.userId });
    }
    if (await manager.existsBy(User, { email: profile.email })) {
      throw new SignInError('ACCOUNT_CONFLICT');
    }
    const created = await manager.insert(User, {
      ...profile,
      role: bootstrapAdmin ? 'admin' : 'user',
    });
    const userId = (created.identifiers[0] as { id: string }).id;
    await manager.insert(AuthIdentity, { userId, provider: 'google', providerUserId: subject });
    return manager.findOneByOrFail(User, { id: userId });
  }
}
