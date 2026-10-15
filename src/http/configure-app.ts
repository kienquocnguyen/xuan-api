import express, { type NextFunction, type Request, type Response } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
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

// Long TipTap documents (spec B15): only the two post write routes accept 512 kB; every other route keeps 100 kB
// (D21). Mounted before the global parser, which skips a body this one already parsed.
const postWriteJson = express.json({ limit: '512kb' });
const isPostWrite = (req: Request) =>
  (req.method === 'POST' && req.path === '/admin/posts') ||
  (req.method === 'PUT' && /^\/admin\/posts\/[^/]+$/.test(req.path));

function parsePostWriteJson(req: Request, res: Response, next: NextFunction) {
  if (isPostWrite(req)) postWriteJson(req, res, next);
  else next();
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
  app.use(parsePostWriteJson); // B15, before the global parser
  app.useBodyParser('json', { limit: '100kb' }); // JSON only (D21)
  app.use(keepJsonParseMarker);
  app.use(cookieParser(config.auth.cookieSecret)); // signs/verifies the OAuth state cookie (auth design §4)
  if (config.docs.enabled) setupOpenApi(app); // D20
}
