import { ApiProperty } from '@nestjs/swagger';
import { ROLES, type Role } from '../../../http/auth/role.js';
import type { User } from '../user.entity.js';

/** A user as seen by an admin (contract identifier, I19). */
export class AdminUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'email' }) email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uri' }) avatarUrl!: string | null;
  @ApiProperty({ enum: ROLES }) role!: Role;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export function toAdminUserDto(user: User): AdminUserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}
