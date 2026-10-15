import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, type Repository } from 'typeorm';
import { User } from './user.entity.js';

/** What other modules may know about a user: no email, no role (blog spec B8, architecture AD14). */
export type PublicProfile = Readonly<{ id: string; displayName: string; avatarUrl: string | null }>;

/** Read-only public profiles, exported for other modules (e.g. post authors). */
@Injectable()
export class UserProfilesReader {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  async findPublicProfiles(ids: readonly string[]): Promise<PublicProfile[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const rows = await this.users.find({
      select: { id: true, displayName: true, avatarUrl: true },
      where: { id: In(unique) },
    });
    return rows.map(({ id, displayName, avatarUrl }) => ({ id, displayName, avatarUrl }));
  }
}
