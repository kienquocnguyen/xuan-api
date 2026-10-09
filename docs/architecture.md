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
| Guard | Authorization (arrives with auth) |

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
| Auth is cross-cutting | Manual role checks everywhere → guards (auth slice) |
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
| Validation | Zod 4 via `StandardSchemaValidationPipe` |
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
  http/              HttpContractModule (global pipe/filter/interceptor), configureApp(),
                     validation translator, OpenAPI helpers, error schemas
  modules/
    services/        services.module.ts · .controller.ts · .service.ts · service-offering.entity.ts · dto/   (first slice)
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
  │ JSON parser (JSON only, size limit; over-limit → 413) ─► helmet · CORS ─► [guards: auth slice]
  ▼
APP_PIPE   StandardSchemaValidationPipe + Zod ── invalid ──► AppError(validation) ──────────────┐
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
| Tool | Zod 4 schema via Nest's first-party `StandardSchemaValidationPipe` (D7) | Response DTO class + explicit mapping (I10, D5) |
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
| `@ApiPaginatedEnvelopeResponse(Dto)` | `{ data: { items: [$ref Dto], pageInfo: $ref PageInfoDto } }`. Arrives with courses |
| `@ApiErrorResponses(...definitions)` | Each definition grouped by its `kind`'s status, with `error.code` narrowed to exactly those codes; always `500 INTERNAL_ERROR`; `400 VALIDATION_FAILED` on validated input |
| `@ApiNoContentResponse()` | 204 (Nest built-in) |

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

Files and secrets: `development-workflow.md` (Secrets).

## 12. HTTP bootstrap

```
main.ts          NestFactory.create(AppModule, { bodyParser: false })
                 → configureApp(app, config) → enableShutdownHooks() → listen(config.port)
configureApp()   JSON parser (conservative limit) · helmet() · CORS · Swagger if config.docs.enabled
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
| Auth guard, cookies, CSRF header/Origin enforcement | Deferred to the auth slice (§15) | — |

## 13. Decisions log

Each entry ends with *revisit when*. The full reasoning and the rejected alternatives are in the frozen spec.

- **AD1. PostgreSQL + TypeORM 1.x.** The documented Nest-native path, stable while the owner learns Nest by hand, with mature references. Mongoose-like habits are countered by guardrails (`database.md`). *Revisit when* TypeORM blocks a needed capability, or a deliberate comparison (e.g. Drizzle 1.0 stable) is scheduled.
- **AD2. Services use `Repository<Entity>` directly; `forFeature` only in the owning module.** *Revisit when* a C1/C4 signal appears in a specific module.
- **AD3. Layout B:** `config/`, `errors/`, `database/`, `http/`, `modules/` with an allow-list. *Revisit when* never by default; a new platform folder needs a stated responsibility.
- **AD4. Zod requests via `StandardSchemaValidationPipe`; explicit response DTOs + mapping.** *Revisit when* Standard Schema support in Nest proves insufficient (a verification spike fails).
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

## 14. Open product questions

These are shared with xuan-web. Agents ask instead of guessing.

- Money: currency, price units, formatting.
- Locale/i18n of API `message` texts.
- Concurrency on admin edits: last-write-wins vs optimistic concurrency.
- The domain questions (which offers exist, booking workflow, course format, content publishing and editor publish permission, newsletter): `data-model.md` §5.

## 15. Deferred architecture

| Deferred | Trigger |
|---|---|
| Auth: global guard + `@Public()`, users, **role persistence** (one or many roles; column or tables), cookies, refresh lifecycle, CSRF header and Origin enforcement. It must support both **role-based** and **resource-ownership** authorization; the conceptual requirements (admin / editor / customer, author ownership of content) are in `data-model.md` §4 | Auth slice design |
| Content: post types, rich text, media, draft/publish state, publishing workflow, editor publish permission (open) | Content slice (after auth) |
| Newsletter subscriptions ("Creator Notes") | Product confirmation |
| Rate limiting + `trust proxy` | **Before public launch** (D23) |
| Pagination implementation (`PageQueryDto`, `PageInfoDto`, paginated decorator) | The first list that needs it (the services list's pagination is settled in its plan) |
| First request-body validation and first conflict → `AppError` (409) | Admin service management (auth slice) or courses |
| Cross-module ORM relation metadata (C12) | First real database relation between modules |
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
| Zod issue vendor narrowing in the pipe's exception factory; detecting `REQUIRED` | Translator unit tests + validation e2e |
| `.meta({ id })` gives named request components | "Document builds" e2e |
| How the interceptor detects `@HttpCode(204)` | "204 empty body" fixture e2e |
| `@ApiErrorResponses` adds `VALIDATION_FAILED` automatically or explicitly | Choose while implementing |
| Helmet CSP vs the Swagger UI | Open `/docs` locally |
| `process.loadEnvFile()` precedence vs real env vars | `loadConfig` unit test |
| Lint tool can enforce I2 and I4 (oxlint, else ESLint + boundaries) | A deliberate violation fails lint |
| TypeORM CLI under ESM; entity glob in the CLI DataSource | First `migration:generate` (`database.md`) |
| Generated migrations stable with `uuidv7()` and named constraints | Generate twice; the second is empty |
| Any `ON CONFLICT` insert names its target (D32). TypeORM's `.orIgnore()` is target-less, so find the mechanism that names it, for the first slice that uses `ON CONFLICT` | Read the logged SQL |
| Malformed JSON and over-limit bodies reach the filter as `VALIDATION_FAILED` / `PAYLOAD_TOO_LARGE` | Fixture e2e |
