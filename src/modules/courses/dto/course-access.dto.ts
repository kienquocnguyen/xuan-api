import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import type { PublicProfile } from '../../users/user-profiles.reader.js';
import {
  type CourseAccessGrant,
  GRANT_SOURCES,
  type GrantSource,
} from '../course-access-grant.entity.js';

export const courseAccessParamsSchema = z
  .strictObject({ courseId: z.uuid(), userId: z.uuid() })
  .meta({ id: 'CourseAccessParams' });
export type CourseAccessParams = z.infer<typeof courseAccessParamsSchema>;

/** A grant with the public profiles of everyone it names (learner, granter, revoker). */
export type GrantView = Readonly<{
  grant: CourseAccessGrant;
  profiles: ReadonlyMap<string, PublicProfile>;
}>;

/** A public profile only: no email, no role (UserProfilesReader, AD14). */
export class CourseAccessUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: String, nullable: true }) avatarUrl!: string | null;
}

/** One grant in a course's access history (contract identifier, I19; course spec §11.4). */
export class CourseAccessGrantDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: CourseAccessUserDto }) user!: CourseAccessUserDto;
  @ApiProperty({ enum: GRANT_SOURCES }) source!: GrantSource;
  @ApiProperty({ format: 'date-time' }) grantedAt!: string;
  @ApiProperty({ type: CourseAccessUserDto, nullable: true })
  grantedBy!: CourseAccessUserDto | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) revokedAt!: string | null;
  @ApiProperty({ type: CourseAccessUserDto, nullable: true })
  revokedBy!: CourseAccessUserDto | null;
}

function toUserDto(profiles: ReadonlyMap<string, PublicProfile>, id: string): CourseAccessUserDto {
  // The FKs (RESTRICT) guarantee the user exists; the reader returned every id it was asked for.
  const { displayName, avatarUrl } = profiles.get(id) as PublicProfile;
  return { id, displayName, avatarUrl };
}

/** Whitelist by construction (I10). */
export function toCourseAccessGrantDto({ grant, profiles }: GrantView): CourseAccessGrantDto {
  return {
    id: grant.id,
    user: toUserDto(profiles, grant.userId),
    source: grant.source,
    grantedAt: grant.grantedAt.toISOString(),
    grantedBy: grant.grantedByUserId === null ? null : toUserDto(profiles, grant.grantedByUserId),
    revokedAt: grant.revokedAt === null ? null : grant.revokedAt.toISOString(),
    revokedBy: grant.revokedByUserId === null ? null : toUserDto(profiles, grant.revokedByUserId),
  };
}
