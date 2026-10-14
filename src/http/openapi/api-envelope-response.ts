import { applyDecorators, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';

/** Documents { data: Dto } (or { data: Dto[] }), matching the success interceptor (I11). */
export function ApiEnvelopeResponse(
  dto: Type<unknown>,
  options: { status?: number; isArray?: boolean } = {},
) {
  const data = options.isArray
    ? { type: 'array', items: { $ref: getSchemaPath(dto) } }
    : { $ref: getSchemaPath(dto) };
  return applyDecorators(
    ApiExtraModels(dto),
    ApiResponse({
      status: options.status ?? 200,
      schema: {
        type: 'object',
        required: ['data'],
        properties: { data, message: { type: 'string' }, code: { type: 'string' } },
      },
    }),
  );
}
