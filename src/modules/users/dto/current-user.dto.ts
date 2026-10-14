import { ApiProperty } from '@nestjs/swagger';
import { ROLES, type Role } from '../../../http/auth/role.js';
import type { User } from '../user.entity.js';

/** The signed-in user (contract identifier, I19). The web app routes by `role`. */
export class CurrentUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'email' }) email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uri' }) avatarUrl!: string | null;
  @ApiProperty({ enum: ROLES }) role!: Role;
}

export function toCurrentUserDto(user: User): CurrentUserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
  };
}
