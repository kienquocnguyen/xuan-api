import type { NextFunction, Request, Response } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { AppConfig } from '../config/load-config.js';
import { setupOpenApi } from './openapi/setup-open-api.js';

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

/** App-level HTTP setup shared by main.ts and the e2e factory (D6). */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  // Security headers and CORS first, so error responses (e.g. a body-parser failure) carry them too.
  app.use(helmet({ contentSecurityPolicy: config.docs.enabled ? false : undefined })); // Swagger UI needs inline scripts (§16)
  app.enableCors({
    origin: [...config.cors.origins], // exact origins, never '*' (I20)
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-Requested-With'],
  });
  app.useBodyParser('json', { limit: '100kb' }); // JSON only (D21)
  app.use(keepJsonParseMarker);
  if (config.docs.enabled) setupOpenApi(app); // D20
}
