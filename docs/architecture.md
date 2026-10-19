# Architecture

This document covers **what** the architecture of `xuan-api` is and **why**.

| Need | Read |
|---|---|
| Rules, their class and how each is enforced | `code-rules.md` (cited here by ID) |
| Business concepts and how they relate (users, roles, services, courses, content…) | `data-model.md` |
| PostgreSQL, TypeORM, migrations, integrity, the physical schema map | `database.md` |
| The wire contract with `xuan-web` | `api-contract.md` |
| How work is done: learning-first mode, Git, testing, DoD | `development-workflow.md` |
| Step-by-step recipes | The project skills in `.claude/skills/` |

The design was decided in `docs/superpowers/specs/2026-10-09-xuan-api-foundation-architecture-design.md`. That spec is a frozen historical record; **this document is the living truth**.

## 1. Principles

1. **Progressive architecture.** Idiomatic Nest CRUD (module / controller / service / DTO / entity) is the starting point. Every extra layer must answer a concrete problem. If you can't name the problem, the layer doesn't exist.
2. **Clear ownership.** For any table, endpoint, error code or piece of config, it is obvious which folder owns it.
3. **Explicit dependencies.** Nest's DI and module imports make every dependency visible. No globals, no hidden singletons.
4. **The database is an authority, not a storage bin.** Invariants live in constraints (`database.md`).
5. **The contract is real.** What the server sends, what OpenAPI says it sends, and what xuan-web's generated types believe are kept identical (§10).
6. **Explicit over magical, boring over clever.** No wrapper without a responsibility.

"Senior" here doesn't mean more layers. It means every layer can be explained, and each Nest primitive is used for its own job:

| Primitive | Its job here |
|---|---|
| Module | DI boundary and capability ownership |
| Controller | HTTP only |
| Service | Use-case logic |
| Pipe | Request validation |
| Filter | Errors → contract |
| Interceptor | Success envelope |
| Guard | Authentication and authorization: `CsrfGuard`, then `AccessGuard` with `@Public()` / `@Roles()` (§17) |

**Not adopted by default:**
- presentation/application/domain/infrastructure folders
- ports and adapters, repository interfaces
- domain entities separate from persistence entities
- mappers "for cleanliness"
- aggregates, domain events, CQRS, code generators

Each needs a concrete problem (C1, C4).

### Mental shift from the old Express/Mongoose backend

| Kept as a concept | Replaced |
|---|---|
| Organize by business domain | Globals and hidden dependencies → DI |
| Controller → service → persistence | Controllers importing other domains' models → I1, I2 |
| Validate before business logic | Validation inside controllers → global pipe (D7) |
| Auth is cross-cutting | Manual role checks everywhere → guards and decorators (§17) |
| Domain folders | Ad hoc status codes → `AppError` + filter (§9). App-only integrity → constraints. Schema drift → migrations |

## 2. System context

```
  Browser ──fetch, credentials:'include'──►┌─────────────────────────────────────┐
                                            │ api.xuancreative.com  (xuan-api)     │──► PostgreSQL 18
  xuancreative.com (xuan-web, Next.js) ────►│ NestJS 12 · REST · modular monolith  │
     server-side fetch of public data       └─────────────────────────────────────┘
```

- The browser calls the API directly, cross-origin and same-site. That makes CORS with credentials necessary from day one (§12, I20).
- One deployable, no microservices. Business capabilities are Nest modules inside it.

**Stack:**

| Concern | Choice |
|---|---|
| Runtime | Node 24 LTS · Yarn 4 · NestJS 12 (ESM) · TypeScript 6.x |
| Persistence | PostgreSQL 18 · TypeORM 1.x |
| Validation | Zod 4 via `StandardSchemaValidationPipe` (subclassed as `ContractValidationPipe`, AD4) |
| API docs | `@nestjs/swagger` |
| Tests | Vitest 4 + supertest |

Versions and tooling: `development-workflow.md` (Local setup).

## 3. Layout and ownership

```
src/
  main.ts            bootstrap only
  app.module.ts      composition root
  config/            loadConfig(): env → Zod → frozen AppConfig
  errors/            AppError, ErrorKind, baseline error codes
  database/          TypeORM root config, CLI DataSource, migrations/, Postgres error facts
  http/              HttpContractModule (global pipe/filter/interceptor/CSRF guard), configureApp(),
                     validation translator, validation/ (the storable-text rule), OpenAPI helpers, error schemas,
                     auth/ (decorators, roles, ownership)
  modules/
    services/        services.module.ts · .controller.ts · .service.ts · service-offering.entity.ts · dto/   (first slice)
    users/           users, auth_identities, sessions · auth + admin controllers · AccessGuard · google/ gateway (§17) ·
                     exports UserProfilesReader (its first export, AD14)
    content/         content_posts · public + authoring post controllers · body/ (TipTap v1 schema, limits, content rules)
    courses/         courses, course_sections, course_lessons, course_access_grants, lesson_progress · public catalog, admin curriculum,
                     admin access and learner controllers · courses / course-access / learning services ·
                     course lock rule L1 (AD15) · grant upsert (AD16) · imports UsersModule for UserProfilesReader
test/                e2e specs, test-only fixture controller, test support (development-workflow.md: Testing)
```

| Folder | Owns | Must not become |
|---|---|---|
| `modules/<capability>/` | Its Nest module, controllers, services/providers, entities/tables, request schemas and response DTOs, business error definitions, earned query helpers | A place that reaches into another module |
| `config/` | Reading and validating environment; the typed `AppConfig` | A home for business settings logic |
| `errors/` | Application error vocabulary | Aware of HTTP or the database |
| `database/` | Database infrastructure: connection, CLI DataSource, migrations, conventions, Postgres helpers | An owner of business entities |
| `http/` | The HTTP boundary: validation, errors → contract, success envelope, OpenAPI helpers, bootstrap helpers | A generic shared folder |
| `main.ts`, `app.module.ts` | Bootstrap and composition | A place for business logic |

**Rules:** D1 (module per capability; folders on demand; no `common/`, `shared/` or `utils/`); C4 (internal layering only for one genuinely rich module, never for symmetry).

**Why not a flat root:** cross-cutting files pile up beside domains until someone creates `common/`.

**Why not layers in every module:** four folders for five lines of logic. It presupposes ports and a domain/ORM split we don't need (§6).

**Why `modules/`:** "business" is a visible folder, so the dependency rule (§4) can be stated, and linted, as a folder rule.

## 4. Allowed dependencies

This is an allow-list: anything not listed is forbidden (I2).

| Folder | May import | Never imports |
|---|---|---|
| `config/` | Libraries only | `errors/`, `database/`, `http/`, `modules/` |
| `errors/` | Libraries only | `config/`, `database/`, `http/`, `modules/` |
| `database/` | `config/` | `errors/`, `http/`, `modules/` |
| `http/` | `config/`, `errors/` | **`database/`**, `modules/` |
| `modules/<x>/` | `config/`, `errors/`, `database/`, `http/`, as its responsibilities need. Another business module only through that module's exported providers (by importing its Nest module) | Another module's repositories, private providers or entity internals |
| `app.module.ts`, `main.ts` | Whatever composition needs | — |

**Why `http/` never imports `database/`:** the HTTP layer must not learn business meaning from raw database errors (I15). Meaning is assigned by the module that owns the data (§9), so the HTTP layer only ever sees `AppError`.

**Why modules talk only through exported providers:** the old backend let controllers import other domains' models. Here, a module's tables are private. Its exported service is its public API.

**V1 modules don't import each other's entities.** ORM relation metadata across modules is deferred to its first real case (C12, §15).

Enforcement: lint once the tool is settled (a verification spike), and review until then.

## 5. Module anatomy

A business module contains only the files it needs. Here's the first slice, the public Services catalog:

```
modules/services/
  services.module.ts         imports TypeOrmModule.forFeature([ServiceOffering]) (I1); exports only what others may use
  services.controller.ts     HTTP: routes, validated params, call the service, map to response DTOs, docs decorators
  services.service.ts        ServicesCatalogService: the catalog use cases, through Repository<ServiceOffering>
  service-offering.entity.ts ServiceOffering: the `services` table, as TypeORM sees it
  services.errors.ts         the module's error definitions (created when the first one exists, D10)
  dto/
    service.dto.ts           response DTO class + trivial mapping function
    <request>.dto.ts         a Zod request schema + inferred type, when the slice has validated input (e.g. a path param)
```

**Naming in this slice.** The business vocabulary (route, module, table, `ServiceDto`) is "services". The implementation classes are named `ServiceOffering` (entity) and `ServicesCatalogService` (Nest provider), so the business word "service" never collides with a Nest *service* (a provider) while reading code.

| Part | Responsibility | Doesn't |
|---|---|---|
| Controller | HTTP: input already validated by the pipe; calls the service; maps the result to the response DTO; declares the status and docs (D2, D4, D5) | Inject repositories or `DataSource` (I3); contain business rules |
| Service | Use-case logic; persistence; translating database facts into `AppError` (D3, D11) | Return HTTP DTOs (D5); throw `HttpException` (I14) |
| Entity | Persistence model of one owned table | Reach the wire (I10) |
| Request schema | Parse and validate untrusted input | Describe responses |
| Response DTO | The public HTTP shape, and its OpenAPI documentation | Mirror the table by reflex |

Admin endpoints for a capability live in the same module, e.g. `admin-courses.controller.ts` beside `courses.controller.ts`. One capability has one owner of its tables, with two route surfaces. That's the backend twin of xuan-web's "admin inside the domain".

## 6. Persistence access

```
Controller ──► Service ──► Repository<Entity> (TypeORM) ──► PostgreSQL
                  ▲ @InjectRepository(Entity)       owning module: TypeOrmModule.forFeature([Entity])
```

TypeORM's `Repository<Entity>` already *is* the repository pattern. Wrapping it adds a layer, not a pattern.

**Default** (D3): services inject it directly.

**Ownership** (I1): only the owning module registers the entity. Nest doesn't stop another module from calling `forFeature` on someone else's entity, so this rule does.

**Controllers** (I3): never touch persistence.

**Transactions:** `DataSource` exists in services only to open them. Inside, only the transaction's manager is used (I8; mechanics in `database.md`).

**When to add a layer:**

| Move | Signal |
|---|---|
| A module-specific query class (C1) | The same non-trivial query is reused; QueryBuilder code obscures the use case; persistence logic becomes substantial; a query deserves its own real-database test. Courses is a likely first candidate, but it's not pre-decided |
| Repository ports / separate domain model (C4) | A genuine second persistence implementation, or genuinely rich domain logic |
| Integration gateway (C5) | An external provider exists. **Not** a reason for repository ports: gateways and persistence are different concepts |

**Why not a wrapper class from day one:**
- Most methods become pass-throughs.
- Transactions get harder: the wrapper must accept a manager, or its calls silently escape the transaction.

## 7. Request lifecycle

```
request
  │ helmet · CORS ─► JSON parser (JSON only, size limit; over-limit → 413) ─► cookie-parser ─► CsrfGuard ─► AccessGuard (§17)
  ▼
APP_PIPE   ContractValidationPipe + Zod ── invalid ──► AppError(validation) ────────────────────┐
  ▼                                                                                             │
Controller ─► Service ─► Repository<Entity> ─► PostgreSQL                                       │
  │              ├─ expected conflict → ON CONFLICT result (C6)                                 │
  │              └─ database fact → AppError (D11)  ────────────────────────────────────────────┤
  ▼                                                                                             ▼
payload DTO, or void + @HttpCode(204)                                   APP_FILTER: AppError · HttpException · unknown
  ▼                                                                                             ▼
APP_INTERCEPTOR → { data }  (204: empty body)                                          error envelope
```

## 8. Validation and serialization

These are **two different problems**, solved separately on purpose.

| | Requests | Responses |
|---|---|---|
| Problem | Untrusted input must be parsed and rejected or shaped | Trusted data must leave in exactly the contract shape, and nothing more |
| Tool | Zod 4 schema via Nest's first-party `StandardSchemaValidationPipe` (D7; registered as `ContractValidationPipe`, AD4) | Response DTO class + explicit mapping (I10, D5) |
| Unknown fields | Rejected (`z.strictObject`, D8); stripping only with a reason (C7) | Can't exist: the mapping builds the object field by field |
| Docs | From the schema, named with `.meta({ id })` (D17) | From the DTO class, with hand-written `@ApiProperty` (D17) |

**Why Zod for requests:**
- One runtime schema gives both validation and the inferred type.
- Explicit coercion (`z.coerce`, `z.stringbool`) and simple nesting.
- Issue paths are already arrays, so dot paths are straightforward.
- No dormant `class-transformer` underneath, and no silent nested-validation trap.
- It's Nest's own first-party pipe, so no `nestjs-zod`.

**Why explicit mapping for responses:**
- **Returning an entity ships every future column** (a password hash, a token) automatically. It also turns a column rename into an API break.
- `@Exclude` blacklists leak the one field someone forgot.
- An explicit mapping is a **whitelist by construction**: only listed fields exist, and TypeScript complains if a DTO field isn't supplied.

**Who maps:** the controller (D5). Services may later be called by other modules, which must not receive HTTP shapes. Trivial mappers sit next to their DTO; a dedicated mapper is earned (C2).

**Two representations on purpose.** Request schema and response DTO repeat field names because they change for different reasons. That's clear responsibility, not accidental duplication.

## 9. Error model

An error crosses up to three boundaries. Each one translates **once**, and only the layer that knows the meaning assigns it:

```
① database / TypeORM            ② application                       ③ HTTP contract
QueryFailedError                 AppError                            { data: null, error: { code, message, details } }
 SQLSTATE 23505, constraint  ──►  code + kind + message        ──►    status from kind
 knows WHAT failed                knows what it MEANS                 knows how to SAY it
 database/ helpers                owning module                       http/ filter
```

### `AppError`

`AppError { code, kind, message, details? }` lives in `src/errors/`.

**Why `kind` instead of a status number:** services state semantics (`conflict`, `not_found`) without knowing HTTP. The filter maps `kind` → status (`api-contract.md`: Error envelope).

**Why not `HttpException` in services (I14):**
- Other modules and future jobs would receive HTTP objects.
- The HTTP layer would leak into business code.

### Codes

- Baseline codes live with `AppError`.
- Domain codes are owned by their module (D10). Each module declares its error definitions in one place.
- The **same definitions** are thrown at runtime and listed in OpenAPI (I18), so documentation can't drift from behavior.

### Database errors

| Situation | Handling |
|---|---|
| A conflict that is an *expected* outcome | Make it a normal result: `INSERT … ON CONFLICT` with a named target (C6, D32) |
| A database error with business meaning | The owning service asks `database/` a factual question ("unique violation on `uq_x_y`?") and throws `AppError` (D11) |
| An untranslated constraint violation | **500 + error log**, never a guessed 409 (I15). The constraint did its job, but the code didn't anticipate it. That's a bug, and a loud one is easiest to fix |

### The global filter

`APP_FILTER` catches everything:

| Error | Response |
|---|---|
| `AppError` | Status from `kind`; its code, user-safe message and details |
| Framework `HttpException` | Known statuses → baseline codes with **our** message, never the framework's text (I13). Malformed JSON → `VALIDATION_FAILED` with `fields: []`; over-limit body → `PAYLOAD_TOO_LARGE`; unknown route → `NOT_FOUND` |
| Anything else | `500 INTERNAL_ERROR`, generic message (I16) |

### Validation translation

The pipe's exception factory (in `http/`) converts Zod issues into `details.fields[]`. The field-code table is in `api-contract.md` (Error envelope). Standard Schema only guarantees `{ message, path }`, so reading Zod's own issue codes requires vendor narrowing. The exact mechanism is a verification spike (§16).

### Logging

V1 uses Nest's built-in `Logger`, in the filter only:
- 5xx and unknown errors at error level, with context (D12).
- Expected 4xx are not error-level.
- Never sensitive request data (I17).

Structured logs and request IDs are deferred (§15).

## 10. Envelope and OpenAPI

### The success envelope

Applied by a global `APP_INTERCEPTOR` (I11):
- Controllers return the **payload DTO** (D4). The interceptor wraps it as `{ data }`.
- V1 never emits the optional `message`/`code` (D13).
- No-content endpoints declare `@HttpCode(204)` and return `void` (I12). A payload endpoint returning `undefined` is a bug (500), not a silent `{}`.
- Paginated payloads (`{ items, pageInfo }`) are wrapped like any other payload (D14).

**Why one global interceptor:** the envelope is a binding contract rule. A per-controller convention gets forgotten, and the global one also exists in e2e tests (§12).

### OpenAPI helpers (in `http/`, D15)

| Helper | Documents |
|---|---|
| `@ApiEnvelopeResponse(Dto, { status })` | `{ data: $ref Dto }`; `Dto` registered as a named component |
| `@ApiPaginatedEnvelopeResponse(Dto)` | `{ data: { items: [$ref Dto], pageInfo: $ref PageInfoDto } }`. Arrived with blog posts (2026-10-15) |
| `@ApiErrorResponses(...definitions)` | Each definition grouped by its `kind`'s status, with `error.code` narrowed to exactly those codes; always `500 INTERNAL_ERROR`; `400 VALIDATION_FAILED` on validated input |
| `@ApiNoContentResponse()` | 204 (Nest built-in) |
| `@ApiSchemaParameters('query' \| 'path', schema)` | One parameter per property of the Zod object schema given to `@Query({ schema })` / `@Param({ schema })` (path parameters always required). Needed because `@nestjs/swagger` registers a `.meta({ id })` schema as a component but doesn't expand it into operation parameters |

**Two sources, one document:** request schemas come from Zod, response DTOs from classes (D17). Neither is forced into the other's shape.

**Names are contract.** xuan-web aliases `components['schemas']['ServiceDto']`, so DTO class names, request component ids and error codes are public identifiers (I19).

### Drift guards

| Guard | Catches |
|---|---|
| Global interceptor + filter | An endpoint bypassing the envelopes |
| Shared runtime/docs error definitions (I18) | Missing or wrongly-statused codes |
| E2E exact-body assertions | Payload ≠ DTO, leaked fields, a 204 with a body |
| E2E "OpenAPI document builds" | Zod conversion failures, inlined request schemas, missing components |
| Review: decorator DTO = return type (D16) | The one link TypeScript can't check |
| xuan-web's committed `openapi.json` diff | Anything unexpected, seen from the consumer |

## 11. Configuration

```
.env (local only) ─► process.loadEnvFile() ─┐
real env vars (production) ─────────────────┴─► loadConfig(): read → Zod validate → normalize → freeze ─► AppConfig
                                                    used by: Nest (custom provider) · TypeORM CLI DataSource · tests
```

- **One path** (D18). TypeORM's migration CLI runs **outside Nest DI**, so `@nestjs/config`'s `ConfigService` can't serve it. A plain function serves the app, the CLI and the tests identically, and it's a small, honest lesson in Nest custom providers.
- **Only `src/config/` reads `process.env`** (I4), the same principle as xuan-web.
- **Fail fast before listening.** Errors name variables, never values (I5), because values may be secrets.
- **Environment differences** are expressed as validated values (`docs.enabled`, `cors.origins`), never scattered `NODE_ENV` checks (D19).
- **No `dotenv`:** Node's built-in `process.loadEnvFile()`.

**Variables (V1):**

| Variable | Notes |
|---|---|
| `NODE_ENV` | `development` \| `test` \| `production` |
| `PORT` | default 4000 |
| `DATABASE_URL` | |
| `CORS_ORIGINS` | comma-separated exact origins |
| `DOCS_ENABLED` | default false |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth client (secret) |
| `GOOGLE_CALLBACK_URL` | `https` in production |
| `AUTH_WEB_URL` | Web app origin to return to; must be one of `CORS_ORIGINS` |
| `AUTH_COOKIE_SECRET` | ≥ 32 chars; signs the OAuth state cookie (secret). Backend-specific: never reuse another app's auth secret |
| `AUTH_COOKIE_SECURE` | default true; must be true in production |
| `AUTH_SESSION_TTL_DAYS` | 1–90, default 14 |
| `AUTH_ADMIN_EMAILS` | comma-separated; initial admin bootstrap (§17) |

Files and secrets: `development-workflow.md` (Secrets).

## 12. HTTP bootstrap

```
main.ts          NestFactory.create(AppModule, { bodyParser: false })
                 → configureApp(app, config) → enableShutdownHooks() → listen(config.port)
configureApp()   helmet() · CORS · JSON parser (100kb) · parse-marker middleware · Swagger if config.docs.enabled
HttpContractModule   APP_PIPE · APP_FILTER · APP_INTERCEPTOR
```

**Why this split (D6):** e2e tests build the app from `AppModule` and never run `main.ts`. Global behavior registered imperatively in `main.ts` would be **missing in tests**, so tests would pass against an app with no validation or envelope.
- `APP_*` providers arrive with `AppModule`.
- `configureApp()` is called by both `main.ts` and the e2e app factory.

| Concern | Decision | Why |
|---|---|---|
| CORS (I20) | Exact configured origins, `credentials: true`, `Content-Type` + `X-Requested-With` allowed | xuan-web's apiClient sends `credentials: 'include'` on every request, and browsers reject credentialed responses without `Access-Control-Allow-Credentials`. Wildcards are never allowed |
| Body parsing (D21) | JSON only, conservative limit, over-limit → `413 PAYLOAD_TOO_LARGE` | A plain HTML form on any site can POST form-encoded data without a preflight. Not parsing it makes "JSON bodies" real (contract §1, §8) |
| Helmet, prefix (D22) | Defaults; no global prefix, no versioning | The API owns its subdomain; contract paths are `/services`, `/users/me` |
| Shutdown hooks (D22) | Enabled | TypeORM closes its pool on SIGTERM |
| Docs (D20) | `/docs` + `/docs-json` only when config enables them | Off by default; contract §6: non-production or protected |
| Rate limiting (D23) | Not in the first slice; **required on public writes before public launch** | A launch gate, not a learning-slice concern |
| Auth guard, cookies, CSRF header/Origin enforcement | `CsrfGuard` + global `AccessGuard`; `cookie-parser` with `AUTH_COOKIE_SECRET` (§17) | Default deny; cookie sessions need CSRF defense in depth (`api-contract.md` §8) |

## 13. Decisions log

Each entry ends with *revisit when*. The full reasoning and the rejected alternatives are in the frozen spec.

- **AD1. PostgreSQL + TypeORM 1.x.** The documented Nest-native path, stable while the owner learns Nest by hand, with mature references. Mongoose-like habits are countered by guardrails (`database.md`). *Revisit when* TypeORM blocks a needed capability, or a deliberate comparison (e.g. Drizzle 1.0 stable) is scheduled.
- **AD2. Services use `Repository<Entity>` directly; `forFeature` only in the owning module.** *Revisit when* a C1/C4 signal appears in a specific module.
- **AD3. Layout B:** `config/`, `errors/`, `database/`, `http/`, `modules/` with an allow-list. *Revisit when* never by default; a new platform folder needs a stated responsibility.
- **AD4. Zod requests via `StandardSchemaValidationPipe`; explicit response DTOs + mapping.** *Revisit when* Standard Schema support in Nest proves insufficient (a verification spike fails). *2026-10-15:* Nest's pipe strips prototype keys recursively **before** the schema runs, so deeply nested JSON overflowed the stack (500). `src/http/contract-validation.pipe.ts` subclasses it with an iterative `stripProtoKeys` (same rules); the rest of the pipe is unchanged.
- **AD5. `AppError` + `kind`; translation at the call site; untranslated database errors → 500.** *Revisit when* never by default.
- **AD6. Global success interceptor; OpenAPI helpers fed by runtime error definitions.** *Revisit when* the first non-JSON response (file/stream) needs an opt-out.
- **AD7. One `loadConfig()` path shared by app, CLI and tests.** *Revisit when* config grows enough that namespacing earns `@nestjs/config`.
- **AD8. Local Postgres in Docker Compose (`postgres:18`, port 5433).** *Revisit when* never for local work; production hosting is decided separately.
- **AD9. Bootstrap split: `APP_*` providers + `configureApp()`; JSON-only; CORS with credentials.** *Revisit when* a feature needs another content type, or the auth slice adds guards and CSRF enforcement.
- **AD10. Database conventions** (UUID v7, explicit names, timestamps, canonical identifiers; `database.md`). *Revisit when* C8 applies to a specific table.
- **AD11. Vitest + real Postgres `xuan_test`; no Testcontainers.** *Revisit when* CI isolation or parallel e2e needs it.
- **AD12. First slice: the public Services catalog** (`GET /services`, `GET /services/:slug`).
  - **Scope:** read-only, no auth, no payments, no admin CRUD, **no price** (money is an open product question). Initial records come from a reviewed seed mechanism defined in the implementation plan. Exact fields are settled in that plan, then recorded in `database.md` §12.
  - **What it teaches:** module → controller → service → `Repository<Service>` → entity → first migration → constraints → UUID v7 → explicit response DTO mapping → `{ data }` on real payloads → list + slug lookup → `NOT_FOUND` → OpenAPI → e2e on real Postgres → `psql`.
  - **Learned later:** body validation and write conflicts, with authenticated admin service management.
  - **Supersedes** the frozen spec's D12 (a `Subscribers` newsletter slice). Later product clarification showed newsletter subscription wasn't a confirmed capability, and a learning slice must be a real one. Newsletter ("Creator Notes") now *needs product confirmation* (`data-model.md`). If confirmed, it's introduced explicitly as a newsletter/email-subscription capability.
  - *Revisit when* never: the next slices build on it.
- **AD13. Auth: Google-only sign-in, opaque server-side sessions, one role column, default-deny guard, ownership policy in `http/auth/`.** Spec A1–A14. *Revisit when* a second identity provider, a non-browser API client (tokens), or a permission need beyond three roles appears.
- **AD14. First cross-module foreign key: FK metadata without ORM relations; one narrow exported reader.** `content_posts.author_id` → `users(id)` (`ON DELETE RESTRICT`) is declared with TypeORM's `@ForeignKey('User', { name, onDelete })`, an entity-name string: generated migrations keep the constraint (D31) while `content/` never imports the users entity (I2), and there is no relation property or join (C12 stays deferred for relations). Author display data comes from `UserProfilesReader.findPublicProfiles(ids)`, `UsersModule`'s first export (no email, no role). Post write routes parse JSON up to 512 kB through a path-scoped parser before the global 100 kB one (D21). Blog spec B7, B8, B15. *Revisit when* a cross-module query genuinely needs a join, or another module needs more than public profiles.
- **AD15. Curriculum writes lock the course row `FOR NO KEY UPDATE` first, in one transaction (lock rule L1).** Every admin operation that changes a course's curriculum or publication runs in one `dataSource.transaction` whose first statement locks that course's row with TypeORM lock mode `for_no_key_update`; after it, only the transaction's manager is used (I8). *Why:* the invariant "a published course has at least one published lesson" spans tables, so no constraint can hold it; one lock per course serializes the operations that can break it (course spec §10.6). *Why that lock mode:* `FOR NO KEY UPDATE` conflicts with itself but not with the `FOR KEY SHARE` Postgres takes for FK checks, so grant and progress inserts (outcomes 2–3) aren't blocked by an edit; the blog's `FOR UPDATE` would block them. *Revisit when* an operation needs to lock two courses.
- **AD16. Course access is one row per grant; a grant is one `ON CONFLICT` upsert on a partial unique index, outside the course lock.** `course_access_grants` holds every grant and revocation (course spec §5, OD-1); access ⇔ an active row. `uq_course_access_grants_user_id_course_id_active_admin` (`WHERE source = 'admin' AND revoked_at IS NULL`) makes a duplicate active admin grant impossible, and the grant is `INSERT … ON CONFLICT (user_id, course_id) WHERE <predicate> DO UPDATE SET updated_at = EXCLUDED.updated_at RETURNING *` (TypeORM `orUpdate` with `indexPredicate`, spike S8), so a repeat returns the same row and a grant racing a revoke ends in a serial order. A repeated grant is business-idempotent (same `id`, `granted_at`, DTO) but not a database no-op: it rewrites `updated_at`. Revoke is one `UPDATE`. *Why no L1 lock:* each is a single statement, and its FK check takes `KEY SHARE` on the course row, which the curriculum lock's `FOR NO KEY UPDATE` doesn't block (S9). *Revisit when* the orders slice adds purchase grants (`order_id`, a second partial unique) or a "remove all access" policy (OD-7).

## 14. Open product questions

These are shared with xuan-web. Agents ask instead of guessing.

- Money: currency, price units, formatting.
- Locale/i18n of API `message` texts.
- Concurrency on admin edits: last-write-wins vs optimistic concurrency. **Posts (2026-10-15): last write wins in V1**; a later precondition (e.g. `If-Match` on `updatedAt`) stays optional, so adding it isn't a contract break (blog spec B14).
- The domain questions (final catalog content, the service application/booking details, course format, content publishing workflow, newsletter): `data-model.md` §5.

## 15. Deferred architecture

| Deferred | Trigger |
|---|---|
| Content beyond V1 blog posts: media/images, cover/OG images, taxonomy, archive, scheduled publishing, slug redirects, deletion mechanism, previews (blog spec §9) | Each owner decision |
| Newsletter subscriptions ("Creator Notes") | Product confirmation |
| Service applications and appointments: persistence, statuses, slot availability and holds (no double acceptance), Google Calendar / Meet integration, applicant emails. Confirmed concepts in `data-model.md` §3.1 | Application/booking slice design |
| Rate limiting + `trust proxy` | **Before public launch** (D23) |
| ~~Pagination implementation~~ | **Done 2026-10-15** with blog posts: `pageQueryFields`, `PageInfoDto`, `toPageInfo` in `http/pagination/page.ts`; `@ApiPaginatedEnvelopeResponse` in `http/openapi/` |
| ~~First request-body validation~~ | **Done 2026-10-15** with blog posts (`SavePostDto` via `@Body({ schema })`) |
| Cross-module ORM **relation** metadata (C12) | Resolved for foreign keys by AD14 (FK metadata without relations); relation metadata itself stays deferred until a real need |
| Module-to-module details; cross-module transactions | First real consumer (orders/entitlements) |
| Query classes, dedicated mappers, local layering | C1, C2, C4 signals |
| Integration gateways (external providers) | The first external provider |
| Structured logging, request IDs | First deployment |
| Least-privilege database roles, CI, deployment | Deployment work |
| Success `message`/`code`; framework codes like 415 (C11) | First real need |
| Optimistic concurrency, soft delete, background jobs | A slice that needs them |
| TypeScript 7, Testcontainers, coverage thresholds | Ecosystem or pain signal |

## 16. Verification spikes

These are decided by running real code, not by debate. If one disproves an assumption, this document changes explicitly.

| Item | Proven by |
|---|---|
| Zod issue vendor narrowing in the pipe's exception factory; detecting `REQUIRED` | Translator unit tests + validation e2e. **Result (2026-10-14, Zod 4.6):** the pipe hands the factory Zod's runtime issues, so `code`, `origin`, `keys` are present and read defensively. A missing value is `invalid_type` with the message "…received undefined" and no `input` field, so `REQUIRED` is detected from the message. `unrecognized_keys` at the root has `path: []` |
| `.meta({ id })` gives named request components | "Document builds" e2e. **Result (2026-10-14, @nestjs/swagger 12.0.2):** yes. `@Body({ schema })` with a Zod schema carrying `.meta({ id: 'FixtureEchoDto' })` appears as the named component `FixtureEchoDto`, with no `standardSchemaConverter` fallback |
| How the interceptor detects `@HttpCode(204)` | "204 empty body" fixture e2e. **Result (2026-10-14):** `Reflector.get(HTTP_CODE_METADATA, handler)`, with the constant imported from `@nestjs/common/constants.js` (exported under ESM; value `__httpCode__`) |
| `@ApiErrorResponses` adds `VALIDATION_FAILED` automatically or explicitly | Choose while implementing. **Result (2026-10-14): explicitly.** Endpoints with input list `baselineErrors.VALIDATION_FAILED`; `500 INTERNAL_ERROR` is always added |
| Helmet CSP vs the Swagger UI | Open `/docs` locally. **Result (2026-10-14, helmet 8.3):** helmet's CSP is switched off only when `DOCS_ENABLED=true`; `/docs` then serves the Swagger UI page and its assets (200), and `/docs-json` returns OpenAPI 3.0.0. With docs disabled the default CSP stays on. Helmet and CORS are registered **before** the JSON parser, so body-parser error responses carry the CORS headers too |
| `process.loadEnvFile()` precedence vs real env vars | `loadConfig` unit test. **Result (2026-10-14, Node 24.21): a variable already set in the real environment wins;** the file never overrides it. `NODE_ENV=test` selects `.env.test`, otherwise `.env` |
| Lint tool can enforce I2 and I4 (oxlint, else ESLint + boundaries) | A deliberate violation fails lint. **Result (2026-10-14): oxlint is enough.** `.oxlintrc.json` uses `no-restricted-properties` (`process.env`, `globalThis.process`), `no-restricted-imports` paths (`process`, `node:process`) outside `src/config/`, and per-folder pattern overrides for I2 (each override repeats the `process` paths, because an override replaces the base options). Probes for `process.env`, `import { env } from 'node:process'`, a default `node:process` import, `globalThis.process.env` and a cross-layer import all failed lint; lint is green without them. Review still covers anything lint can't see |
| TypeORM CLI under ESM; entity glob in the CLI DataSource | First `migration:generate` (`database.md`). **Result (2026-10-14):** `typeorm-ts-node-esm -d src/database/data-source.ts` loads the TypeScript data source and `loadConfig()` directly (no build step); globs `src/modules/**/*.entity.ts` and `src/database/migrations/*.ts`. It generated `CreateServices`. `yarn migration:*` wrap it; `NODE_ENV=test` targets `xuan_test` |
| Generated migrations stable with `uuidv7()` and named constraints | Generate twice; the second is empty. **Result (2026-10-14, TypeORM 1.1):** stable. With `CreateServices1791710155502` applied, a second `migration:generate` reports "No changes in database schema" on both `xuan_dev` and `xuan_test`; `uuidv7()` defaults and `pk_`/`uq_`/`ck_` names declared in the entity round-trip unchanged |
| Any `ON CONFLICT` insert names its target (D32). TypeORM's `.orIgnore()` is target-less, so find the mechanism that names it, for the first slice that uses `ON CONFLICT` | Read the logged SQL. **Result (2026-10-14, TypeORM 1.1):** `.orUpdate(columns, 'uq_services_slug')` with a **string** target emits `ON CONFLICT ON CONSTRAINT "uq_services_slug" DO UPDATE SET …` (an array target would emit a column list). Used by `yarn seed:services` |
| Malformed JSON and over-limit bodies reach the filter as `VALIDATION_FAILED` / `PAYLOAD_TOO_LARGE` | Fixture e2e. **Result (2026-10-14, Nest 12):** the over-limit error reaches the filter raw (`status 413`, `entity.too.large`). Invalid JSON does **not**: `ExpressAdapter.mapException` rethrows every `SyntaxError` as `new BadRequestException(message)`, dropping `type`. `configureApp()` therefore adds an Express error middleware after the JSON parser that re-raises the parse failure as `InvalidJsonBodyError` (status 400, `type: 'entity.parse.failed'`), which Nest passes through unchanged |
| Cross-module FK metadata survives `migration:generate` (blog AD14) | **Partly proven (2026-10-15, TypeORM 1.1.2):** `@ForeignKey('User', { name: 'fk_content_posts_author_id', onDelete: 'RESTRICT' })` generates the named FK with `ON DELETE RESTRICT`, and the built metadata holds that FK with no relation, so `dropOldForeignKeys` keeps it. **Pending:** the empirical empty second generate after the owner-approved migration run |
| A path-scoped 512 kB JSON parser for post writes (blog B15) | **Result (2026-10-15):** `express.json({ limit: '512kb' })` mounted before `useBodyParser` parses 400 kB on `POST /admin/posts` and `PUT /admin/posts/:id`; 600 kB there and 200 kB on every other route still give 413; invalid JSON keeps its message. Also: a plain recursive Zod parse of a 20 000-level document throws `RangeError`, so the body schema runs an iterative limits pass in `z.preprocess` first (Zod skips the inner schema when it adds issues) |
| Deferrable position uniques (course spec S7): TypeORM emits `DEFERRABLE INITIALLY DEFERRED`, and a second generate stays empty | **Desk-checked (2026-10-18, TypeORM 1.1.2):** `PostgresQueryRunner` appends `DEFERRABLE …` when `@Unique(…, { deferrable })` is set; the schema builder matches uniques **by name only** and its constraint query doesn't read `condeferrable`, so a second generate is expected empty and a later deferrability change is invisible to generate. **Result (2026-10-19, TypeORM 1.1.2, PostgreSQL 18.6):** proven. The generated SQL has `UNIQUE ("course_id", "position") DEFERRABLE INITIALLY DEFERRED` and the same for lessons; on `xuan_test`, `pg_constraint` shows `condeferrable`/`condeferred` true, and a second `migration:generate` reports no changes. `test/courses-schema.e2e-spec.ts`: a duplicate position is accepted until `COMMIT`, then fails on the named constraint; a swap written as two plain updates commits. Fallback (offset-then-final) not needed |
| `FOR NO KEY UPDATE` course lock vs concurrent FK inserts (course spec S9) | **Desk-checked (2026-10-18):** TypeORM's `for_no_key_update` emits ` FOR NO KEY UPDATE`. PostgreSQL 18 `relcache.c` counts any non-partial, non-expression unique index as a key, deferrable or not, so lesson moves and reorders take `FOR UPDATE` on the moved lesson rows (outcome 3: progress saves wait behind a reorder; a wait, not a deadlock). **Result (2026-10-19, PostgreSQL 18.6):** proven by `test/courses-schema.e2e-spec.ts` with two connections and `lock_timeout = '2s'`: under `FOR NO KEY UPDATE` on the course row, a concurrent `course_sections` insert (FK `KEY SHARE`) succeeds; under `FOR UPDATE` it times out (`55P03`). A lesson **title** update leaves `FOR KEY SHARE` on that row available; a lesson **position** update blocks it (`55P03`): the deferrable unique counts as a key, as the desk check said. Races R1–R4 (`test/admin-courses.e2e-spec.ts`, 15 trials each) always end in a serial outcome; with the lock removed, R1–R3 fail **Outcome 3 (2026-10-19):** R7 (progress upsert ∥ a curriculum order moving that lesson, 15 trials) always completes with 204 and 200, never `40P01`; the row stays attached to the moved lesson. R7b (a completing save ∥ an older incomplete save) always keeps completion |
| Partial unique index and the grant upsert (course spec S8): `@Index({ unique, where })` generates and round-trips; `orUpdate(…, { indexPredicate })` emits `ON CONFLICT (cols) WHERE … DO UPDATE … RETURNING` | **Desk-checked (2026-10-19, TypeORM 1.1.2, read-only dry run against `xuan_dev`):** generate emits `CREATE UNIQUE INDEX … WHERE "source" = 'admin' AND "revoked_at" IS NULL` and a `down()` dropping it. `RdbmsSchemaBuilder.shouldDropIndices` compares name, uniqueness, type and columns but never `where`, so a second generate stays empty, and a later predicate change is invisible to it. The upsert emits `ON CONFLICT ( "user_id", "course_id" ) WHERE ( … ) DO UPDATE SET "updated_at" = EXCLUDED."updated_at" RETURNING *`; TypeORM can't emit the spec's `SET updated_at = <table>.updated_at`, so a repeat rewrites `updated_at` (accepted by the owner, 2026-10-19). The insert/re-read fallback isn't needed. **Result (2026-10-19, PostgreSQL 18.6, `xuan_test`):** after the owner-approved run, revert and re-run, a second `migration:generate` reports "No changes"; the recreated `\d+` is identical. Races R5 (grant ∥ grant: same id, one active row), R5b (grant ∥ revoke: a serial outcome) and R6 (grant ∥ slug change ∥ lesson publish: all complete, no `40P01`) are green in `test/admin-course-access.e2e-spec.ts` |

## 17. Authentication and authorization

Design and trade-offs: `docs/superpowers/specs/2026-10-14-user-auth-and-rbac-design.md` (A1–A14). Physical tables: `database.md` §12. Contract: `api-contract.md` §7, §8, §11.

```
Browser ─GET /auth/google?returnTo─► API: signed xc_oauth cookie {state, nonce, PKCE verifier, returnTo, exp}
        ◄──302 to Google──────────── (scope openid email profile, S256 challenge, nonce)
Google ─302 /auth/google/callback?code&state─► API: verify cookie + state → exchange code (PKCE) → verify ID token
                                                  (signature, aud, iss, exp, nonce, email_verified)
                                               → UsersService.signInWithGoogle (one transaction)
                                               → revoke presented session → new session → xc_session cookie
        ◄──302 AUTH_WEB_URL + returnTo (or /login?authError=CODE)
Browser ─GET /auth/me (credentials)──► AccessGuard: xc_session → SHA-256 → sessions ⋈ users → request.user
```

| Piece | Where | Rule |
|---|---|---|
| Google | `modules/users/google/` gateway (C5) | Only identity leaves it; Google tokens are discarded. E2E uses a fake |
| Sessions | `modules/users/sessions.service.ts` | Opaque 256-bit token in `xc_session` (HttpOnly, SameSite=Lax, host-only, `Secure` per config); only its SHA-256 is stored; absolute TTL; logout deletes the row |
| Default deny | `AccessGuard` (`APP_GUARD`, users module) | Every route needs a session unless `@Public()` (401 `UNAUTHENTICATED`); `@Roles(...)` → 403 `FORBIDDEN`. The role is read from `users` per request, so demotions apply at once |
| CSRF | `CsrfGuard` (`APP_GUARD`, `http/auth/`), runs first | POST/PUT/PATCH/DELETE need `X-Requested-With: XMLHttpRequest`; an `Origin` header must be allowlisted |
| Decorators | `http/auth/` | `@Public()`, `@Roles(...)`, `@CurrentUser()`; any module may import them (§4) |
| Ownership | `http/auth/ownership.ts` | `assertCanManageOwnedResource(actor, ownerId)`: admin any, editor own, user none. Services call it after loading the record |
| Roles | `users.role` | `user` \| `editor` \| `admin`, one per user; explicit lists at each route |
| Admin bootstrap | `AUTH_ADMIN_EMAILS` | A verified listed email becomes `admin` at sign-in; removal never demotes |
| Editor management | `admin-users.controller.ts` | Only `user ↔ editor`; an admin target is `409 ADMIN_ROLE_LOCKED` |
| Redirect routes | `@RawResponse()` (`http/`) | The OAuth routes write their own 302s; the success interceptor leaves them alone (AD6 opt-out) |

**Future providers (Facebook):** widen `ck_auth_identities_provider`, add a gateway and two routes. A new identity whose email belongs to another account is refused (`ACCOUNT_CONFLICT`), as for Google; linking is an explicit action by a signed-in user, never an email match.

**References to `users.id`:** `content_posts.author_id` (**implemented**: FK `fk_content_posts_author_id`, ownership via the policy above, AD14); `course_access_grants.user_id`, `.granted_by_user_id`, `.revoked_by_user_id` (**implemented**: FKs `fk_course_access_grants_*_user_id`, by entity name, AD14/AD16), `lesson_progress.user_id` (**decided**: FK `fk_lesson_progress_user_id`, by entity name, AD14); future: `service_applications.user_id` (nullable: guests apply; the application snapshots the submitted name/email for history while `users` stays the live profile used for prefill), appointments through their application, `orders.user_id`.
