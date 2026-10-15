import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

/** Offset pagination query fields (api-contract.md §3), spread into a module's named query schema. */
export const pageQueryFields = {
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
};

/** `pageInfo` of a paginated payload (contract identifier, I19). */
export class PageInfoDto {
  @ApiProperty({ example: 1 }) page!: number;
  @ApiProperty({ example: 12 }) pageSize!: number;
  @ApiProperty({ example: 134 }) totalItems!: number;
  @ApiProperty({ example: 12 }) totalPages!: number;
}

/** A paginated payload; the interceptor wraps it as `{ data: { items, pageInfo } }` (D14). */
export type Page<T> = { items: T[]; pageInfo: PageInfoDto };

export function toPageInfo(page: number, pageSize: number, totalItems: number): PageInfoDto {
  return { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) };
}
