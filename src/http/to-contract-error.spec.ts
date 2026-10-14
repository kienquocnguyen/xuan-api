import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AppError } from '../errors/app-error.js';
import { baselineErrors } from '../errors/baseline-errors.js';
import { toContractError } from './to-contract-error.js';

const envelope = (code: string, message: string, details: object = {}) => ({
  data: null,
  error: { code, message, details },
});

describe('toContractError', () => {
  it('maps an AppError by kind, keeping code, message and details', () => {
    const result = toContractError(new AppError(baselineErrors.VALIDATION_FAILED, { fields: [] }));
    expect(result).toEqual({
      status: 400,
      unexpected: false,
      body: envelope('VALIDATION_FAILED', 'The request is invalid.', { fields: [] }),
    });
  });

  it('maps a not_found AppError to 404', () => {
    expect(toContractError(new AppError(baselineErrors.NOT_FOUND)).status).toBe(404);
  });

  it('maps a framework 404 (unknown route) to NOT_FOUND with our message', () => {
    expect(toContractError(new NotFoundException('Cannot GET /nope'))).toEqual({
      status: 404,
      unexpected: false,
      body: envelope('NOT_FOUND', 'The requested resource was not found.'),
    });
  });

  it('maps a body-parser JSON syntax error to VALIDATION_FAILED with no fields', () => {
    const parseError = Object.assign(new SyntaxError('Unexpected token'), {
      status: 400,
      type: 'entity.parse.failed',
    });
    expect(toContractError(parseError)).toEqual({
      status: 400,
      unexpected: false,
      body: envelope('VALIDATION_FAILED', 'The request body is not valid JSON.', { fields: [] }),
    });
  });

  it('maps a framework 400 to VALIDATION_FAILED with no fields', () => {
    expect(toContractError(new BadRequestException('anything')).body.error.code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('maps an over-limit body to PAYLOAD_TOO_LARGE', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      type: 'entity.too.large',
    });
    expect(toContractError(tooLarge)).toEqual({
      status: 413,
      unexpected: false,
      body: envelope('PAYLOAD_TOO_LARGE', 'The request body is too large.'),
    });
  });

  it('treats a non-framework object carrying a 4xx status as unexpected (500), not a client error', () => {
    const libraryError = Object.assign(new Error('upstream said 404'), { status: 404 });
    expect(toContractError(libraryError)).toEqual({
      status: 500,
      unexpected: true,
      body: envelope('INTERNAL_ERROR', 'Something went wrong. Please try again.'),
    });
  });

  it.each([
    new Error('relation "x" does not exist'),
    'a string',
    null,
    Object.assign(new Error('teapot'), { status: 418 }),
  ])('maps anything else to a generic 500 without leaking (%s)', (thrown) => {
    expect(toContractError(thrown)).toEqual({
      status: 500,
      unexpected: true,
      body: envelope('INTERNAL_ERROR', 'Something went wrong. Please try again.'),
    });
  });
});
