import type { NextFunction, Request, Response } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AppConfig } from '../config/load-config.js';

/**
 * Nest's Express adapter rethrows body-parser's SyntaxError as a bare BadRequestException, dropping
 * `type: 'entity.parse.failed'` (architecture.md §16). Re-raising it as a non-SyntaxError keeps the
 * marker, so toContractError() can answer "The request body is not valid JSON."
 */
export class InvalidJsonBodyError extends Error {
  readonly status = 400;
  readonly type = 'entity.parse.failed';
  constructor() {
    super('The request body is not valid JSON.');
    this.name = 'InvalidJsonBodyError';
  }
}

function keepJsonParseMarker(error: unknown, _req: Request, _res: Response, next: NextFunction) {
  const isParseFailure =
    error instanceof SyntaxError && (error as { type?: unknown }).type === 'entity.parse.failed';
  next(isParseFailure ? new InvalidJsonBodyError() : error);
}

export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.useBodyParser('json', { limit: '100kb' });
  app.use(keepJsonParseMarker);
  void config; // used from Task 11 on
}
