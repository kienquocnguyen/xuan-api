import { applyDecorators, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { PageInfoDto } from '../pagination/page.js';

/** Documents `{ data: { items: Dto[], pageInfo } }` (D14), matching the success interceptor (I11). */
export function ApiPaginatedEnvelopeResponse(dto: Type<unknown>) {
  return applyDecorators(
    ApiExtraModels(dto, PageInfoDto),
    ApiResponse({
      status: 200,
      schema: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'object',
            required: ['items', 'pageInfo'],
            properties: {
              items: { type: 'array', items: { $ref: getSchemaPath(dto) } },
              pageInfo: { $ref: getSchemaPath(PageInfoDto) },
            },
          },
          message: { type: 'string' },
          code: { type: 'string' },
        },
      },
    }),
  );
}
