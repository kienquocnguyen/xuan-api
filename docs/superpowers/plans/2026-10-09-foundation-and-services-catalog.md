# Foundation + Services Catalog Implementation Plan

> **For agentic workers:** this plan runs in **learning-first mode** (`docs/development-workflow.md` §3). Tasks tagged `[learn]` are typed and run by the owner; Claude explains, gives shapes, reviews (`xuan-api-architecture-review`) and waits. Claude implements a task only if the owner re-tags it `[delegate]`. Every code task follows **REQUIRED SUB-SKILL:** `xuan-api-feature`. Schema work follows **REQUIRED SUB-SKILL:** `xuan-database-change`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** a running NestJS 12 API whose platform (config, database, contract envelopes, errors, validation, CORS, OpenAPI, e2e harness) is proven by tests, serving the first real slice: the public Services catalog (`GET /services`, `GET /services/:slug`) from PostgreSQL.

**Architecture:**
- **Business modules:** `src/modules/*`.
- **Platform folders:** `config/`, `errors/`, `database/`, `http/`, following the allow-list in `architecture.md` §4.
- **Global contract behavior:** `HttpContractModule` (`APP_PIPE` / `APP_FILTER` / `APP_INTERCEPTOR`) + `configureApp()`, shared by `main.ts` and the e2e app factory.
- **Persistence:** TypeORM `Repository<Entity>` in services; reviewed migrations only.

**Tech Stack:** Node 24 · Yarn 4 · NestJS 12 (ESM) · TypeScript 6.x · Zod 4 · TypeORM 1.x + `pg` · PostgreSQL 18 (Docker Compose, port 5433) · Vitest 4 + supertest · `@nestjs/swagger` · helmet.

**Spec:** `docs/superpowers/specs/2026-10-09-xuan-api-foundation-architecture-design.md` (frozen). Living truth: `CLAUDE.md`, `docs/architecture.md`, `docs/database.md`, `docs/api-contract.md`, `docs/code-rules.md`, `docs/development-workflow.md`, `docs/data-model.md`. Where the spec and the living docs differ (e.g. Services replaced Subscribers, AD12), the **docs win**.

## Global Constraints

| Area | Constraint |
|---|---|
| Runtime | Node 24 LTS; Yarn 4 via Corepack, `nodeLinker: node-modules`; NestJS 12; **TypeScript 6.x pinned** (not 7) |
| Module format | ESM, as the Nest 12 starter generates: relative imports end in **`.js`** (`'./load-config.js'`) |
| Database | PostgreSQL 18 in Docker Compose, host port **5433**; databases `xuan_dev`, `xuan_test`; role `xuan_app` |
| Environment | `process.env` is read only in `src/config/` (I4); config is validated before listen (I5) |
| Schema changes | Migrations by explicit command only; never `synchronize`, never `migrationsRun` (I7) |
| Wire | Every success is `{ data }` (I11); 204 has an empty body (I12); every error is the error envelope with a stable code (I13). Baseline codes: `VALIDATION_FAILED` 400, `NOT_FOUND` 404, `PAYLOAD_TOO_LARGE` 413, `INTERNAL_ERROR` 500 |
| Responses | Explicit DTOs; entities never reach the wire (I10) |
| Errors | Business code throws `AppError`, never `HttpException` (I14) |
| CORS | Exact origins from config, `credentials: true`, headers `Content-Type` + `X-Requested-With`; never a wildcard (I20) |
| Body | JSON only, limit `100kb` |
| Tests | Vitest; e2e on `xuan_test`, serial, exact-body `toEqual`; cleanup guarded by I21 |
| Names | Business word "services" (route, module, table, `ServiceDto`); classes `ServiceOffering` (entity) and `ServicesCatalogService` (provider) |
| Excluded | No price, no auth, no admin CRUD, no pagination for `/services` |
| Commits | Only after Task 0 sets the Git baseline. Then one branch per phase (§ "Branches"), PR (or reviewed local merge) into `dev` |

## Review Focus

These conditions are likely to bite in real use, and no happy-path test covers them. Each line names the task that adds its test.

1. **Drafts leaking.** An unpublished service must be invisible in **both** the list and the slug lookup (404). Tests: Task 15, Task 16.
2. **`durationMinutes: null` serialization.** A program without a fixed session length must serialize as `null`, not be omitted. Test: Task 15 (exact body).
3. **Odd slugs** (`/services/Kickstart`, `/services/%20`, a 300-character slug) → `404 NOT_FOUND` envelope, never 500. Test: Task 16.
4. **A disallowed browser origin** gets no `Access-Control-Allow-Origin`; an allowed one gets it plus `Access-Control-Allow-Credentials: true`. Test: Task 11.
5. **A non-JSON body** (`text/plain`, form-encoded) reaching a validated endpoint → `400 VALIDATION_FAILED`, never processed as data. Test: Task 11.

## Learning task template

Every task opens with this block. The **Steps** are the "What I should do/type".

```
[learn] | [delegate]
Goal · Why this exists · Concept being learned · What I should do/type (= Steps) ·
How to verify · Expected result · Common failure to watch for
```

## Branches (after Task 0)

| Phase | Tasks | Branch (from up-to-date `dev`) |
|---|---|---|
| A. Project + tooling | 1–2 | `chore/setup-nest-project` |
| B. Config + database | 3–5 | `feat/setup-config-and-database` |
| C. HTTP contract platform | 6–12 | `feat/build-http-contract-platform` |
| D. Services catalog | 13–18 | `feat/build-services-catalog` |

Each phase ends with `xuan-api-architecture-review` → the PR to `dev` (or a reviewed `git merge --no-ff` if no remote exists).

## File map

```
.nvmrc · .yarnrc.yml · package.json · tsconfig.json · tsconfig.build.json · nest-cli.json
vitest.config.ts · vitest.config.e2e.ts · .oxlintrc.json (or eslint.config.mjs) · .prettierrc.json
.gitignore · .env.example · compose.yaml · docker/postgres/init/01-create-databases.sql
src/
  main.ts                                  bootstrap
  app.module.ts                            composition
  config/env.schema.ts                     Zod env schema
  config/load-config.ts                    loadConfig(), AppConfig, ConfigError
  config/load-config.spec.ts
  config/app-config.module.ts              APP_CONFIG provider
  errors/app-error.ts                      AppError, ErrorKind, ErrorDefinition
  errors/baseline-errors.ts                baselineErrors
  database/database.module.ts              TypeORM root
  database/data-source.ts                  CLI DataSource
  database/migrations/<ts>-CreateServices.ts
  http/http-contract.module.ts             APP_PIPE / APP_FILTER / APP_INTERCEPTOR
  http/error-status.ts                     kind → status
  http/to-contract-error.ts                any error → { status, body }   (+ .spec.ts)
  http/contract-exception.filter.ts
  http/to-field-errors.ts                  Standard Schema issues → details.fields  (+ .spec.ts)
  http/success-envelope.interceptor.ts
  http/configure-app.ts                    JSON parser, helmet, CORS, Swagger
  http/openapi/error-schemas.ts            ErrorEnvelopeDto, ValidationErrorDetailsDto, FieldErrorDto
  http/openapi/api-envelope-response.ts    @ApiEnvelopeResponse
  http/openapi/api-error-responses.ts      @ApiErrorResponses
  http/openapi/setup-open-api.ts           createOpenApiDocument(), setupOpenApi()
  modules/services/services.module.ts
  modules/services/service-offering.entity.ts
  modules/services/services.service.ts     ServicesCatalogService
  modules/services/services.controller.ts
  modules/services/dto/service.dto.ts      ServiceDto + toServiceDto
  modules/services/services.seed.ts        idempotent catalog seed
test/
  support/create-test-app.ts · support/reset-database.ts
  fixtures/fixture.module.ts               test-only platform routes
  http-contract.e2e-spec.ts · cors-and-body.e2e-spec.ts · openapi.e2e-spec.ts
  services-schema.e2e-spec.ts · services.e2e-spec.ts
```

---

### Task 0: Git baseline

**`[learn]`**

| | |
|---|---|
| **Goal** | Give the repo its first commit and the `main` / `dev` branches |
| **Why this exists** | Every later task needs a branch from `dev`. The docs and skills are the baseline everything else is reviewed against (`development-workflow.md` §9) |
| **Concept** | The release branch (`main`) vs the integration branch (`dev`); why nobody commits to either directly |
| **Verify** | `git log --oneline --all` shows one commit on `main` and on `dev` |
| **Expected** | `git branch` → `dev` and `main`. `docs/backend-mental-model.md` is not in the commit |
| **Common failure** | Committing `docs/backend-mental-model.md` (it's excluded via `.git/info/exclude`: check `git status` first) |

**Owner decision (proposed default):** the baseline commit contains `CLAUDE.md`, `docs/` and `.claude/skills/`. Change it if you want a different baseline.

- [ ] **Step 1:** `git status`. Confirm only `CLAUDE.md`, `docs/` and `.claude/` are listed, and `backend-mental-model.md` isn't.
- [ ] **Step 2:** `git add CLAUDE.md docs .claude` then `git commit -m "docs: establish xuan-api engineering system"`
- [ ] **Step 3:** `git branch dev` then `git switch dev`. If a GitHub remote exists, push both and make `dev` the default branch.
- [ ] **Step 4:** `git switch -c chore/setup-nest-project`

---

### Task 1: Nest 12 project skeleton

**`[learn]`**

| | |
|---|---|
| **Goal** | The official Nest 12 starter, running on Node 24 + Yarn 4, inside this repo |
| **Why this exists** | Starting from the framework's own defaults (ESM, Vitest, TS ^6) means no build or test configuration is invented by us |
| **Concept** | What the starter generates: `main.ts` bootstrap, root module, `nest-cli.json`, Vitest configs, ESM `.js` import suffixes |
| **Verify** | `yarn build`, `yarn test`, `yarn start:dev` → `http://localhost:4000` responds |
| **Expected** | Build and tests green. The sample `AppController` is removed at the end, so `GET /` returns 404 |
| **Common failure** | Running `nest new` *inside* the non-empty repo (it refuses or overwrites). Generate into a sibling folder and copy |

- [ ] **Step 1:** Node 24.
  - Run `nvm install 24`, then `nvm use 24`, then `node -v` (expect `v24.x`).
  - Create `.nvmrc` containing `24`.
- [ ] **Step 2:** Yarn 4. Run `corepack enable`, then `corepack prepare yarn@stable --activate`, then `yarn -v` (expect `4.x`).
- [ ] **Step 3:** Generate the starter beside the repo: from `c:\xampp\htdocs\v2-xuan-creative`, run `npx @nestjs/cli@12 new xuan-api-starter --package-manager yarn --skip-git`.
- [ ] **Step 4:** Copy into `xuan-api`:
  - `package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`
  - `vitest.config.ts`, `vitest.config.e2e.ts`, `.oxlintrc.json`, `.prettierrc` (if present)
  - `src/`, `test/`

  Don't copy `node_modules` or `README.md`. Delete `xuan-api-starter` afterwards.
- [ ] **Step 5:** In `package.json`:
  - set `"name": "xuan-api"`;
  - add `"engines": { "node": ">=24 <25" }`;
  - run `yarn set version stable`, which writes `packageManager` and `.yarnrc.yml`;
  - add `nodeLinker: node-modules` to `.yarnrc.yml`;
  - run `yarn install`.
- [ ] **Step 6:** `.gitignore`:

```gitignore
node_modules/
dist/
coverage/
.env
.env.test
.yarn/*
!.yarn/releases
```

- [ ] **Step 7:** Remove the sample: delete `src/app.controller.ts`, `src/app.service.ts`, `src/app.controller.spec.ts` and the sample e2e in `test/`. Make `src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';

@Module({ imports: [] })
export class AppModule {}
```

- [ ] **Step 8:** In `src/main.ts`, change the port to `4000` temporarily; Task 11 replaces this file. Then run `yarn build`, then `yarn start:dev`, and open `http://localhost:4000` (expect a Nest 404 JSON). Stop the server.

---

### Task 2: TypeScript pin, format and lint boundaries

**`[learn]`**

| | |
|---|---|
| **Goal** | TS 6.x pinned; `yarn lint`, `typecheck` and `format:check` exist; lint **fails** on I4 and I2 violations |
| **Why this exists** | I2 and I4 are INVARIANTs. A machine check catches them before review does |
| **Concept** | Rules as code: a lint rule scoped by folder (overrides by file glob) |
| **Verify** | A deliberate `process.env` read in `src/http/x.ts`, and `import … from '../modules/…'` inside `src/http/`, both fail `yarn lint` |
| **Expected** | Lint is red on both violations and green once they're removed |
| **Common failure** | A rule that silently does nothing because the tool doesn't support it. That's why Step 4 proves it with a deliberate violation (verification spike) |

- [ ] **Step 1:** `yarn add -D typescript@~6` (exact minor pinned by the lockfile). In `tsconfig.json`, keep the starter's options; confirm `"strict": true`, `"experimentalDecorators": true` and `"emitDecoratorMetadata": true`.
- [ ] **Step 2:** Scripts in `package.json`: `"typecheck": "tsc --noEmit"` and `"format:check": "prettier --check \"src/**/*.ts\" \"test/**/*.ts\""`. Copy xuan-web's `.prettierrc.json` settings.
- [ ] **Step 3:** Try oxlint first. Replace `.oxlintrc.json` with:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "env": { "node": true },
  "rules": {
    "no-restricted-properties": ["error", { "object": "process", "property": "env", "message": "Only src/config/ reads process.env (I4)." }]
  },
  "overrides": [
    { "files": ["src/config/**"], "rules": { "no-restricted-properties": "off" } },
    { "files": ["src/config/**", "src/errors/**"], "rules": { "no-restricted-imports": ["error", { "patterns": [{ "group": ["**/errors/**", "**/database/**", "**/http/**", "**/modules/**", "**/config/**"], "message": "config/ and errors/ import no application layer (I2)." }] }] } },
    { "files": ["src/database/**"], "rules": { "no-restricted-imports": ["error", { "patterns": [{ "group": ["**/errors/**", "**/http/**", "**/modules/**"], "message": "database/ imports only config/ (I2)." }] }] } },
    { "files": ["src/http/**"], "rules": { "no-restricted-imports": ["error", { "patterns": [{ "group": ["**/database/**", "**/modules/**"], "message": "http/ imports only config/ and errors/ (I2)." }] }] } }
  ]
}
```

  `src/config/**` importing its own files uses `./`, which the pattern doesn't match. Confirm that in Step 4.
- [ ] **Step 4 (spike):** create `src/http/lint-probe.ts`:

```ts
import '../modules/nothing.js';
export const probe = process.env.PORT;
```

  Run `yarn lint`. **Expected:** two errors (I2 and I4). Delete the probe.
- [ ] **Step 5 (only if Step 4 shows a missing error):**
  - Remove oxlint: `yarn remove oxlint`, delete `.oxlintrc.json`.
  - Run `yarn add -D eslint typescript-eslint`.
  - Create `eslint.config.mjs`:

```js
import tseslint from 'typescript-eslint';

const restrict = (patterns, message) => ['error', { patterns: [{ group: patterns, message }] }];

export default tseslint.config(
  { ignores: ['dist/**'] },
  ...tseslint.configs.recommended,
  { files: ['src/**/*.ts'], ignores: ['src/config/**'], rules: { 'no-restricted-properties': ['error', { object: 'process', property: 'env', message: 'Only src/config/ reads process.env (I4).' }] } },
  { files: ['src/config/**/*.ts', 'src/errors/**/*.ts'], rules: { 'no-restricted-imports': restrict(['**/errors/**', '**/database/**', '**/http/**', '**/modules/**', '**/config/**'], 'config/ and errors/ import no application layer (I2).') } },
  { files: ['src/database/**/*.ts'], rules: { 'no-restricted-imports': restrict(['**/errors/**', '**/http/**', '**/modules/**'], 'database/ imports only config/ (I2).') } },
  { files: ['src/http/**/*.ts'], rules: { 'no-restricted-imports': restrict(['**/database/**', '**/modules/**'], 'http/ imports only config/ and errors/ (I2).') } },
);
```

  Set `"lint": "eslint ."`, then repeat Step 4. Record the result in `architecture.md` §16 (lint row).
- [ ] **Step 6:** `yarn lint`, `yarn typecheck`, `yarn format:check`, `yarn test` all green → commit `chore(tooling): configure typescript, formatting and boundary lint`. Run `xuan-api-architecture-review`, then the PR for phase A.

---

### Task 3: Validated configuration (`loadConfig`)

**`[learn]`** · branch `feat/setup-config-and-database`

| | |
|---|---|
| **Goal** | One `loadConfig()` that reads env, validates with Zod, normalizes and freezes. Provided to Nest as `APP_CONFIG` |
| **Why this exists** | Fail fast on bad config (I5), with one path shared by the app, the migration CLI and tests (D18). Architecture §11 |
| **Concept** | Nest custom providers (`useFactory`, a `Symbol` token, `@Inject(TOKEN)`); parse, don't validate |
| **Verify** | `yarn test src/config` |
| **Expected** | All `load-config.spec.ts` cases pass; the error message names variables, never values |
| **Common failure** | Printing `result.error` (Zod issues can include the received input, i.e. the secret). Build the message from issue **paths** only |

**Interfaces, produces:**
- `loadConfig(source?: NodeJS.ProcessEnv): AppConfig`
- `type AppConfig`
- `class ConfigError`
- `APP_CONFIG: symbol`
- `AppConfigModule` (exports `APP_CONFIG`)

- [ ] **Step 1:** `yarn add zod@^4`
- [ ] **Step 2: failing tests.** `src/config/load-config.spec.ts`:

```ts
import { ConfigError, loadConfig } from './load-config.js';

const valid = {
  NODE_ENV: 'development',
  PORT: '4000',
  DATABASE_URL: 'postgres://xuan_app:s3cret@localhost:5433/xuan_dev',
  CORS_ORIGINS: 'http://localhost:3000, https://xuancreative.com',
  DOCS_ENABLED: 'true',
};

describe('loadConfig', () => {
  it('normalizes a valid environment', () => {
    expect(loadConfig(valid)).toEqual({
      env: 'development',
      port: 4000,
      database: { url: valid.DATABASE_URL },
      cors: { origins: ['http://localhost:3000', 'https://xuancreative.com'] },
      docs: { enabled: true },
    });
  });

  it('returns a frozen object', () => {
    const config = loadConfig(valid);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.cors.origins)).toBe(true);
  });

  it('defaults PORT to 4000 and DOCS_ENABLED to false', () => {
    const { PORT, DOCS_ENABLED, ...rest } = valid;
    const config = loadConfig(rest);
    expect(config.port).toBe(4000);
    expect(config.docs.enabled).toBe(false);
  });

  it.each([
    ['DATABASE_URL', { ...valid, DATABASE_URL: undefined }],
    ['NODE_ENV', { ...valid, NODE_ENV: 'staging' }],
    ['CORS_ORIGINS', { ...valid, CORS_ORIGINS: '*' }],
    ['DOCS_ENABLED', { ...valid, DOCS_ENABLED: 'maybe' }],
  ])('rejects an invalid %s and names it', (name, env) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(name);
  });

  it('never prints a value in the error', () => {
    const env = { ...valid, PORT: 'not-a-port-s3cret' };
    expect(() => loadConfig(env)).toThrow(/^Invalid configuration: PORT$/);
  });
});
```

- [ ] **Step 3:** `yarn test src/config` → FAIL (module not found).
- [ ] **Step 4:** `src/config/env.schema.ts`:

```ts
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.url(),
  CORS_ORIGINS: z
    .string()
    .transform((raw) => raw.split(',').map((origin) => origin.trim()).filter(Boolean))
    .refine((origins) => origins.length > 0 && !origins.includes('*'), 'Exact origins only (I20).'),
  DOCS_ENABLED: z.stringbool().default(false),
});
```

- [ ] **Step 5:** `src/config/load-config.ts`:

```ts
import { existsSync } from 'node:fs';
import { envSchema } from './env.schema.js';

export type AppConfig = Readonly<{
  env: 'development' | 'test' | 'production';
  port: number;
  database: Readonly<{ url: string }>;
  cors: Readonly<{ origins: readonly string[] }>;
  docs: Readonly<{ enabled: boolean }>;
}>;

export class ConfigError extends Error {}

/** Reads, validates, normalizes and freezes configuration. Throws ConfigError naming variables only (I5). */
export function loadConfig(source: NodeJS.ProcessEnv = readEnvironment()): AppConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
    throw new ConfigError(`Invalid configuration: ${names.join(', ')}`);
  }
  const env = result.data;
  return Object.freeze({
    env: env.NODE_ENV,
    port: env.PORT,
    database: Object.freeze({ url: env.DATABASE_URL }),
    cors: Object.freeze({ origins: Object.freeze([...env.CORS_ORIGINS]) }),
    docs: Object.freeze({ enabled: env.DOCS_ENABLED }),
  });
}

// The only place that touches process.env (I4). Local files are optional; production uses real env vars.
function readEnvironment(): NodeJS.ProcessEnv {
  const file = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
  if (existsSync(file)) process.loadEnvFile(file);
  return process.env;
}
```

- [ ] **Step 6:** `yarn test src/config` → PASS.
- [ ] **Step 7 (spike):** does `process.loadEnvFile` override a variable that's already set? Add this test:

```ts
it('documents loadEnvFile precedence', async () => {
  const { writeFileSync, rmSync } = await import('node:fs');
  writeFileSync('.env.precedence-probe', 'PROBE_VAR=from-file\n');
  process.env.PROBE_VAR = 'from-process';
  process.loadEnvFile('.env.precedence-probe');
  rmSync('.env.precedence-probe');
  expect(process.env.PROBE_VAR).toBe('from-process'); // if this fails, the file overrides real env: record it in architecture.md §16
});
```

  This test lives in `src/config/` (I4 allows it there). Run it, record the result in `architecture.md` §16, keep the test.
- [ ] **Step 8:** `src/config/app-config.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { loadConfig } from './load-config.js';

export const APP_CONFIG = Symbol('APP_CONFIG');

@Module({
  providers: [{ provide: APP_CONFIG, useFactory: loadConfig }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
```

  `useFactory: loadConfig` passes no argument, so the default `readEnvironment()` runs. Modules that need config import `AppConfigModule` explicitly; it's deliberately not `@Global()`.
- [ ] **Step 9:** `.env.example` (committed, fake values):

```dotenv
NODE_ENV=development
PORT=4000
DATABASE_URL=postgres://xuan_app:xuan_app_local@localhost:5433/xuan_dev
CORS_ORIGINS=http://localhost:3000
DOCS_ENABLED=true
# .env.test uses NODE_ENV=test and DATABASE_URL=.../xuan_test
```

  Create `.env` from it. Create `.env.test` with `NODE_ENV=test` and `DATABASE_URL=postgres://xuan_app:xuan_app_local@localhost:5433/xuan_test`.
- [ ] **Step 10:** commit `feat(config): add validated configuration loading`.

---

### Task 4: Local PostgreSQL 18

**`[learn]`**

| | |
|---|---|
| **Goal** | `postgres:18` on `localhost:5433` with `xuan_dev` and `xuan_test`, owned by `xuan_app` |
| **Why this exists** | A real, version-matched server for development and e2e (`database.md` §11). The native PG 12 on 5432 stays untouched |
| **Concept** | Roles vs databases; the Docker init scripts that run on the first start only; a volume = persistent data |
| **Verify** | `docker compose exec db psql -U xuan_app xuan_dev -c "SELECT version(), current_user, current_database();"` |
| **Expected** | `PostgreSQL 18.x`, `xuan_app`, `xuan_dev` |
| **Common failure** | Editing the init script after the first start: it won't re-run until the volume is removed (`yarn db:down` + `docker compose down -v`) |

- [ ] **Step 1:** `compose.yaml`:

```yaml
services:
  db:
    image: postgres:18
    ports:
      - "5433:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres_local_only
    volumes:
      - pgdata:/var/lib/postgresql
      - ./docker/postgres/init:/docker-entrypoint-initdb.d:ro
volumes:
  pgdata: {}
```

- [ ] **Step 2:** `docker/postgres/init/01-create-databases.sql` (local-only credentials; never production):

```sql
CREATE ROLE xuan_app LOGIN PASSWORD 'xuan_app_local';
CREATE DATABASE xuan_dev OWNER xuan_app;
CREATE DATABASE xuan_test OWNER xuan_app;
```

- [ ] **Step 3:** Scripts `"db:up": "docker compose up -d db"` and `"db:down": "docker compose stop db"`. Run `yarn db:up`.
- [ ] **Step 4:** Run the Verify command, then practise:
  - `docker compose exec db psql -U postgres -c "\l"` (databases and owners)
  - `docker compose exec db psql -U postgres -c "\du"` (roles)
- [ ] **Step 5 (optional):** pgAdmin → register server `localhost:5433`, user `xuan_app`, and browse `xuan_dev`.
- [ ] **Step 6:** commit `chore(database): add local postgres 18 compose setup`.

---

### Task 5: TypeORM root + migration CLI

**`[learn]`**

| | |
|---|---|
| **Goal** | The app connects through `DatabaseModule`; `yarn migration:show` works through the same `loadConfig()` |
| **Why this exists** | One connection owner (`database/`), and migrations by explicit command only (I7, D18) |
| **Concept** | `forRootAsync` + `inject` (DI for third-party modules); `autoLoadEntities` (entities come from each module's `forFeature`); why the CLI needs its own `DataSource` file |
| **Verify** | `yarn start:dev` logs no DB error; `yarn migration:show` prints an empty list |
| **Expected** | Both work against `xuan_dev`. `NODE_ENV=test yarn migration:show` targets `xuan_test` |
| **Common failure** | The CLI can't load ESM TypeScript. That's why it runs on compiled `dist/` (verification spike) |

**Interfaces, produces:** `DatabaseModule`; default export `DataSource` in `src/database/data-source.ts`; scripts `typeorm`, `migration:generate|create|run|revert|show`.

- [ ] **Step 1:** `yarn add typeorm @nestjs/typeorm pg`
- [ ] **Step 2:** `src/database/database.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG, AppConfigModule } from '../config/app-config.module.js';
import type { AppConfig } from '../config/load-config.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        type: 'postgres',
        url: config.database.url,
        autoLoadEntities: true, // entities arrive through each owning module's forFeature (I1)
        synchronize: false, // never (I7)
        migrationsRun: false, // migrations are explicit commands (I7)
      }),
    }),
  ],
})
export class DatabaseModule {}
```

- [ ] **Step 3:** `src/database/data-source.ts`:

```ts
import { DataSource } from 'typeorm';
import { loadConfig } from '../config/load-config.js';

const config = loadConfig();

// Used only by the TypeORM CLI and the seed script. Globs point at compiled output (documented I2 exception: strings, not imports).
export default new DataSource({
  type: 'postgres',
  url: config.database.url,
  entities: ['dist/modules/**/*.entity.js'],
  migrations: ['dist/database/migrations/*.js'],
  migrationsTableName: 'migrations',
  synchronize: false,
});
```

- [ ] **Step 4:** scripts (Yarn's shell supports `NODE_ENV=test cmd` on Windows):

```json
"typeorm": "typeorm -d dist/database/data-source.js",
"migration:generate": "yarn build && yarn typeorm migration:generate",
"migration:create": "typeorm migration:create",
"migration:run": "yarn build && yarn typeorm migration:run",
"migration:revert": "yarn build && yarn typeorm migration:revert",
"migration:show": "yarn build && yarn typeorm migration:show"
```

- [ ] **Step 5:** `app.module.ts` imports `[AppConfigModule, DatabaseModule]`. Run `yarn start:dev` and check there's no connection error.
- [ ] **Step 6 (spike):** run `yarn migration:show`.
  - **Expected:** it connects and lists nothing.
  - If the CLI fails to import the ESM file, read the error, check TypeORM 1.x's ESM CLI docs, and fix the script (not the architecture). Record the working command in `architecture.md` §16.
  - Then run `NODE_ENV=test yarn migration:show`, which must hit `xuan_test`.
- [ ] **Step 7:** commit `feat(database): connect typeorm and add migration cli` → review → PR phase B.

---

### Task 6: Application errors and contract error mapping

**`[learn]`** · branch `feat/build-http-contract-platform`

| | |
|---|---|
| **Goal** | `AppError` + baseline definitions in `errors/`; a pure `toContractError()` in `http/` that turns *any* thrown value into `{ status, body }` |
| **Why this exists** | Three layers, one translation each (`architecture.md` §9). A pure function is unit-testable without HTTP |
| **Concept** | `kind` (semantics) vs status (HTTP); why framework and body-parser errors need our own messages (I13, I16) |
| **Verify** | `yarn test src/http/to-contract-error` |
| **Expected** | Table-driven cases pass |
| **Common failure** | Copying `exception.message` into the body for unknown errors. That leaks internals (I16) |

**Interfaces, produces:**
- `class AppError(definition: ErrorDefinition, details?: Record<string, unknown>)` with `code`, `kind`, `details`
- `type ErrorKind`, `type ErrorDefinition = { code; kind; message }`
- `baselineErrors.{VALIDATION_FAILED, NOT_FOUND}`
- `statusForKind: Record<ErrorKind, number>`
- `toContractError(exception: unknown): { status: number; body: ContractErrorBody; unexpected: boolean }`
- `frameworkCodes.{PAYLOAD_TOO_LARGE, INTERNAL_ERROR}`

- [ ] **Step 1:** `src/errors/app-error.ts`:

```ts
export type ErrorKind = 'validation' | 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict' | 'rate_limited';

export type ErrorDefinition = Readonly<{ code: string; kind: ErrorKind; message: string }>;

/** A business failure with stable meaning. HTTP status is assigned later by the filter (I14). */
export class AppError extends Error {
  readonly code: string;
  readonly kind: ErrorKind;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(definition: ErrorDefinition, details?: Record<string, unknown>) {
    super(definition.message);
    this.name = 'AppError';
    this.code = definition.code;
    this.kind = definition.kind;
    this.details = details;
  }
}
```

- [ ] **Step 2:** `src/errors/baseline-errors.ts`:

```ts
import type { ErrorDefinition } from './app-error.js';

export const baselineErrors = {
  VALIDATION_FAILED: { code: 'VALIDATION_FAILED', kind: 'validation', message: 'The request is invalid.' },
  NOT_FOUND: { code: 'NOT_FOUND', kind: 'not_found', message: 'The requested resource was not found.' },
} as const satisfies Record<string, ErrorDefinition>;
```

- [ ] **Step 3: failing tests.** `src/http/to-contract-error.spec.ts`:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AppError } from '../errors/app-error.js';
import { baselineErrors } from '../errors/baseline-errors.js';
import { toContractError } from './to-contract-error.js';

const envelope = (code: string, message: string, details: object = {}) => ({ data: null, error: { code, message, details } });

describe('toContractError', () => {
  it('maps an AppError by kind, keeping code, message and details', () => {
    const result = toContractError(new AppError(baselineErrors.VALIDATION_FAILED, { fields: [] }));
    expect(result).toEqual({ status: 400, unexpected: false, body: envelope('VALIDATION_FAILED', 'The request is invalid.', { fields: [] }) });
  });

  it('maps a not_found AppError to 404', () => {
    expect(toContractError(new AppError(baselineErrors.NOT_FOUND)).status).toBe(404);
  });

  it('maps a framework 404 (unknown route) to NOT_FOUND with our message', () => {
    expect(toContractError(new NotFoundException('Cannot GET /nope'))).toEqual({
      status: 404, unexpected: false, body: envelope('NOT_FOUND', 'The requested resource was not found.'),
    });
  });

  it('maps a body-parser JSON syntax error to VALIDATION_FAILED with no fields', () => {
    const parseError = Object.assign(new SyntaxError('Unexpected token'), { status: 400, type: 'entity.parse.failed' });
    expect(toContractError(parseError)).toEqual({
      status: 400, unexpected: false, body: envelope('VALIDATION_FAILED', 'The request body is not valid JSON.', { fields: [] }),
    });
  });

  it('maps a framework 400 to VALIDATION_FAILED with no fields', () => {
    expect(toContractError(new BadRequestException('anything')).body.error.code).toBe('VALIDATION_FAILED');
  });

  it('maps an over-limit body to PAYLOAD_TOO_LARGE', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), { status: 413, type: 'entity.too.large' });
    expect(toContractError(tooLarge)).toEqual({
      status: 413, unexpected: false, body: envelope('PAYLOAD_TOO_LARGE', 'The request body is too large.'),
    });
  });

  it.each([new Error('relation "x" does not exist'), 'a string', null, Object.assign(new Error('teapot'), { status: 418 })])(
    'maps anything else to a generic 500 without leaking (%s)',
    (thrown) => {
      expect(toContractError(thrown)).toEqual({
        status: 500, unexpected: true, body: envelope('INTERNAL_ERROR', 'Something went wrong. Please try again.'),
      });
    },
  );
});
```

- [ ] **Step 4:** `yarn test src/http` → FAIL.
- [ ] **Step 5:** `src/http/error-status.ts`:

```ts
import type { ErrorKind } from '../errors/app-error.js';

export const statusForKind: Record<ErrorKind, number> = {
  validation: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
};

/** Codes the HTTP layer produces itself (not business definitions). */
export const frameworkCodes = {
  PAYLOAD_TOO_LARGE: { code: 'PAYLOAD_TOO_LARGE', status: 413, message: 'The request body is too large.' },
  INTERNAL_ERROR: { code: 'INTERNAL_ERROR', status: 500, message: 'Something went wrong. Please try again.' },
} as const;
```

- [ ] **Step 6:** `src/http/to-contract-error.ts`:

```ts
import { HttpException } from '@nestjs/common';
import { AppError } from '../errors/app-error.js';
import { baselineErrors } from '../errors/baseline-errors.js';
import { frameworkCodes, statusForKind } from './error-status.js';

export type ContractErrorBody = {
  data: null;
  error: { code: string; message: string; details: Readonly<Record<string, unknown>> };
};

export type ContractError = { status: number; body: ContractErrorBody; unexpected: boolean };

const body = (code: string, message: string, details: Readonly<Record<string, unknown>> = {}): ContractErrorBody => ({
  data: null,
  error: { code, message, details },
});

/** Turns anything thrown into the contract's error envelope (I13). Never copies a raw message (I16). */
export function toContractError(exception: unknown): ContractError {
  if (exception instanceof AppError) {
    return { status: statusForKind[exception.kind], unexpected: false, body: body(exception.code, exception.message, exception.details) };
  }

  const status = frameworkStatus(exception);
  if (status === 404) {
    return { status, unexpected: false, body: body(baselineErrors.NOT_FOUND.code, baselineErrors.NOT_FOUND.message) };
  }
  if (status === 400) {
    const invalidJson = (exception as { type?: unknown }).type === 'entity.parse.failed';
    const message = invalidJson ? 'The request body is not valid JSON.' : baselineErrors.VALIDATION_FAILED.message;
    return { status, unexpected: false, body: body(baselineErrors.VALIDATION_FAILED.code, message, { fields: [] }) };
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
    const status = (exception as { status?: unknown; statusCode?: unknown }).status ?? (exception as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number') return status;
  }
  return undefined;
}
```

- [ ] **Step 7:** `yarn test src/http` → PASS. Commit `feat(http): add application errors and contract error mapping`.

---

### Task 7: E2E harness, global filter and the fixture module

**`[learn]`**

| | |
|---|---|
| **Goal** | `createTestApp()`, a guarded `resetDatabase()`, a test-only fixture module, the global `ContractExceptionFilter`, and the first green e2e |
| **Why this exists** | Platform behavior is proven by e2e without any business module (`development-workflow.md` §11). The guard is I21 |
| **Concept** | `Test.createTestingModule` builds the same `AppModule` as production; `APP_FILTER` providers come with it; `main.ts` doesn't |
| **Verify** | `yarn test:e2e` |
| **Expected** | `http-contract.e2e-spec.ts` error cases pass |
| **Common failure** | Registering the filter in `main.ts` with `app.useGlobalFilters`: the e2e app wouldn't have it (D6) |

**Interfaces:**
- Consumes: `toContractError`, `AppError`, `baselineErrors`, `AppConfigModule`, `DatabaseModule`.
- Produces:
  - `createTestApp(extraImports?: Type[]): Promise<NestExpressApplication>`
  - `resetDatabase(app): Promise<void>`
  - `FixtureModule`
  - `ContractExceptionFilter`
  - `HttpContractModule`
  - `configureApp(app, config)`: stub now, completed in Task 11

- [ ] **Step 1:** `src/http/contract-exception.filter.ts`:

```ts
import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { toContractError } from './to-contract-error.js';

@Catch()
export class ContractExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ContractExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const { status, body, unexpected } = toContractError(exception);

    if (unexpected) {
      // Method + route + error only. Never bodies, headers or cookies (I17).
      const error = exception instanceof Error ? exception : new Error(String(exception));
      const driver = (exception as { driverError?: { code?: string; constraint?: string } }).driverError;
      const db = driver ? ` [pg ${driver.code ?? '?'} ${driver.constraint ?? ''}]` : '';
      this.logger.error(`${request.method} ${request.route?.path ?? request.path} → ${error.name}: ${error.message}${db}`, error.stack);
    }

    response.status(status).json(body);
  }
}
```

- [ ] **Step 2:** `src/http/http-contract.module.ts`. The pipe and interceptor are added in Tasks 8 and 9:

```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ContractExceptionFilter } from './contract-exception.filter.js';

@Module({
  providers: [{ provide: APP_FILTER, useClass: ContractExceptionFilter }],
})
export class HttpContractModule {}
```

  Add `HttpContractModule` to `AppModule` imports.
- [ ] **Step 3:** `src/http/configure-app.ts`, a minimal stub completed in Task 11:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AppConfig } from '../config/load-config.js';

export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.useBodyParser('json', { limit: '100kb' });
  void config; // used from Task 11 on
}
```

- [ ] **Step 4:** `test/support/create-test-app.ts`:

```ts
import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { APP_CONFIG } from '../../src/config/app-config.module.js';
import type { AppConfig } from '../../src/config/load-config.js';
import { configureApp } from '../../src/http/configure-app.js';

/** Same AppModule + same configureApp() as main.ts (D6). */
export async function createTestApp(extraImports: Type[] = []): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule, ...extraImports] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: ['error'] });
  configureApp(app, app.get<AppConfig>(APP_CONFIG));
  await app.init();
  return app;
}
```

- [ ] **Step 5:** `test/support/reset-database.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Destructive: refuses unless connected to a *_test database (I21). */
export async function resetDatabase(app: INestApplication): Promise<void> {
  const dataSource = app.get(DataSource);
  const [{ name }] = await dataSource.query<{ name: string }[]>('SELECT current_database() AS name');
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to truncate database "${name}": not a *_test database (I21).`);
  }
  const tables = await dataSource.query<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'migrations'`,
  );
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await dataSource.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
```

- [ ] **Step 6:** `test/fixtures/fixture.module.ts` (test-only, never imported by `src/`):

```ts
import { Body, Controller, Get, HttpCode, Module, Post } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../src/errors/app-error.js';
import { baselineErrors } from '../../src/errors/baseline-errors.js';

export const fixtureSchema = z
  .strictObject({
    name: z.string().min(1).max(5),
    address: z.strictObject({ city: z.string() }),
    tags: z.array(z.string().max(3)).optional(),
  })
  .meta({ id: 'FixtureEchoDto' });

@Controller('__fixture')
class FixtureController {
  @Get('payload') payload() { return { hello: 'world' }; }
  @Post('no-content') @HttpCode(204) noContent(): void {}
  @Get('undefined') returnsUndefined() { return undefined; }
  @Get('app-error') appError() { throw new AppError(baselineErrors.NOT_FOUND); }
  @Get('crash') crash() { throw new Error('relation "secret_table" does not exist'); }
  @Post('echo') echo(@Body({ schema: fixtureSchema }) body: z.infer<typeof fixtureSchema>) { return body; }
}

@Module({ controllers: [FixtureController] })
export class FixtureModule {}
```

- [ ] **Step 7:** `vitest.config.e2e.ts`. Keep the starter's plugins and add:

```ts
test: {
  globals: true,
  root: './',
  include: ['test/**/*.e2e-spec.ts'],
  fileParallelism: false, // shared xuan_test database (D39)
},
```

  Script (migrations first, against `xuan_test`):

```json
"test:e2e": "NODE_ENV=test yarn migration:run && NODE_ENV=test vitest run --config vitest.config.e2e.ts"
```

- [ ] **Step 8: tests.** `test/http-contract.e2e-spec.ts`. The error half now; the success half arrives in Task 8:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { FixtureModule } from './fixtures/fixture.module.js';
import { createTestApp } from './support/create-test-app.js';

const envelope = (code: string, message: string, details: object = {}) => ({ data: null, error: { code, message, details } });

describe('HTTP contract (fixture)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => { app = await createTestApp([FixtureModule]); });
  afterAll(async () => { await app.close(); });

  it('AppError → its envelope and status', async () => {
    const res = await request(app.getHttpServer()).get('/__fixture/app-error');
    expect(res.status).toBe(404);
    expect(res.body).toEqual(envelope('NOT_FOUND', 'The requested resource was not found.'));
  });

  it('unknown route → NOT_FOUND envelope', async () => {
    const res = await request(app.getHttpServer()).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual(envelope('NOT_FOUND', 'The requested resource was not found.'));
  });

  it('unexpected error → generic 500, internals not leaked', async () => {
    const res = await request(app.getHttpServer()).get('/__fixture/crash');
    expect(res.status).toBe(500);
    expect(res.body).toEqual(envelope('INTERNAL_ERROR', 'Something went wrong. Please try again.'));
    expect(JSON.stringify(res.body)).not.toContain('secret_table');
  });

  it('malformed JSON → VALIDATION_FAILED with no fields', async () => {
    const res = await request(app.getHttpServer()).post('/__fixture/echo').set('Content-Type', 'application/json').send('{"name":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual(envelope('VALIDATION_FAILED', 'The request body is not valid JSON.', { fields: [] }));
  });

  it('body over 100kb → PAYLOAD_TOO_LARGE', async () => {
    const res = await request(app.getHttpServer()).post('/__fixture/echo').set('Content-Type', 'application/json').send(JSON.stringify({ name: 'x'.repeat(200_000) }));
    expect(res.status).toBe(413);
    expect(res.body).toEqual(envelope('PAYLOAD_TOO_LARGE', 'The request body is too large.'));
  });
});
```

- [ ] **Step 9:** `yarn test:e2e`. **Expected:** green.
  - **Spike:** if the malformed-JSON or 413 cases fail, inspect what reaches the filter (temporarily log `exception` in a test run). Adjust `frameworkStatus` (not the contract), and record the finding in `architecture.md` §16.
- [ ] **Step 10:** commit `feat(http): add contract exception filter and e2e harness`.

---

### Task 8: Success envelope interceptor (`{ data }`, 204, `undefined` → 500)

**`[learn]`**

| | |
|---|---|
| **Goal** | Every payload becomes `{ data }`; `@HttpCode(204)` sends an empty body; `undefined` from a payload route becomes a 500 bug |
| **Why this exists** | I11 and I12, globally, so no controller can forget them |
| **Concept** | Interceptors wrap the handler's observable (`map`); `Reflector` reads decorator metadata |
| **Verify** | `yarn test:e2e` |
| **Expected** | Three new fixture tests pass |
| **Common failure** | Checking `response.statusCode` inside the interceptor: Nest may apply `@HttpCode` only when it sends the response, so it still reads 200. Read the metadata instead (verification spike) |

- [ ] **Step 1: tests.** Add to `test/http-contract.e2e-spec.ts`:

```ts
it('payload → { data }', async () => {
  const res = await request(app.getHttpServer()).get('/__fixture/payload');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ data: { hello: 'world' } });
});

it('@HttpCode(204) → empty body', async () => {
  const res = await request(app.getHttpServer()).post('/__fixture/no-content');
  expect(res.status).toBe(204);
  expect(res.text).toBe('');
});

it('undefined from a payload route → 500 bug, not {}', async () => {
  const res = await request(app.getHttpServer()).get('/__fixture/undefined');
  expect(res.status).toBe(500);
  expect(res.body.error.code).toBe('INTERNAL_ERROR');
});
```

- [ ] **Step 2:** `yarn test:e2e` → the payload test FAILS (`{ hello: 'world' }` unwrapped); the undefined test FAILS (200 with an empty body).
- [ ] **Step 3:** `src/http/success-envelope.interceptor.ts`:

```ts
import { CallHandler, ExecutionContext, HttpStatus, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';

// Value of @nestjs/common's HTTP_CODE_METADATA (verification spike: prefer importing the constant if the ESM exports allow it).
const HTTP_CODE_METADATA = '__httpCode__';

@Injectable()
export class SuccessEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const declared = this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler());
    return next.handle().pipe(
      map((payload: unknown) => {
        if (declared === HttpStatus.NO_CONTENT) return undefined; // I12: empty body
        if (payload === undefined) {
          // A payload route that returned nothing is a bug (I12): becomes a 500 through the filter.
          throw new Error(`${context.getClass().name}.${context.getHandler().name} returned undefined without @HttpCode(204)`);
        }
        return { data: payload }; // I11
      }),
    );
  }
}
```

- [ ] **Step 4:** register `{ provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor }` in `HttpContractModule`. Run `yarn test:e2e` → PASS. Record in §16 how the 204 detection works.
- [ ] **Step 5:** commit `feat(http): add success envelope interceptor`.

---

### Task 9: Validation pipe + field-error translation

**`[learn]`**

| | |
|---|---|
| **Goal** | The global `StandardSchemaValidationPipe` turns Zod issues into `400 VALIDATION_FAILED` + `details.fields[]`, with dot paths and stable field codes |
| **Why this exists** | I13 and the contract's field-code table (`api-contract.md` §4); xuan-web maps `field` straight onto form fields |
| **Concept** | Standard Schema issues (`{ message, path }`, with Zod extras at runtime); vendor narrowing; why our own user-safe messages beat library messages |
| **Verify** | `yarn test src/http/to-field-errors` and `yarn test:e2e` |
| **Expected** | Unit table and fixture e2e green |
| **Common failure** | Assuming the Zod issue shape. Step 1 prints real issues first (verification spike) |

**Interfaces, produces:** `toFieldErrors(issues: readonly SchemaIssue[]): FieldError[]`; `type FieldError = { field: string; message: string; code: FieldCode }`.

- [ ] **Step 1 (spike):** a throwaway unit test that prints real issues:

```ts
import { z } from 'zod';
it('prints zod issues', () => {
  const r = z.strictObject({ name: z.string().max(5), address: z.strictObject({ city: z.string() }), n: z.number().min(1) })
    .safeParse({ name: 'toolong', address: { city: 3, extra: 1 }, n: 0, isAdmin: true });
  console.log(JSON.stringify(r.success ? null : r.error.issues, null, 2));
});
```

  Read the output and note how a **missing** value appears (`invalid_type` + its message, and whether `input` exists). Delete this test after Step 2.
- [ ] **Step 2: failing tests.** `src/http/to-field-errors.spec.ts`. Adjust only the `missing` fixture to match what Step 1 showed:

```ts
import { toFieldErrors } from './to-field-errors.js';

describe('toFieldErrors', () => {
  it.each([
    ['missing value', { code: 'invalid_type', expected: 'string', message: 'Invalid input: expected string, received undefined', path: ['email'] }, [{ field: 'email', code: 'REQUIRED', message: 'This field is required.' }]],
    ['wrong type', { code: 'invalid_type', expected: 'string', message: 'Invalid input: expected string, received number', path: ['address', 'city'] }, [{ field: 'address.city', code: 'INVALID_TYPE', message: 'This value has the wrong type.' }]],
    ['format', { code: 'invalid_format', format: 'email', message: 'Invalid email', path: ['email'] }, [{ field: 'email', code: 'INVALID_FORMAT', message: 'This value has an invalid format.' }]],
    ['string too long', { code: 'too_big', origin: 'string', maximum: 5, message: 'Too big', path: ['name'] }, [{ field: 'name', code: 'TOO_LONG', message: 'This value is too long.' }]],
    ['string too short', { code: 'too_small', origin: 'string', minimum: 1, message: 'Too small', path: ['name'] }, [{ field: 'name', code: 'TOO_SHORT', message: 'This value is too short.' }]],
    ['number too small', { code: 'too_small', origin: 'number', minimum: 1, message: 'Too small', path: ['n'] }, [{ field: 'n', code: 'TOO_SMALL', message: 'This value is too small.' }]],
    ['number too large', { code: 'too_big', origin: 'number', maximum: 9, message: 'Too big', path: ['n'] }, [{ field: 'n', code: 'TOO_LARGE', message: 'This value is too large.' }]],
    ['array index path', { code: 'too_big', origin: 'string', maximum: 3, message: 'Too big', path: ['tags', 0] }, [{ field: 'tags.0', code: 'TOO_LONG', message: 'This value is too long.' }]],
    ['object path segments', { code: 'invalid_format', message: 'x', path: [{ key: 'a' }, { key: 'b' }] }, [{ field: 'a.b', code: 'INVALID_FORMAT', message: 'This value has an invalid format.' }]],
    ['unknown keys expand per key', { code: 'unrecognized_keys', keys: ['isAdmin', 'role'], message: 'Unrecognized keys', path: ['address'] }, [
      { field: 'address.isAdmin', code: 'UNKNOWN_FIELD', message: 'This field is not allowed.' },
      { field: 'address.role', code: 'UNKNOWN_FIELD', message: 'This field is not allowed.' },
    ]],
    ['anything else', { code: 'custom', message: 'whatever', path: ['x'] }, [{ field: 'x', code: 'INVALID', message: 'This value is invalid.' }]],
  ])('%s', (_name, issue, expected) => {
    expect(toFieldErrors([issue])).toEqual(expected);
  });
});
```

- [ ] **Step 3:** `yarn test src/http` → FAIL.
- [ ] **Step 4:** `src/http/to-field-errors.ts`:

```ts
type PathSegment = PropertyKey | { readonly key: PropertyKey };

/** A Standard Schema issue. Zod adds `code` and more at runtime, so they're read defensively (vendor narrowing). */
export type SchemaIssue = { readonly message: string; readonly path?: ReadonlyArray<PathSegment> } & Record<string, unknown>;

export type FieldCode = 'REQUIRED' | 'INVALID_TYPE' | 'INVALID_FORMAT' | 'TOO_SHORT' | 'TOO_LONG' | 'TOO_SMALL' | 'TOO_LARGE' | 'UNKNOWN_FIELD' | 'INVALID';

export type FieldError = { field: string; message: string; code: FieldCode };

const messages: Record<FieldCode, string> = {
  REQUIRED: 'This field is required.',
  INVALID_TYPE: 'This value has the wrong type.',
  INVALID_FORMAT: 'This value has an invalid format.',
  TOO_SHORT: 'This value is too short.',
  TOO_LONG: 'This value is too long.',
  TOO_SMALL: 'This value is too small.',
  TOO_LARGE: 'This value is too large.',
  UNKNOWN_FIELD: 'This field is not allowed.',
  INVALID: 'This value is invalid.',
};

export function toFieldErrors(issues: readonly SchemaIssue[]): FieldError[] {
  return issues.flatMap((issue) => {
    const base = toDotPath(issue.path ?? []);
    if (issue.code === 'unrecognized_keys' && Array.isArray(issue.keys)) {
      return issue.keys.map((key) => field(joinPath(base, String(key)), 'UNKNOWN_FIELD'));
    }
    return [field(base, codeFor(issue))];
  });
}

function codeFor(issue: SchemaIssue): FieldCode {
  const isString = issue.origin === 'string' || issue.origin === 'array';
  switch (issue.code) {
    case 'invalid_type':
      // Spike (Step 1): Zod 4 reports a missing value as invalid_type "received undefined".
      return /received undefined/.test(issue.message) ? 'REQUIRED' : 'INVALID_TYPE';
    case 'invalid_format': return 'INVALID_FORMAT';
    case 'too_small': return isString ? 'TOO_SHORT' : 'TOO_SMALL';
    case 'too_big': return isString ? 'TOO_LONG' : 'TOO_LARGE';
    default: return 'INVALID';
  }
}

const field = (path: string, code: FieldCode): FieldError => ({ field: path, message: messages[code], code });

const toDotPath = (path: ReadonlyArray<PathSegment>): string =>
  path.map((segment) => String(typeof segment === 'object' && segment !== null ? segment.key : segment)).join('.');

const joinPath = (base: string, key: string): string => (base ? `${base}.${key}` : key);
```

- [ ] **Step 5:** `yarn test src/http` → PASS.
- [ ] **Step 6:** register the pipe in `HttpContractModule`:

```ts
import { StandardSchemaValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { AppError } from '../errors/app-error.js';
import { baselineErrors } from '../errors/baseline-errors.js';
import { toFieldErrors, type SchemaIssue } from './to-field-errors.js';
// …
{
  provide: APP_PIPE,
  useFactory: () =>
    new StandardSchemaValidationPipe({
      exceptionFactory: (issues) =>
        new AppError(baselineErrors.VALIDATION_FAILED, { fields: toFieldErrors(issues as readonly SchemaIssue[]) }),
    }),
},
```

- [ ] **Step 7: e2e.** Add to `test/http-contract.e2e-spec.ts`:

```ts
it('valid body → echoed in { data }', async () => {
  const body = { name: 'Xuan', address: { city: 'HCM' } };
  const res = await request(app.getHttpServer()).post('/__fixture/echo').send(body);
  expect(res.status).toBe(201);
  expect(res.body).toEqual({ data: body });
});

it('invalid body → VALIDATION_FAILED with dot paths and field codes', async () => {
  const res = await request(app.getHttpServer())
    .post('/__fixture/echo')
    .send({ name: 'toolong', address: { city: 3 }, tags: ['abcd'], isAdmin: true });
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION_FAILED');
  expect(res.body.error.details.fields).toEqual(
    expect.arrayContaining([
      { field: 'name', code: 'TOO_LONG', message: 'This value is too long.' },
      { field: 'address.city', code: 'INVALID_TYPE', message: 'This value has the wrong type.' },
      { field: 'tags.0', code: 'TOO_LONG', message: 'This value is too long.' },
      { field: 'isAdmin', code: 'UNKNOWN_FIELD', message: 'This field is not allowed.' },
    ]),
  );
});

it('missing required field → REQUIRED', async () => {
  const res = await request(app.getHttpServer()).post('/__fixture/echo').send({ address: { city: 'HCM' } });
  expect(res.body.error.details.fields).toEqual([{ field: 'name', code: 'REQUIRED', message: 'This field is required.' }]);
});
```

  Run `yarn test:e2e` → PASS. Record the vendor-narrowing result in §16.
- [ ] **Step 8:** commit `feat(http): add validation pipe and field error translation`.

---

### Task 10: OpenAPI helpers and the document-build test

**`[learn]`**

| | |
|---|---|
| **Goal** | `@ApiEnvelopeResponse`, `@ApiErrorResponses`, error schemas, `createOpenApiDocument()`. A test proves the document builds with named components |
| **Why this exists** | OpenAPI is the executable contract (`api-contract.md` §0). Docs come from the same definitions as runtime (I18) |
| **Concept** | `applyDecorators`, `ApiExtraModels`, `getSchemaPath` (`$ref` to named components); how Zod schemas become request schemas |
| **Verify** | `yarn test:e2e` |
| **Expected** | `openapi.e2e-spec.ts` passes: components `ErrorEnvelopeDto`, `ValidationErrorDetailsDto` and `FixtureEchoDto` exist; `/__fixture/echo` documents 201, 400 and 500 |
| **Common failure** | The Zod body is inlined instead of named `FixtureEchoDto` (spike). Fallback: `standardSchemaConverter` in `SwaggerDocumentOptions` (Nest docs); a new dependency only with a stated reason |

**Interfaces, produces:**
- `ApiEnvelopeResponse(dto: Type, options?: { status?: number; isArray?: boolean })`
- `ApiErrorResponses(...definitions: ErrorDefinition[])`
- `createOpenApiDocument(app): OpenAPIObject`
- `setupOpenApi(app): void`

- [ ] **Step 1:** `yarn add @nestjs/swagger`
- [ ] **Step 2:** `src/http/openapi/error-schemas.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';

export class FieldErrorDto {
  @ApiProperty({ example: 'address.city' }) field!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ enum: ['REQUIRED', 'INVALID_TYPE', 'INVALID_FORMAT', 'TOO_SHORT', 'TOO_LONG', 'TOO_SMALL', 'TOO_LARGE', 'UNKNOWN_FIELD', 'INVALID'] }) code!: string;
}

export class ValidationErrorDetailsDto {
  @ApiProperty({ type: [FieldErrorDto] }) fields!: FieldErrorDto[];
}

export class ErrorBodyDto {
  @ApiProperty({ example: 'NOT_FOUND' }) code!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) details!: Record<string, unknown>;
}

export class ErrorEnvelopeDto {
  @ApiProperty({ type: 'null', nullable: true, example: null }) data!: null;
  @ApiProperty({ type: ErrorBodyDto }) error!: ErrorBodyDto;
}
```

- [ ] **Step 3:** `src/http/openapi/api-envelope-response.ts`:

```ts
import { applyDecorators, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';

/** Documents { data: Dto } (or { data: Dto[] }), matching the success interceptor (I11). */
export function ApiEnvelopeResponse(dto: Type<unknown>, options: { status?: number; isArray?: boolean } = {}) {
  const data = options.isArray ? { type: 'array', items: { $ref: getSchemaPath(dto) } } : { $ref: getSchemaPath(dto) };
  return applyDecorators(
    ApiExtraModels(dto),
    ApiResponse({
      status: options.status ?? 200,
      schema: { type: 'object', required: ['data'], properties: { data, message: { type: 'string' }, code: { type: 'string' } } },
    }),
  );
}
```

- [ ] **Step 4:** `src/http/openapi/api-error-responses.ts`. `VALIDATION_FAILED` is listed **explicitly** by endpoints with input (spike decided: explicit):

```ts
import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import type { ErrorDefinition } from '../../errors/app-error.js';
import { frameworkCodes, statusForKind } from '../error-status.js';
import { ErrorEnvelopeDto, ValidationErrorDetailsDto } from './error-schemas.js';

/** Documents every error code the endpoint can return, from the runtime definitions (I18). Always adds 500. */
export function ApiErrorResponses(...definitions: ErrorDefinition[]) {
  const codesByStatus = new Map<number, string[]>();
  const add = (status: number, code: string) => codesByStatus.set(status, [...(codesByStatus.get(status) ?? []), code]);
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
            { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string', enum: codes } } } } },
          ],
        },
      }),
    ),
  );
}
```

- [ ] **Step 5:** `src/http/openapi/setup-open-api.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder().setTitle('xuan-api').setVersion('1').build();
  return SwaggerModule.createDocument(app, config);
}

/** Serves /docs and /docs-json. Called by configureApp only when config enables docs (D20). */
export function setupOpenApi(app: INestApplication): void {
  SwaggerModule.setup('docs', app, createOpenApiDocument(app));
}
```

- [ ] **Step 6:** decorate the fixture echo route: `@ApiEnvelopeResponse(Object, { status: 201 })` is not allowed (no DTO), so give the fixture a response DTO:

```ts
class FixtureEchoResultDto { @ApiProperty() name!: string; }
// on echo(): @ApiEnvelopeResponse(FixtureEchoResultDto, { status: 201 }) @ApiErrorResponses(baselineErrors.VALIDATION_FAILED)
```

- [ ] **Step 7: test.** `test/openapi.e2e-spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createOpenApiDocument } from '../src/http/openapi/setup-open-api.js';
import { FixtureModule } from './fixtures/fixture.module.js';
import { createTestApp } from './support/create-test-app.js';

describe('OpenAPI document', () => {
  let app: NestExpressApplication;
  beforeAll(async () => { app = await createTestApp([FixtureModule]); });
  afterAll(async () => { await app.close(); });

  it('builds with the shared named components', () => {
    const doc = createOpenApiDocument(app);
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(['ErrorEnvelopeDto', 'ValidationErrorDetailsDto', 'FixtureEchoResultDto', 'FixtureEchoDto']),
    );
    expect(Object.keys(doc.paths['/__fixture/echo'].post?.responses ?? {})).toEqual(expect.arrayContaining(['201', '400', '500']));
  });
});
```

- [ ] **Step 8:** `yarn test:e2e`.
  - If `FixtureEchoDto` is missing (Zod schema inlined), apply the spike fallback and record it in §16.
  - Commit `feat(http): add openapi envelope and error decorators`.

---

### Task 11: Bootstrap: JSON-only body, helmet, CORS, Swagger, `main.ts`

**`[learn]`**

| | |
|---|---|
| **Goal** | `configureApp()` completed; `main.ts` final; CORS and body behavior proven |
| **Why this exists** | xuan-web calls with `credentials: 'include'` (I20); form posts must not be parsed (D21); the same setup runs in tests (D6) |
| **Concept** | CORS preflight vs simple requests; why `credentials: true` forbids wildcard origins; the Express body-parser chain |
| **Verify** | `yarn test:e2e`; `yarn start:dev` then open `http://localhost:4000/docs` |
| **Expected** | CORS/body tests green; Swagger UI renders (or the CSP spike is recorded) |
| **Common failure** | Helmet's CSP blocking the Swagger UI. Relax CSP only when docs are enabled |

- [ ] **Step 1:** `yarn add helmet`
- [ ] **Step 2: tests.** `test/cors-and-body.e2e-spec.ts`. `.env.test` has `CORS_ORIGINS=http://localhost:3000`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { FixtureModule } from './fixtures/fixture.module.js';
import { createTestApp } from './support/create-test-app.js';

describe('CORS and body parsing', () => {
  let app: NestExpressApplication;
  beforeAll(async () => { app = await createTestApp([FixtureModule]); });
  afterAll(async () => { await app.close(); });

  it('allowed origin → credentialed CORS headers', async () => {
    const res = await request(app.getHttpServer())
      .options('/__fixture/echo')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-requested-with');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-headers']?.toLowerCase()).toContain('x-requested-with');
  });

  it('disallowed origin → no allow-origin header', async () => {
    const res = await request(app.getHttpServer()).get('/__fixture/payload').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it.each([
    ['form-encoded', 'application/x-www-form-urlencoded', 'name=Xuan&address[city]=HCM'],
    ['text/plain', 'text/plain', '{"name":"Xuan","address":{"city":"HCM"}}'],
  ])('%s body is not parsed → VALIDATION_FAILED', async (_n, type, payload) => {
    const res = await request(app.getHttpServer()).post('/__fixture/echo').set('Content-Type', type).send(payload);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('sets helmet security headers', async () => {
    const res = await request(app.getHttpServer()).get('/__fixture/payload');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
```

- [ ] **Step 3:** `yarn test:e2e` → FAIL.
- [ ] **Step 4:** complete `src/http/configure-app.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { AppConfig } from '../config/load-config.js';
import { setupOpenApi } from './openapi/setup-open-api.js';

/** App-level HTTP setup shared by main.ts and the e2e factory (D6). */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.useBodyParser('json', { limit: '100kb' }); // JSON only (D21)
  app.use(helmet({ contentSecurityPolicy: config.docs.enabled ? false : undefined })); // spike: Swagger UI needs inline scripts
  app.enableCors({
    origin: [...config.cors.origins], // exact origins, never '*' (I20)
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-Requested-With'],
  });
  if (config.docs.enabled) setupOpenApi(app); // D20
}
```

- [ ] **Step 5:** `src/main.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { APP_CONFIG } from './config/app-config.module.js';
import type { AppConfig } from './config/load-config.js';
import { configureApp } from './http/configure-app.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const config = app.get<AppConfig>(APP_CONFIG); // invalid config already failed during create (I5)
  configureApp(app, config);
  app.enableShutdownHooks(); // TypeORM closes its pool on SIGTERM
  await app.listen(config.port);
}

await bootstrap();
```

- [ ] **Step 6:**
  - Run `yarn test:e2e` → PASS.
  - Run `yarn start:dev`, open `http://localhost:4000/docs` and `/docs-json`. Record the CSP result in §16.
  - Break `.env` (e.g. `DATABASE_URL=nope`) and run `yarn start:dev`. **Expected:** startup fails with `Invalid configuration: DATABASE_URL` and no value printed. Restore `.env`.
- [ ] **Step 7:** commit `feat(http): add bootstrap security, cors and openapi setup` → review → PR phase C.

---

### Task 12: Phase C checkpoint review

**`[learn]`**

| | |
|---|---|
| **Goal** | The platform is reviewed before any business code depends on it |
| **Why this exists** | Every slice inherits these behaviors; mistakes here multiply |
| **Concept** | Evidence-first review; reading your own diff as a reviewer |
| **Verify** | `xuan-api-architecture-review` verdict |
| **Expected** | `PASS` or `PASS WITH NOTES` |
| **Common failure** | Skipping §16 updates: every spike result must be written down |

- [ ] **Step 1:** Run `yarn lint`, `yarn typecheck`, `yarn test` and `yarn test:e2e`, and keep the output.
- [ ] **Step 2:** Ask Claude for `xuan-api-architecture-review` on the phase C branch; fix the findings.
- [ ] **Step 3:** Confirm `architecture.md` §16 records all spike results: 204 detection, vendor narrowing, `.meta({ id })`, helmet CSP, `loadEnvFile`, lint tool, ESM CLI, body-parser errors.
- [ ] **Step 4:** PR / merge phase C into `dev`.

---

### Task 13: ⛔ CHECKPOINT: review the Services physical schema

**`[learn]`** · branch `feat/build-services-catalog`

| | |
|---|---|
| **Goal** | The owner reviews and approves the `services` table map in `docs/database.md` §12 **before** any entity or migration exists |
| **Why this exists** | The map is the design (`xuan-database-change` step 3). Changing a design costs minutes; changing a migrated table costs a migration |
| **Concept** | Reading a schema: types, nullability, defaults, keys, CHECKs, and why there's no extra index |
| **Verify** | Every column and constraint has a reason you can say out loud |
| **Expected** | The map is approved (or changed), with status still *decided* |
| **Common failure** | Approving columns "for later" (price, description, category). Only what the catalog shows now |

- [ ] **Step 1:** Read `database.md` §12 → `services`. For each row, say why it exists.
- [ ] **Step 2:** Decide or confirm the open points:
  - `duration_minutes` nullable (programs), yes or no;
  - `summary` length 500;
  - `title` 120;
  - `slug` format `^[a-z0-9]+(-[a-z0-9]+)*$`;
  - no price;
  - no `updated_at`.
- [ ] **Step 3:** Approve. Only then continue.

**Settled in this plan** (record in `api-contract.md` §11 during Task 18):
- `GET /services` → `{ data: ServiceDto[] }`, published only, ordered by `sort_order`, then `slug`, **not paginated**.
- `GET /services/:slug` → `{ data: ServiceDto }` for a published service, else `404 NOT_FOUND`. **No slug-format validation:** any string is a lookup key, and an impossible slug simply isn't found. This is a **stated D7 deviation**: the slug is an opaque key, so a format error would add a 400 the client can't act on differently from a 404.
- `ServiceDto` = `{ id, slug, title, summary, durationMinutes }`. `isPublished`, `sortOrder` and `createdAt` stay internal.

---

### Task 14: `ServiceOffering` entity + first migration

**`[learn]`** · **REQUIRED SUB-SKILL:** `xuan-database-change`

| | |
|---|---|
| **Goal** | The `services` table exists in `xuan_dev` and `xuan_test` exactly as the approved map; its invariants are proven against real Postgres |
| **Why this exists** | The first migration sets the precedent for every table (`database.md` §7) |
| **Concept** | Entity decorators → generated SQL → applied schema; `psql \d+`; revert; why the second generate must be empty |
| **Verify** | `\d+ services` matches the map; `yarn test:e2e` (schema tests) green |
| **Expected** | Names `pk_services`, `uq_services_slug`, `ck_services_*`; `created_at timestamp with time zone`; `id DEFAULT uuidv7()` |
| **Common failure** | Hashed `PK_…`/`UQ_…` names, or `TIMESTAMP` without a time zone. Fix the **entity** and regenerate |

**Interfaces, produces:** `class ServiceOffering { id: string; slug: string; title: string; summary: string; durationMinutes: number | null; isPublished: boolean; sortOrder: number; createdAt: Date }`; `ServicesModule` (registers `forFeature([ServiceOffering])`).

- [ ] **Step 1:** `src/modules/services/service-offering.entity.ts`:

```ts
import { Check, Column, CreateDateColumn, Entity, PrimaryColumn, Unique } from 'typeorm';

/** The `services` table (database.md §12). Business word: "service"; class name avoids clashing with Nest services. */
@Entity('services')
@Unique('uq_services_slug', ['slug'])
@Check('ck_services_slug_format', `"slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)
@Check('ck_services_title_not_blank', `btrim("title") <> ''`)
@Check('ck_services_summary_not_blank', `btrim("summary") <> ''`)
@Check('ck_services_duration_minutes_positive', `"duration_minutes" > 0`)
export class ServiceOffering {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()', primaryKeyConstraintName: 'pk_services' })
  id!: string;

  @Column({ type: 'varchar', length: 80 })
  slug!: string;

  @Column({ type: 'varchar', length: 120 })
  title!: string;

  @Column({ type: 'varchar', length: 500 })
  summary!: string;

  @Column({ name: 'duration_minutes', type: 'integer', nullable: true })
  durationMinutes!: number | null;

  @Column({ name: 'is_published', type: 'boolean', default: false })
  isPublished!: boolean;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
```

- [ ] **Step 2:** `src/modules/services/services.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceOffering } from './service-offering.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([ServiceOffering])], // the only registration (I1)
})
export class ServicesModule {}
```

  Add `ServicesModule` to `AppModule`.
- [ ] **Step 3:** `yarn migration:generate src/database/migrations/CreateServices`. **Read the SQL** against the map. Expected `up()`:

```sql
CREATE TABLE "services" ("id" uuid NOT NULL DEFAULT uuidv7(), "slug" character varying(80) NOT NULL,
  "title" character varying(120) NOT NULL, "summary" character varying(500) NOT NULL,
  "duration_minutes" integer, "is_published" boolean NOT NULL DEFAULT false,
  "sort_order" integer NOT NULL DEFAULT 0, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "uq_services_slug" UNIQUE ("slug"),
  CONSTRAINT "ck_services_duration_minutes_positive" CHECK ("duration_minutes" > 0),
  CONSTRAINT "ck_services_summary_not_blank" CHECK (btrim("summary") <> ''),
  CONSTRAINT "ck_services_title_not_blank" CHECK (btrim("title") <> ''),
  CONSTRAINT "ck_services_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT "pk_services" PRIMARY KEY ("id"))
```

  `down()`: `DROP TABLE "services"`. Any hash name or `TIMESTAMP` without a time zone → fix the entity, delete the file, regenerate.
- [ ] **Step 4:** `yarn migration:run`, then `docker compose exec db psql -U xuan_app xuan_dev -c "\d+ services"`. Compare **column by column** with the map.
- [ ] **Step 5:** practise the round trip:
  - `yarn migration:revert` → `\d+ services` (relation not found);
  - `yarn migration:run` → `\d+ services` again.
- [ ] **Step 6:** `yarn migration:generate src/database/migrations/Probe`. **Expected:** "No changes in database schema were found". If a file appears, the entity and the database disagree: read it, fix the entity, delete the probe.
- [ ] **Step 7: schema e2e** (invariants live in the database). `test/services-schema.e2e-spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource, QueryFailedError, type Repository } from 'typeorm';
import { ServiceOffering } from '../src/modules/services/service-offering.entity.js';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const valid = { slug: 'kickstart-session', title: 'Kickstart', summary: 'One focused session.', durationMinutes: 90 };

const constraintOf = async (promise: Promise<unknown>) => {
  try { await promise; } catch (error) {
    if (error instanceof QueryFailedError) return (error.driverError as { constraint?: string }).constraint;
    throw error;
  }
  throw new Error('expected the insert to fail');
};

describe('services table invariants', () => {
  let app: NestExpressApplication;
  let repo: Repository<ServiceOffering>;
  beforeAll(async () => { app = await createTestApp(); repo = app.get(DataSource).getRepository(ServiceOffering); });
  beforeEach(async () => { await resetDatabase(app); });
  afterAll(async () => { await app.close(); });

  it('fills id (uuid v7), created_at and defaults', async () => {
    await repo.insert(valid);
    const row = await repo.findOneByOrFail({ slug: valid.slug });
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.isPublished).toBe(false);
    expect(row.sortOrder).toBe(0);
  });

  it('allows a null duration (programs)', async () => {
    await repo.insert({ ...valid, durationMinutes: null });
    expect((await repo.findOneByOrFail({ slug: valid.slug })).durationMinutes).toBeNull();
  });

  it.each([
    ['duplicate slug', 'uq_services_slug', async (r: Repository<ServiceOffering>) => { await r.insert(valid); return r.insert(valid); }],
    ['uppercase slug', 'ck_services_slug_format', (r: Repository<ServiceOffering>) => r.insert({ ...valid, slug: 'Kickstart' })],
    ['double-dash slug', 'ck_services_slug_format', (r: Repository<ServiceOffering>) => r.insert({ ...valid, slug: 'a--b' })],
    ['blank title', 'ck_services_title_not_blank', (r: Repository<ServiceOffering>) => r.insert({ ...valid, title: '   ' })],
    ['blank summary', 'ck_services_summary_not_blank', (r: Repository<ServiceOffering>) => r.insert({ ...valid, summary: '' })],
    ['zero duration', 'ck_services_duration_minutes_positive', (r: Repository<ServiceOffering>) => r.insert({ ...valid, durationMinutes: 0 })],
  ])('rejects %s via %s', async (_name, constraint, act) => {
    expect(await constraintOf(act(repo))).toBe(constraint);
  });
});
```

- [ ] **Step 8:** `yarn test:e2e` → PASS (`test:e2e` runs the migration on `xuan_test` first).
- [ ] **Step 9:**
  - In `database.md` §12, set the `services` status to **implemented** (migration name, date).
  - Run `xuan-api-architecture-review`.
  - Commit `feat(service): add services table and entity`.

---

### Task 15: `GET /services` (catalog list)

**`[learn]`** · **REQUIRED SUB-SKILL:** `xuan-api-feature`

| | |
|---|---|
| **Goal** | Published services, ordered, as `{ data: ServiceDto[] }` |
| **Why this exists** | The first real payload through the whole stack: repository → service → controller mapping → envelope → OpenAPI |
| **Concept** | Explicit response DTO + mapping (I10, D5); why `isPublished` and `createdAt` don't leave the module; exact-body tests |
| **Verify** | `yarn test:e2e` |
| **Expected** | List tests green, including the draft-hiding and `null`-duration cases (Review Focus 1, 2) |
| **Common failure** | Returning the entities ("they have no secrets"). The exact-body test fails on the extra fields, and that's what it's for |

**Interfaces, produces:**
- `ServicesCatalogService.listPublished(): Promise<ServiceOffering[]>`
- `class ServiceDto`
- `toServiceDto(offering: ServiceOffering): ServiceDto`
- `ServicesController.list(): Promise<ServiceDto[]>`

- [ ] **Step 1: failing tests.** `test/services.e2e-spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { ServiceOffering } from '../src/modules/services/service-offering.entity.js';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

describe('Services catalog', () => {
  let app: NestExpressApplication;
  let repo: Repository<ServiceOffering>;
  beforeAll(async () => { app = await createTestApp(); repo = app.get(DataSource).getRepository(ServiceOffering); });
  beforeEach(async () => { await resetDatabase(app); });
  afterAll(async () => { await app.close(); });

  const seed = (rows: Partial<ServiceOffering>[]) =>
    repo.insert(rows.map((r) => ({ title: 'T', summary: 'S', durationMinutes: 60, isPublished: true, sortOrder: 0, ...r })));

  const idOf = async (slug: string) => (await repo.findOneByOrFail({ slug })).id;

  describe('GET /services', () => {
    it('returns published services ordered by sort_order then slug, as ServiceDto only', async () => {
      await seed([
        { slug: 'coaching-3-months', title: '3-Month 1:1 Coaching', summary: 'Three months.', durationMinutes: null, sortOrder: 2 },
        { slug: 'kickstart-session', title: 'Kickstart', summary: 'One session.', durationMinutes: 90, sortOrder: 1 },
        { slug: 'draft-offer', isPublished: false, sortOrder: 0 },
      ]);
      const res = await request(app.getHttpServer()).get('/services');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: [
          { id: await idOf('kickstart-session'), slug: 'kickstart-session', title: 'Kickstart', summary: 'One session.', durationMinutes: 90 },
          { id: await idOf('coaching-3-months'), slug: 'coaching-3-months', title: '3-Month 1:1 Coaching', summary: 'Three months.', durationMinutes: null },
        ],
      });
    });

    it('returns an empty list, not 404, when nothing is published', async () => {
      const res = await request(app.getHttpServer()).get('/services');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [] });
    });
  });
});
```

- [ ] **Step 2:** `yarn test:e2e` → FAIL (404 `NOT_FOUND`: no route).
- [ ] **Step 3:** `src/modules/services/dto/service.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import type { ServiceOffering } from '../service-offering.entity.js';

/** Public shape of a service (contract identifier, I19). */
export class ServiceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'kickstart-session' }) slug!: string;
  @ApiProperty() title!: string;
  @ApiProperty() summary!: string;
  @ApiProperty({ type: 'integer', nullable: true, description: 'Length of one session in minutes; null when the offer is not a single fixed-length session.' })
  durationMinutes!: number | null;
}

/** Whitelist by construction: only these fields reach the wire (I10). */
export function toServiceDto(offering: ServiceOffering): ServiceDto {
  return {
    id: offering.id,
    slug: offering.slug,
    title: offering.title,
    summary: offering.summary,
    durationMinutes: offering.durationMinutes,
  };
}
```

- [ ] **Step 4:** `src/modules/services/services.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { ServiceOffering } from './service-offering.entity.js';

/** Public catalog use cases. */
@Injectable()
export class ServicesCatalogService {
  constructor(@InjectRepository(ServiceOffering) private readonly offerings: Repository<ServiceOffering>) {}

  listPublished(): Promise<ServiceOffering[]> {
    return this.offerings.find({ where: { isPublished: true }, order: { sortOrder: 'ASC', slug: 'ASC' } });
  }
}
```

- [ ] **Step 5:** `src/modules/services/services.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../http/openapi/api-envelope-response.js';
import { ApiErrorResponses } from '../../http/openapi/api-error-responses.js';
import { ServiceDto, toServiceDto } from './dto/service.dto.js';
import { ServicesCatalogService } from './services.service.js';

@ApiTags('services')
@Controller('services')
export class ServicesController {
  constructor(private readonly catalog: ServicesCatalogService) {}

  @Get()
  @ApiEnvelopeResponse(ServiceDto, { isArray: true })
  @ApiErrorResponses()
  async list(): Promise<ServiceDto[]> {
    const offerings = await this.catalog.listPublished();
    return offerings.map(toServiceDto); // mapping at the HTTP boundary (D5)
  }
}
```

  In `ServicesModule`, add `controllers: [ServicesController]` and `providers: [ServicesCatalogService]`. Export nothing yet.
- [ ] **Step 6:** `yarn test:e2e` → PASS. Commit `feat(service): add public services list endpoint`.

---

### Task 16: `GET /services/:slug`

**`[learn]`** · **REQUIRED SUB-SKILL:** `xuan-api-feature`

| | |
|---|---|
| **Goal** | One published service by slug, else `404 NOT_FOUND` |
| **Why this exists** | The first business-thrown `AppError` (I14) and documented error code (I18) |
| **Concept** | Business failure → `AppError` (baseline `NOT_FOUND`, no new module error file: D10) → filter → envelope |
| **Verify** | `yarn test:e2e` |
| **Expected** | Found / unknown / draft / odd-slug tests green (Review Focus 1, 3) |
| **Common failure** | The unknown-slug 404 test passing **before** the route exists (unknown routes also give `NOT_FOUND`). The found-slug test is what proves the route |

**Interfaces, produces:** `ServicesCatalogService.getPublishedBySlug(slug: string): Promise<ServiceOffering>`; `ServicesController.getBySlug(slug: string): Promise<ServiceDto>`.

- [ ] **Step 1: failing tests.** Add **inside** the outer `describe('Services catalog')` in `test/services.e2e-spec.ts`, so `seed`, `idOf`, `app` and `repo` are in scope:

```ts
describe('GET /services/:slug', () => {
  const notFound = { data: null, error: { code: 'NOT_FOUND', message: 'The requested resource was not found.', details: {} } };

  it('returns one published service', async () => {
    await seed([{ slug: 'kickstart-session', title: 'Kickstart', summary: 'One session.', durationMinutes: 90 }]);
    const res = await request(app.getHttpServer()).get('/services/kickstart-session');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: { id: await idOf('kickstart-session'), slug: 'kickstart-session', title: 'Kickstart', summary: 'One session.', durationMinutes: 90 },
    });
  });

  it.each([
    ['unknown slug', 'nope'],
    ['uppercase slug', 'Kickstart-Session'],
    ['whitespace slug', '%20'],
    ['very long slug', 'a'.repeat(300)],
  ])('%s → 404 NOT_FOUND', async (_n, slug) => {
    await seed([{ slug: 'kickstart-session' }]);
    const res = await request(app.getHttpServer()).get(`/services/${slug}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual(notFound);
  });

  it('a draft is not found', async () => {
    await seed([{ slug: 'draft-offer', isPublished: false }]);
    const res = await request(app.getHttpServer()).get('/services/draft-offer');
    expect(res.status).toBe(404);
    expect(res.body).toEqual(notFound);
  });
});
```

- [ ] **Step 2:** `yarn test:e2e`. The "returns one published service" test FAILS; the 404s may already pass (see Common failure).
- [ ] **Step 3:** add to `ServicesCatalogService`:

```ts
import { AppError } from '../../errors/app-error.js';
import { baselineErrors } from '../../errors/baseline-errors.js';
// …
async getPublishedBySlug(slug: string): Promise<ServiceOffering> {
  const offering = await this.offerings.findOneBy({ slug, isPublished: true });
  if (!offering) throw new AppError(baselineErrors.NOT_FOUND); // I14: never NotFoundException
  return offering;
}
```

- [ ] **Step 4:** add to `ServicesController`:

```ts
import { Param } from '@nestjs/common';
import { baselineErrors } from '../../errors/baseline-errors.js';
// …
@Get(':slug')
@ApiEnvelopeResponse(ServiceDto)
@ApiErrorResponses(baselineErrors.NOT_FOUND)
async getBySlug(@Param('slug') slug: string): Promise<ServiceDto> {
  // D7 deviation (plan Task 13): the slug is an opaque lookup key; an impossible slug is simply not found.
  return toServiceDto(await this.catalog.getPublishedBySlug(slug));
}
```

- [ ] **Step 5:** `yarn test:e2e` → PASS.
- [ ] **Step 6:** extend `test/openapi.e2e-spec.ts`:

```ts
it('documents the services endpoints', async () => {
  const appWithServices = await createTestApp();
  const doc = createOpenApiDocument(appWithServices);
  await appWithServices.close();
  expect(doc.components?.schemas).toHaveProperty('ServiceDto');
  expect(Object.keys(doc.paths['/services'].get?.responses ?? {})).toEqual(expect.arrayContaining(['200', '500']));
  expect(Object.keys(doc.paths['/services/{slug}'].get?.responses ?? {})).toEqual(expect.arrayContaining(['200', '404', '500']));
});
```

  Run `yarn test:e2e` → PASS. Commit `feat(service): add service detail endpoint`.

---

### Task 17: Idempotent catalog seed

**`[learn]`**

| | |
|---|---|
| **Goal** | `yarn seed:services` inserts or updates the real catalog rows, keyed by slug, safely re-runnable |
| **Why this exists** | Initial records come from a reviewed seed (AD12); admin CRUD arrives with auth |
| **Concept** | Upsert: `INSERT … ON CONFLICT ON CONSTRAINT uq_services_slug DO UPDATE`. Why a **named** conflict target (D32) |
| **Verify** | Run twice: row count unchanged. Logged SQL shows `ON CONFLICT ON CONSTRAINT "uq_services_slug"`. `GET /services` in Postman shows the catalog |
| **Expected** | Same rows after the second run; an edited title updates in place |
| **Common failure** | `.orIgnore()`, which emits a target-less `ON CONFLICT DO NOTHING` (verification spike) |

**Owner input required before Step 2:** the real offers and their copy. That's the open product decision "which offers exist" (`data-model.md` §5: homepage design vs live Work With Me page). The rows below are **placeholders**, to be replaced.

- [ ] **Step 1:** `src/modules/services/services.seed.ts` (module code may import `database/`, I2):

```ts
import dataSource from '../../database/data-source.js';
import { ServiceOffering } from './service-offering.entity.js';

// Placeholder copy: the owner replaces these rows with the decided offers before running.
const catalog: Array<Pick<ServiceOffering, 'slug' | 'title' | 'summary' | 'durationMinutes' | 'isPublished' | 'sortOrder'>> = [
  { slug: 'mot-mot-cung-xuan', title: '1:1 cùng Xuân', summary: 'REPLACE: one-on-one session description.', durationMinutes: 60, isPublished: true, sortOrder: 1 },
];

async function seed(): Promise<void> {
  await dataSource.setOptions({ logging: ['query'] }).initialize();
  try {
    await dataSource
      .createQueryBuilder()
      .insert()
      .into(ServiceOffering)
      .values(catalog)
      // Named target (D32): a future unrelated unique constraint must never be silently absorbed.
      .orUpdate(['title', 'summary', 'duration_minutes', 'is_published', 'sort_order'], 'uq_services_slug')
      .execute();
  } finally {
    await dataSource.destroy();
  }
}

await seed();
```

- [ ] **Step 2:** script `"seed:services": "yarn build && node dist/modules/services/services.seed.js"`. Run `yarn seed:services` and **read the logged SQL**.
  - **Expected:** `ON CONFLICT ON CONSTRAINT "uq_services_slug" DO UPDATE SET …`.
  - If the target is missing or column-based, find the TypeORM mechanism that names the constraint, and record it in §16.
- [ ] **Step 3:**
  - Run it again, then `SELECT count(*) FROM services;` (unchanged).
  - Edit a title, re-run, then `SELECT slug, title FROM services;` (updated in place).
- [ ] **Step 4:** run `yarn start:dev`. In Postman, `GET http://localhost:4000/services` and `GET /services/<slug>` return the envelope.
- [ ] **Step 5:** commit `feat(service): add idempotent services catalog seed`.

---

### Task 18: Close the slice: contract, docs, review, PR

**`[learn]`**

| | |
|---|---|
| **Goal** | Docs match the running system; the slice passes review and lands in `dev` |
| **Why this exists** | The Markdown policy and the OpenAPI output must agree (`api-contract.md` §0); docs change with decisions |
| **Concept** | Definition of Done as evidence, not a feeling |
| **Verify** | DoD checklist (`development-workflow.md` §13) |
| **Expected** | `xuan-api-architecture-review` PASS; PR merged |
| **Common failure** | Forgetting the xuan-web side: the snapshot and the mirror deltas are a paired change |

- [ ] **Step 1:** `api-contract.md` §11, replacing "settled in the slice plan":
  - `GET /services` → `{ data: ServiceDto[] }`, published only, ordered by `sort_order` then `slug`, not paginated;
  - `GET /services/:slug` → 404 for unknown, unpublished and malformed slugs (no slug validation; 400 not used);
  - `ServiceDto` fields.

  Update §12 delta #10 to match.
- [ ] **Step 2:** `architecture.md` §16: every spike result recorded. `database.md` §12: `services` **implemented**.
- [ ] **Step 3:** run `yarn lint`, `yarn typecheck`, `yarn test`, `yarn test:e2e` and keep the output.
- [ ] **Step 4:** `xuan-api-architecture-review`; fix the findings.
- [ ] **Step 5:** commit `docs(service): record services catalog contract`. PR `feat/build-services-catalog` → `dev`.
- [ ] **Step 6 (xuan-web, separate repo, owner's timing):** pull `openapi.json` from `http://localhost:4000/docs-json` and apply the mirror deltas listed in `api-contract.md` §12.
