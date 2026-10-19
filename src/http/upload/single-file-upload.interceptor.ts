import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  mixin,
  type NestInterceptor,
  PayloadTooLargeException,
  type Type,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import multer from 'multer';
import type { Observable } from 'rxjs';
import { AppError } from '../../errors/app-error.js';
import { baselineErrors } from '../../errors/baseline-errors.js';

const unknownField = (field: string) => ({
  field,
  code: 'UNKNOWN_FIELD',
  message: 'This field is not allowed.',
});
const invalid = (fields: object[]) => new AppError(baselineErrors.VALIDATION_FAILED, { fields });

/**
 * The first non-JSON body (D21 note, blog completion spec §5.1): one `multipart/form-data` file part held in
 * memory as `req.file`. Runs after the guards, so only an authorized caller's upload is ever parsed. Multer's
 * errors become the contract: an oversized file → 413 PAYLOAD_TOO_LARGE; any other part → 400 UNKNOWN_FIELD at
 * its name; no file → 400 REQUIRED at `field`; a malformed body → 400 with no field.
 */
export function SingleFileUpload(field: string, maxBytes: number): Type<NestInterceptor> {
  const parse = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 10, fieldSize: 1024, parts: 11 },
  }).single(field);

  @Injectable()
  class SingleFileUploadInterceptor implements NestInterceptor {
    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
      const http = context.switchToHttp();
      const request = http.getRequest<Request>();
      await new Promise<void>((resolve, reject) => {
        parse(request, http.getResponse<Response>(), (error: unknown) =>
          error ? reject(translate(error)) : resolve(),
        );
      });
      const problems = Object.keys((request.body ?? {}) as object).map(unknownField);
      if (!request.file) {
        problems.unshift({ field, code: 'REQUIRED', message: 'This field is required.' });
      }
      if (problems.length > 0) throw invalid(problems);
      return next.handle();
    }
  }
  return mixin(SingleFileUploadInterceptor);
}

function translate(error: unknown): unknown {
  if (!(error instanceof multer.MulterError)) return invalid([]); // malformed multipart
  if (error.code === 'LIMIT_FILE_SIZE') return new PayloadTooLargeException();
  return invalid([unknownField(error.field ?? '')]);
}
