import { HttpException } from '@nestjs/common';
import { AppError } from '../errors/app-error.js';
import { baselineErrors } from '../errors/baseline-errors.js';
import { frameworkCodes, statusForKind } from './error-status.js';

export type ContractErrorBody = {
  data: null;
  error: { code: string; message: string; details: Readonly<Record<string, unknown>> };
};

export type ContractError = { status: number; body: ContractErrorBody; unexpected: boolean };

const body = (
  code: string,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): ContractErrorBody => ({
  data: null,
  error: { code, message, details },
});

/** Turns anything thrown into the contract's error envelope (I13). Never copies a raw message (I16). */
export function toContractError(exception: unknown): ContractError {
  if (exception instanceof AppError) {
    return {
      status: statusForKind[exception.kind],
      unexpected: false,
      body: body(exception.code, exception.message, exception.details),
    };
  }

  const status = frameworkStatus(exception);
  if (status === 404) {
    return {
      status,
      unexpected: false,
      body: body(baselineErrors.NOT_FOUND.code, baselineErrors.NOT_FOUND.message),
    };
  }
  if (status === 400) {
    const invalidJson = (exception as { type?: unknown }).type === 'entity.parse.failed';
    const message = invalidJson
      ? 'The request body is not valid JSON.'
      : baselineErrors.VALIDATION_FAILED.message;
    return {
      status,
      unexpected: false,
      body: body(baselineErrors.VALIDATION_FAILED.code, message, { fields: [] }),
    };
  }
  if (status === 413) {
    const c = frameworkCodes.PAYLOAD_TOO_LARGE;
    return { status: c.status, unexpected: false, body: body(c.code, c.message) };
  }

  // Unknown errors and unanticipated framework statuses are bugs: generic 500, logged by the filter.
  const c = frameworkCodes.INTERNAL_ERROR;
  return { status: c.status, unexpected: true, body: body(c.code, c.message) };
}

// Nest HttpExceptions and Express body-parser errors both carry an HTTP status.
function frameworkStatus(exception: unknown): number | undefined {
  if (exception instanceof HttpException) return exception.getStatus();
  if (typeof exception === 'object' && exception !== null) {
    const status =
      (exception as { status?: unknown; statusCode?: unknown }).status ??
      (exception as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number') return status;
  }
  return undefined;
}
