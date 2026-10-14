import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import type { ErrorDefinition } from '../../errors/app-error.js';
import { frameworkCodes, statusForKind } from '../error-status.js';
import { ErrorEnvelopeDto, ValidationErrorDetailsDto } from './error-schemas.js';

/** Documents every error code the endpoint can return, from the runtime definitions (I18). Always adds 500. */
export function ApiErrorResponses(...definitions: ErrorDefinition[]) {
  const codesByStatus = new Map<number, string[]>();
  const add = (status: number, code: string) =>
    codesByStatus.set(status, [...(codesByStatus.get(status) ?? []), code]);
  for (const d of definitions) add(statusForKind[d.kind], d.code);
  add(frameworkCodes.INTERNAL_ERROR.status, frameworkCodes.INTERNAL_ERROR.code);

  return applyDecorators(
    ApiExtraModels(ErrorEnvelopeDto, ValidationErrorDetailsDto),
    ...[...codesByStatus].map(([status, codes]) =>
      ApiResponse({
        status,
        description: codes.join(' | '),
        schema: {
          allOf: [
            { $ref: getSchemaPath(ErrorEnvelopeDto) },
            {
              type: 'object',
              properties: {
                error: { type: 'object', properties: { code: { type: 'string', enum: codes } } },
              },
            },
          ],
        },
      }),
    ),
  );
}
