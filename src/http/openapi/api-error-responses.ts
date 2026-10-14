import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import type { ErrorDefinition } from '../../errors/app-error.js';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { frameworkCodes, statusForKind } from '../error-status.js';
import { ErrorEnvelopeDto, ValidationErrorDetailsDto } from './error-schemas.js';

/**
 * Documents every error code the endpoint can return, from the runtime definitions (I18). Always adds 500.
 * Listing VALIDATION_FAILED means the endpoint takes input: its 400 types `details.fields`, and 413
 * PAYLOAD_TOO_LARGE is added because the JSON body parser can reject the request first.
 */
export function ApiErrorResponses(...definitions: ErrorDefinition[]) {
  const codesByStatus = new Map<number, string[]>();
  const add = (status: number, code: string) =>
    codesByStatus.set(status, [...(codesByStatus.get(status) ?? []), code]);
  for (const d of definitions) add(statusForKind[d.kind], d.code);
  const takesInput = definitions.some((d) => d.code === baselineErrors.VALIDATION_FAILED.code);
  if (takesInput)
    add(frameworkCodes.PAYLOAD_TOO_LARGE.status, frameworkCodes.PAYLOAD_TOO_LARGE.code);
  add(frameworkCodes.INTERNAL_ERROR.status, frameworkCodes.INTERNAL_ERROR.code);

  return applyDecorators(
    ApiExtraModels(ErrorEnvelopeDto, ValidationErrorDetailsDto),
    ...[...codesByStatus].map(([status, codes]) => {
      const errorProperties: Record<string, { $ref: string } | { type: 'string'; enum: string[] }> =
        { code: { type: 'string', enum: codes } };
      if (codes.includes(baselineErrors.VALIDATION_FAILED.code)) {
        errorProperties.details = { $ref: getSchemaPath(ValidationErrorDetailsDto) };
      }
      return ApiResponse({
        status,
        description: codes.join(' | '),
        schema: {
          allOf: [
            { $ref: getSchemaPath(ErrorEnvelopeDto) },
            {
              type: 'object',
              properties: {
                error: {
                  type: 'object',
                  properties: errorProperties,
                },
              },
            },
          ],
        },
      });
    }),
  );
}
