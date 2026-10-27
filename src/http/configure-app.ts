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

/** A stored variant's public path; anything else under /media falls through to the API's 404. */
const MEDIA_VARIANT_PATH = /^\/blog\/[0-9a-f-]{36}-\d{1,4}\.webp$/;

/**
 * Local media (MEDIA_STORAGE=local, development and test; blog completion spec §5.3): stored WebP variants only,
 * no index or dotfiles, `nosniff`, loadable from the web's origin (helmet's CORP is same-origin), cached forever
 * (random keys never change). Production serves R2's own domain instead.
 */
function serveLocalMedia(app: NestExpressApplication, directory: string) {
  const files = express.static(directory, {
    index: false,
    dotfiles: 'deny',
    fallthrough: true,
    immutable: true,
    maxAge: '365d',
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  });
  app.use('/media', (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!MEDIA_VARIANT_PATH.test(req.path)) return next();
    return files(req, res, next);
  });
}

/** App-level HTTP setup shared by main.ts and the e2e factory (D6). */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  // Security headers and CORS first, so error responses (e.g. a body-parser failure) carry them too.
  app.use(helmet({ contentSecurityPolicy: config.docs.enabled ? false : undefined })); // Swagger UI needs inline scripts (§16)
  app.enableCors({
    origin: [...config.cors.origins], // exact origins, never '*' (I20)
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-Requested-With'],
    exposedHeaders: ['Retry-After'], // not CORS-safelisted: the web reads it on 429 (api-contract §4)
  });
  if (config.media.storage === 'local' && config.media.localDir) {
    serveLocalMedia(app, config.media.localDir);
  }
  app.use(parsePostWriteJson); // B15, before the global parser
  app.useBodyParser('json', { limit: '100kb' }); // JSON only (D21)
  app.use(keepJsonParseMarker);
  app.use(cookieParser(config.auth.cookieSecret)); // signs/verifies the OAuth state cookie (auth design §4)
  if (config.docs.enabled) setupOpenApi(app); // D20
}
