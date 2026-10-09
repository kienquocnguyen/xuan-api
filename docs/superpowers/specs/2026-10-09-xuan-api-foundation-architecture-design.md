# xuan-api foundation architecture: design record

| | |
|---|---|
| **Date** | 2026-10-07 → 2026-10-09 |
| **Status** | **FINAL, APPROVED** (2026-10-09). Decisions are reopened only if real implementation evidence disproves an assumption. §15 items are verification tasks, not brainstorming topics |
| **Process** | `superpowers:brainstorming`, architectural path |
| **Scope** | The decisions needed to start the foundation and the first vertical slice (Subscribers) safely |
| **Nature** | **Frozen record.** Once the source-of-truth docs exist (§13), they are the living truth. This file is never updated to track them. If implementation proves an assumption false, the change is made in the docs and noted there. |

---

## 1. Purpose and destination

This brainstorm had one job: finish the architecture decisions needed to start implementing safely. It is not a full system design.

```
approved spec (this file)
  → source-of-truth docs (CLAUDE.md + docs/*.md)
  → project skills (superpowers:writing-skills)
  → learning-first implementation plan (superpowers:writing-plans)
  → manual implementation by the owner, task by task
```

**Success** means the owner can start the foundation tasks without reopening any architecture question.

The only open items are the verification spikes in §15. Those are settled by running real code, not by more debate.

## 2. Context and constraints

| Item | Fact |
|---|---|
| Repository | `xuan-api`. Empty at the time of writing, deliberately |
| Consumer | `../xuan-web` (Next.js). Separate repo, separate deployment |
| Binding wire contract | `xuan-web/docs/api-contract.md`. **Binding now:** success envelope, 204 behavior, pagination, error envelope, validation error shape (`details.fields[]` with dot paths), stable `UPPER_SNAKE_CASE` codes, how OpenAPI represents all of these. **Open until the auth design:** auth endpoints, cookie attributes, refresh lifecycle, CSRF strategy, Origin/header enforcement |
| Old backend | `../vn-englishclub-backend-master` (Express + Mongoose). A learning bridge only. **Never migrated or copied** |
| References (used critically, never as templates) | NestJS official docs (the framework truth); MadurangaDev (a bridge for Controller → Service → Repository), oNo500 (progressive philosophy), brocoders (practical production reference); Vendure later, for reading large-scale production code, never as a template |
| Owner | Frontend-first developer relearning backend. Implements the early backend **by hand** (§12) |
| Learning material | `docs/backend-mental-model.md`. Local-only (`.git/info/exclude`), **not project law** |

### What carries over from the old backend, and what doesn't

| Keep (as concepts) | Don't carry over |
|---|---|
| Organize by business domain | Globals and hidden dependencies |
| Controller → service → persistence direction | Controllers importing other domains' models |
| Validate input before business logic | Validation inside controllers |
| Auth as a cross-cutting concern | Manual auth and role checks everywhere |
| No giant root-level controller/service/model folders | Ad hoc status codes; integrity checked only in the application; schema changes without migrations; module = collection |

## 3. Principles

**"Senior" doesn't mean more layers.** For this project it means:
- clear responsibilities and explicit dependencies;
- Nest lifecycle primitives used for their own concerns;
- deliberate module boundaries;
- thin HTTP controllers and services that own use cases;
- intentional persistence access;
- database constraints enforcing invariants;
- reviewed, reproducible migrations;
- deliberate transactions;
- consistent errors;
- OpenAPI that matches runtime behavior;
- tests that prove meaningful behavior;
- every layer explainable.

| Principle | Consequence |
|---|---|
| **Progressive architecture** | Idiomatic Nest CRUD (module / controller / service / DTO / entity) is the default. Every extra layer must answer a concrete problem |
| Not adopted by default | presentation/application/domain/infrastructure folders, ports/adapters, repository interfaces, domain entities separate from persistence entities, mappers-for-cleanliness, aggregates, domain events, CQRS, code generators |
| Shared code | Only from the second real consumer, and only with a clear owner. **No generic `common/`, `shared/`, `utils/`** |
| Explicit over magical | Boring over clever; few globals; no wrapper without a responsibility |

## 4. Stack (versions at decision time)

| Concern | Choice | Notes |
|---|---|---|
| Runtime | **Node 24 LTS** | The owner has 22.13 and upgrades via NVM for Windows |
| Package manager | **Yarn 4** via Corepack, `nodeLinker: node-modules` | Same as xuan-web |
| Framework | **NestJS 12** | The official starter is ESM (`"type": "module"`, `nodenext`), Vitest 4, oxlint, TS ^6 |
| Language | **TypeScript 6.x, pinned** | Not TS 7 until Nest and `@nestjs/swagger` officially support it (Swagger 12's peer range: `^5.5 \|\| ^6.0`). Tooling decision, not a principle |
| Database | **PostgreSQL 18** | `uuidv7()` is native |
| ORM | **TypeORM 1.x** (1.1.x) + `@nestjs/typeorm` 12 | §5 D1 |
| Request validation | **Zod 4** + Nest's first-party `StandardSchemaValidationPipe` | §5 D4 |
| API docs | `@nestjs/swagger` 12 | §5 D6 |
| Tests | **Vitest 4** + supertest + real PostgreSQL | §5 D11 |
| Style | REST, modular monolith, no microservices, no CQRS | |

---

## 5. Decisions

Each entry gives the decision, the reason, the alternatives rejected and the rules it creates. Rule classes are listed in §8.

### D1. ORM: PostgreSQL + TypeORM 1.x

**Why.** It fits *this phase*, not because it's universally better:
- the owner is learning NestJS from scratch;
- it's the documented, Nest-native persistence path;
- it's a stable foundation while the first slices are implemented by hand;
- it has mature Nest production references to study;
- PostgreSQL can still be learned deliberately, through the guardrails below.

**Alternatives compared:**

| Option | Outcome |
|---|---|
| Drizzle | Strongest SQL visibility. Rejected **only** because 1.0 was a release candidate (1.0.0-rc.5; stable 0.45.x) at decision time. Kept as a future comparison. Correction recorded: Nest does maintain an official `@nestjs/drizzle` (0.0.1, published 2026-09-23) |
| Prisma | Its DSL and generated client hide Postgres; frequent breaking majors |
| MikroORM | Unit-of-work plus identity map is a second large model on top of learning Nest |

**The known risk:** TypeORM's easiest path (`save()`, cascades, entity graphs) recreates Mongoose habits. Guardrails are therefore part of the decision:

| Guardrail |
|---|
| `synchronize` is never the schema-management strategy |
| Schema changes go through reviewed migrations, **inspected as SQL** |
| No `save(dto)` as a generic write shortcut |
| Entities are not response DTOs |
| No blind eager/lazy relations |
| Learn and inspect the SQL shape of non-trivial queries |
| Explicit database constraints for invariants |
| QueryBuilder or explicit queries where relational/query behavior deserves visibility |
| Transaction code uses the transaction-scoped manager/repository, never the normal injected repository |

### D2. Persistence access: service → `Repository<Entity>`

```
Controller ──► Service ──► Repository<Entity> (TypeORM) ──► PostgreSQL
                  ▲ @InjectRepository(Entity)
OwningModule: imports TypeOrmModule.forFeature([Entity])
```

| Rule | Class |
|---|---|
| Only the business module that owns an entity registers it with `TypeOrmModule.forFeature(...)`. Other modules never register or inject that repository. They import the owning module and call an explicitly exported service/provider | INVARIANT |
| Simple modules' services inject `Repository<Entity>` directly | DEFAULT |
| Controllers never inject repositories or `DataSource` | INVARIANT |
| `DataSource` opens explicit transaction boundaries. Inside `dataSource.transaction(async (manager) => …)`, every participating access uses `manager.getRepository(Entity)` | INVARIANT |
| A module-specific repository/query class is introduced only on a concrete signal: the same non-trivial query is reused; QueryBuilder/raw code obscures the use case; persistence logic becomes substantial; a complex query deserves its own real-DB test. Courses is **not** pre-decided | CONTEXT-DEPENDENT |
| No repository ports/interfaces in V1. They need a genuine second persistence implementation or rich domain logic. **External providers are not a reason:** those are separate integration gateways, if and when they exist | CONTEXT-DEPENDENT (default: none) |

Rejected: B (a wrapper class per module from the start: pass-throughs, and transactions become harder); C (ports + implementations + mappers: presupposes problems we don't have).

### D3. Project layout

```
src/
  main.ts            bootstrap only
  app.module.ts      composition root
  config/            validated configuration
  errors/            application error vocabulary            (added by D5)
  database/          database infrastructure
  http/              shared HTTP boundary behavior
  modules/
    subscribers/
      subscribers.module.ts
      subscribers.controller.ts
      subscribers.service.ts
      subscriber.entity.ts
      dto/
test/                e2e specs + support
```

**Ownership:**

| Folder | Owns | Never |
|---|---|---|
| `modules/<capability>/` | Its Nest module, controllers, services/providers, entities/tables, request schemas/response DTOs, business error definitions, earned query/persistence helpers | Another module's tables or internals |
| `config/` | Reading and validating env; the typed `AppConfig` | Business logic |
| `errors/` | `AppError`, `ErrorKind`, baseline codes | Importing `http/` or `database/` |
| `database/` | TypeORM root config, CLI DataSource, `migrations/`, database-wide conventions, Postgres-specific helpers (factual error questions) | Business entities |
| `http/` | Global validation, the exception → contract filter, the success envelope, OpenAPI helpers, bootstrap helpers (`configureApp`) | Becoming a generic shared folder; importing `database/` |
| `main.ts`, `app.module.ts` | Bootstrap and composition | Business logic |

**Allowed dependencies.** This is an explicit allow-list: anything not listed is forbidden. `architecture.md` and the lint boundaries derive from this table.

| Folder | May import | Never imports |
|---|---|---|
| `config/` | No application layer (only libraries) | `errors/`, `database/`, `http/`, `modules/` |
| `errors/` | No application layer (only libraries) | `config/`, `database/`, `http/`, `modules/` |
| `database/` | `config/` | `errors/`, `http/`, `modules/` |
| `http/` | `config/`, `errors/` | **`database/`**, `modules/` |
| `modules/<x>/` | `config/`, `errors/`, `database/`, `http/`, according to responsibility. Another business module **only through that module's explicitly exported public providers** (by importing its Nest module) | Another module's repositories, entities or other internals |
| `app.module.ts`, `main.ts` | Whatever composition and bootstrap require (platform and business modules) | — |

Consequences:
- Platform folders (`config/`, `errors/`, `database/`, `http/`) never import business modules.
- `http/` serializes `AppError` and framework errors without ever seeing database errors' meaning (D5).

**Rules:**
- No empty folders created in advance.
- No `presentation/ application/ domain/ infrastructure/` per module. One module with genuinely rich domain complexity may earn internal layering as a CONTEXT-DEPENDENT decision. Modules are not made symmetrical for consistency's sake.
- Business modules live under `src/modules/<capability>`, not directly under `src/`.
- The `http/` module class is **`HttpContractModule`** (never `HttpModule`, which would be confused with `@nestjs/axios`).

**Global behavior placement** (the e2e-parity reason: tests build `AppModule` and never run `main.ts`):

| What | Where |
|---|---|
| Validation pipe, exception filter, success interceptor | `APP_PIPE` / `APP_FILTER` / `APP_INTERCEPTOR` providers in `HttpContractModule`, so they exist wherever `AppModule` exists |
| JSON parser, Helmet, CORS, Swagger | `configureApp(app, config)` in `http/`, called by `main.ts` **and** the e2e app factory |
| Shutdown hooks, `listen` | `main.ts` only |

### D4. Request validation and response serialization

These are two problems, solved separately on purpose.

**Requests: Zod 4 + `StandardSchemaValidationPipe`** (first-party; **no `nestjs-zod`**)

| Reason |
|---|
| One runtime schema is the source of both validation and the inferred TypeScript type |
| Explicit unknown-field handling, simpler nested validation, explicit coercion (`z.coerce`, `z.stringbool`) |
| Issue paths are already arrays, so producing `details.fields[]` dot paths is straightforward |
| Lower cognitive load while learning Nest itself |

| Rule | Class |
|---|---|
| Body/query/param validation uses Zod 4 schemas through `StandardSchemaValidationPipe` where it supports the case cleanly | DEFAULT |
| Object inputs **reject** unknown fields (`z.strictObject`) | DEFAULT |
| Stripping unknown fields on a specific endpoint | CONTEXT-DEPENDENT (needs a stated reason) |
| Validation failures always become `400 VALIDATION_FAILED` + `details.fields[]` (dot paths, stable field codes). Translation in D5 | INVARIANT (contract) |

Rejected: `ValidationPipe` + class-validator/class-transformer. It is Nest's classic default, but `class-transformer` has been dormant since 2021, there's a silent nested-validation trap (`@ValidateNested` without `@Type`), and implicit conversion is risky.

**Responses: explicit response DTO classes + explicit mapping (R4)**

```
Service ─► entity / service result ─► Controller ─► mapper ─► Response DTO ─► envelope (D6) ─► client
```

| Rule | Class |
|---|---|
| TypeORM entities are never returned as API responses | INVARIANT |
| No entity-level `@Exclude` blacklists; `class-transformer` is not the response-safety mechanism | INVARIANT |
| The response DTO is the public HTTP contract; the entity is the persistence model. Field names may duplicate on purpose: they have different reasons to change | (rationale) |
| The controller invokes the mapping (it owns the HTTP boundary). Services don't return HTTP response DTOs just to suit controllers | DEFAULT |
| Trivial mapping functions live next to the response DTO | DEFAULT |
| A dedicated mapper when mapping becomes substantial, reused, nested, or hurts controller readability | CONTEXT-DEPENDENT |

**Request schemas and response DTO classes are intentionally two representations.** The request schema parses and validates untrusted input at runtime. The response DTO defines and documents what the API is allowed to expose. We optimize for clear responsibility, not symmetry.

Rejected for responses: returning entities (leaks every future column); `ClassSerializerInterceptor` + `@Exclude` (a blacklist: one forgotten decorator leaks); `plainToInstance` + `@Expose` (whitelist, but magic on a dormant library).

### D5. Errors

**Three layers, each translating once:**

```
① database / TypeORM            ② application                       ③ HTTP contract
QueryFailedError                 AppError                            { data: null, error: { code, message, details } }
 driverError.code 23505    ──►    code 'SOME_BUSINESS_CODE'     ──►    status from kind
 constraint uq_x_y               kind 'conflict'
 knows WHAT failed                knows what it MEANS                 knows how to SAY it
 (database/ helpers)              (owning module)                     (http/ filter)
```

**Application error (O2):** `AppError { code, kind, message, details? }`

| `kind` | Status | Baseline code(s) |
|---|---|---|
| `validation` | 400 | `VALIDATION_FAILED` |
| `unauthenticated` | 401 | `UNAUTHENTICATED` |
| `forbidden` | 403 | `FORBIDDEN` |
| `not_found` | 404 | `NOT_FOUND` |
| `conflict` | 409 | domain-specific |
| `rate_limited` | 429 | `RATE_LIMITED` |
| *(unknown)* | 500 | `INTERNAL_ERROR` |

| Rule | Class |
|---|---|
| Services/application code never throw Nest `HttpException` classes for business failures; they throw `AppError` | INVARIANT |
| Each business module owns its domain-specific stable codes/factories (e.g. `<module>.errors.ts`). Baseline codes live with `AppError` in `src/errors/` | DEFAULT |
| **E2 (default):** `database/` helpers answer factual questions ("is this a unique violation on constraint X?"); the owning service assigns meaning and throws `AppError` | DEFAULT |
| **E3:** when a conflict is an *expected* outcome and SQL expresses it clearly (`INSERT … ON CONFLICT`), make it a normal result instead of an exception. **Not** a rule that every unique conflict must use `ON CONFLICT` | CONTEXT-DEPENDENT |
| The HTTP layer never infers business meaning from raw Postgres constraint names | INVARIANT |
| An untranslated constraint violation (unique, foreign key, not-null, check) → **500 `INTERNAL_ERROR`** + server log. No generic 409 fallback: it's an application bug, not a guess | INVARIANT |
| The wire never carries stack traces, SQL, constraint names or internal identifiers | INVARIANT |

**The global filter** (`APP_FILTER` in `HttpContractModule`, `@Catch()` everything):

```
AppError            → status from kind; code / message / details as given            (expected → not error-logged)
Nest HttpException  → known statuses mapped to baseline codes; OUR message per code     (framework-thrown)
anything else       → 500 INTERNAL_ERROR, generic message                              (logged at error level)
```

- Malformed JSON → `400 VALIDATION_FAILED` with `details.fields: []` and a message saying the body isn't valid JSON.
- Rare framework statuses (413, 415) get a stable code added to the contract when first needed.

**Validation translation:** the pipe's `exceptionFactory` (in `http/`) turns Zod issues into `AppError(kind 'validation', 'VALIDATION_FAILED', { fields })`.

| Zod issue | Field code |
|---|---|
| `invalid_type`, value absent | `REQUIRED` |
| `invalid_type` (other) | `INVALID_TYPE` |
| `invalid_format` | `INVALID_FORMAT` |
| `too_small` / `too_big` | `TOO_SHORT` / `TOO_LONG` (strings), `TOO_SMALL` / `TOO_LARGE` (numbers) |
| `unrecognized_keys` | `UNKNOWN_FIELD`. Expanded to **one entry per key**, at `parent.key` |
| anything else | `INVALID` |

Paths: `['address','city']` → `address.city`, and `['items',0,'name']` → `items.0.name`. Standard Schema guarantees only `{ message, path }`, so reading Zod's codes needs vendor narrowing (verification item, §15).

**Logging (V1):** Nest's built-in `Logger`, in the filter.

| Outcome | Level | Content |
|---|---|---|
| 5xx / unknown | error | method, route, error name, message, stack; for DB errors, Postgres code + constraint |
| Expected 4xx | not error-level | — |
| Never, by default | — | request bodies, auth headers, cookies, passwords, other sensitive request data |

Structured logging and request IDs are later improvements.

Rejected: Nest `HttpException`s in services (O1); a class per error (O3, still available locally); result types (O4); a global constraint → code map in the filter (E1); per-module filters (E4).

### D6. Success envelope and OpenAPI

| Rule | Class |
|---|---|
| Controllers return the **payload DTO**, never an already-wrapped object | DEFAULT |
| A global `APP_INTERCEPTOR` applies `{ data }` to every successful payload response | INVARIANT (contract) |
| V1 success responses emit `{ data }` only. `message`/`code` stay optional contract fields, not introduced until a real use exists | DEFAULT |
| No-content endpoints declare `@HttpCode(204)` and return `void`; the body is empty | INVARIANT (contract) |
| Returning `undefined` from a non-204 payload endpoint is an application bug (→ 500 + log), never a silent `{}` | INVARIANT |
| Pagination: the controller returns `{ items, pageInfo }` as its payload, and the interceptor wraps it as usual (arrives with courses) | DEFAULT |

**OpenAPI helpers** (`http/`):

| Helper | Produces |
|---|---|
| `@ApiEnvelopeResponse(Dto, { status })` | `{ data: $ref Dto }` (+ optional `message`, `code`); `ApiExtraModels` makes `Dto` a named component |
| `@ApiPaginatedEnvelopeResponse(Dto)` | later: `{ data: { items: [$ref Dto], pageInfo: $ref PageInfoDto } }` |
| `@ApiErrorResponses(...definitions)` | One response per status from each definition's `kind`, referencing a named `ErrorEnvelope`, with `error.code` narrowed to an enum of exactly those codes. **Always adds `500 INTERNAL_ERROR`.** `400 VALIDATION_FAILED` (with `ValidationErrorDetails`) for endpoints with validated input |
| `@ApiNoContentResponse()` | Nest built-in, for 204 |

| Rule | Class |
|---|---|
| Endpoint error documentation is generated from **the same module-owned error definitions** used at runtime | INVARIANT |
| Every endpoint documents every error code it can return (contract §4) | INVARIANT (contract) |
| Auth/rate-limit errors are documented only once those concerns exist | DEFAULT |
| Response DTO class names are **public contract names**. Renaming one is a breaking change | INVARIANT (contract) |
| The controller's return type and the Swagger decorator's DTO name the same class (checked in review) | DEFAULT (review rule) |
| Request docs come from Zod (Standard Schema); response docs from explicit DTO classes. Both sides are not forced into one representation | DEFAULT |
| Response DTOs use hand-written `@ApiProperty` (no Swagger CLI plugin) | DEFAULT |
| `/docs` and `/docs-json` are enabled by validated config outside production; **production defaults to disabled** | DEFAULT |

**Naming:** response `<Thing>Dto` (`SubscriberDto`, `CourseListItemDto`, `PageInfoDto`); request body component `<Verb><Thing>Dto` via Zod `.meta({ id })`; schema variable `createXSchema`; inferred type `CreateXInput`.

**Drift guards:**

| Guard | Catches |
|---|---|
| Global interceptor + filter | An endpoint bypassing the envelopes |
| Shared runtime/docs error definitions | Codes documented under the wrong status, or missing |
| E2E exact-body assertions (`toEqual`) | Payload ≠ DTO, leaked fields, a 204 with a body |
| E2E "OpenAPI document builds" with the expected named components | Zod conversion failures, inlined request schemas, missing extra models |
| Review check: decorator DTO = return type | The one link TypeScript can't check |
| xuan-web's committed `openapi.json` diff | Anything unexpected, from the consumer's side |

### D7. Configuration (C2)

```
.env (local only) ─► process.loadEnvFile() ─┐
real env vars (prod) ───────────────────────┴─► loadConfig(): read → Zod validate → normalize → freeze ─► AppConfig
                                                    ▲ used by: Nest (custom provider) · TypeORM CLI DataSource · tests
```

| Rule | Class |
|---|---|
| One plain `loadConfig()` path in `src/config/`, shared by the Nest app, the migration CLI and tests | DEFAULT (architecture) |
| Only `src/config/` reads `process.env` (lint-enforced) | INVARIANT |
| Config is validated **before the app listens**; failure stops startup | INVARIANT |
| Validation errors name variables, never print values | INVARIANT |
| `.env` ignored; `.env.example` committed with fake values for every variable; no secrets committed | INVARIANT |
| Environment differences flow only through validated config values, not scattered `NODE_ENV` checks | DEFAULT |

Rejected: `@nestjs/config` (C1). It's fine and documented, but the TypeORM CLI runs outside DI, which would force a second loading path.

**V1 variables:**

| Variable | Notes |
|---|---|
| `NODE_ENV` | `development` \| `test` \| `production` |
| `PORT` | default 4000 (contract §1) |
| `DATABASE_URL` | one URL |
| `CORS_ORIGINS` | comma-separated exact origins |
| `DOCS_ENABLED` | `z.stringbool()`, default false |

No `dotenv`: Node's built-in `process.loadEnvFile()`, called in `config/` only.

### D8. Tooling and local PostgreSQL

| Item | Decision |
|---|---|
| Node / Yarn / Nest / TS | §4 |
| Module format / tsconfig base | As the Nest 12 starter generates (ESM, `nodenext`), plus `strict` |
| Lint | Must mechanically enforce two rules: `process.env` only in `config/`, and the D3 dependency direction. Try the starter's oxlint first (per-glob overrides + `no-restricted-imports`); otherwise ESLint + `typescript-eslint` + `eslint-plugin-boundaries` as in xuan-web (verification item) |
| Format | Prettier with xuan-web's settings |
| Local Postgres | **Docker Compose `postgres:18`, host port 5433.** The native PostgreSQL 12 on 5432 stays untouched |
| Databases / role | `xuan_dev`, `xuan_test`; login role `xuan_app` owning both; `postgres` superuser only for admin experiments. Separate migration and runtime roles: deferred to deployment |
| Desktop tools | VS Code, terminal, Docker Desktop, pgAdmin (optional GUI), Postman (manual exploration), SourceTree. **No new tools** without a stated need, purpose and required/optional status |

**Docker is the local server environment, not a replacement for learning PostgreSQL.**

| Docker hides | Docker does not hide |
|---|---|
| Install/upgrade, the Windows service, the data directory, OS config files | SQL, `psql`, roles, privileges, databases, schemas, constraints, indexes, `EXPLAIN`, transactions, locks, connection strings, migrations |

**The learning plan must include:**
- `psql` inside the container (`docker compose exec db psql -U xuan_app xuan_dev`);
- inspecting tables, constraints and indexes after migrations (`\d+`);
- reading generated migration SQL;
- practising run/revert;
- optionally pgAdmin on the same database.

**Scripts** (each added with its tool):

| Group | Scripts |
|---|---|
| App | `start:dev`, `build`, `start:prod` |
| Checks | `lint`, `typecheck`, `format`, `format:check` |
| Tests | `test`, `test:e2e` |
| Database | `db:up`, `db:down` |
| Migrations | `migration:generate`, `migration:create`, `migration:run`, `migration:revert`, `migration:show` |

### D9. HTTP bootstrap

```
main.ts          NestFactory.create(AppModule, { bodyParser: false })
                 → configureApp(app, config) → app.enableShutdownHooks() → app.listen(config.port)
configureApp()   JSON parser (conservative limit, default 100kb) · helmet() · CORS · Swagger if config.docs.enabled
```

| Rule | Class |
|---|---|
| CORS: exact configured origins, **`credentials: true`** (xuan-web's apiClient always sends `credentials: 'include'`, which browsers reject without it), allowed headers include `Content-Type` and `X-Requested-With` (contract §8). **Never a wildcard origin** | INVARIANT |
| JSON-only body parsing. Other parsers (multipart, raw webhook bodies) are introduced deliberately for the feature that needs them | DEFAULT |
| Helmet defaults. If CSP blocks the Swagger UI, relax it only when docs are enabled | DEFAULT |
| No global API prefix, no versioning in V1 (contract §1) | DEFAULT |
| `enableShutdownHooks()` so TypeORM closes its pool | DEFAULT |
| Rate limiting: not in the first learning slice; **required on public write endpoints before public production launch** (with correct `trust proxy`) | DEFAULT (launch gate) |
| Auth guard, cookies, CSRF header and Origin enforcement | Deferred to the auth slice |

### D10. Database conventions

| Rule | Class |
|---|---|
| snake_case, plural table names (`subscribers`); snake_case columns; entity properties camelCase | DEFAULT |
| Names declared explicitly in entities (`@Entity('subscribers')`, `@Column({ name: 'created_at' })`); no custom `NamingStrategy` in V1 | DEFAULT |
| Constraint and index names always explicit and stable: `pk_<table>`, `uq_<table>_<cols>`, `fk_<table>_<col>`, `ix_<table>_<cols>`, `ck_<table>_<rule>`. Module code may reference them (D5) | DEFAULT |
| API/business entities use database-generated **UUID v7** primary keys: `id uuid PRIMARY KEY DEFAULT uuidv7()` | DEFAULT |
| A different primary-key strategy with a concrete technical or domain reason | CONTEXT-DEPENDENT |
| Malformed UUID in a path param → `400 VALIDATION_FAILED` (field `id`, `INVALID_FORMAT`) | DEFAULT |
| Business records have `created_at timestamptz NOT NULL DEFAULT now()`; add `updated_at` (via `@UpdateDateColumn`) when the record changes over its lifecycle. Not forced onto immutable tables | DEFAULT |
| Real instants use `timestamptz`, never `timestamp` without a time zone; ISO 8601 UTC on the wire | DEFAULT |
| `varchar(n)` where a real maximum exists, `text` otherwise | DEFAULT |
| **When a business identifier is intentionally case-insensitive, define one canonical stored representation and enforce it at the database boundary.** Lowercasing is not generalized to every identifier | DEFAULT |
| Schema changes only through migrations, run by **explicit command** (local, test setup, deploy); never `synchronize`, never boot-time `migrationsRun` | INVARIANT |
| One logical change per migration; migrations merged or applied elsewhere are not casually rewritten (write a new one); SQL is reviewed | DEFAULT |
| A meaningful `down()` when the change is safely reversible | DEFAULT |
| An irreversible or data-destructive migration gets no misleading rollback; the migration/plan documents the recovery or roll-forward strategy | CONTEXT-DEPENDENT |
| Migrations live in `src/database/migrations/`; schema `public`; no extensions needed in V1 | DEFAULT |

**Learning practice on reversible migrations:** generate → inspect SQL → run → inspect the database → revert (→ run again).

### D11. Testing

| Rule | Class |
|---|---|
| Vitest 4 (starter default, same as xuan-web) + supertest | DEFAULT |
| E2E runs against a real PostgreSQL `xuan_test` database in the same Compose container; no Testcontainers in V1 | DEFAULT |
| Test env from `.env.test` (ignored) through the same `loadConfig()` with `NODE_ENV=test` | DEFAULT |
| Migrations applied once before the e2e suite (this also proves they apply cleanly) | DEFAULT |
| Deterministic cleanup (`TRUNCATE` application tables) between tests; e2e files run serially on the shared database | DEFAULT |
| **Destructive test cleanup refuses to run unless it can prove it is connected to the dedicated test database, including the `_test` database-name check** | INVARIANT |

**Levels:**

| Code | Level |
|---|---|
| Pure logic: Zod-issue translator, `loadConfig()` validation, future domain rules | Unit, table-driven |
| Platform behavior: envelope, 204 empty body, `undefined` → 500, `AppError` → envelope, unknown → generic 500 with no leaked text, malformed JSON | E2E against a **test-only fixture controller** in `test/` |
| Each endpoint outcome | E2E: real HTTP + real Postgres + exact body |
| OpenAPI document builds with the expected named components | E2E |
| Simple CRUD services with mocked repositories | **None.** A mock can't prove a constraint |

### D12. First slice: Subscribers

**Surface:** `POST /subscribers` with body `{ email }`. Public.
- No list/admin read (needs auth; inspect with `psql`/pgAdmin).
- No unsubscribe, consent or source fields (no emails are sent in V1).
- Stored in our database only; no external provider.

**Repeat signup (S2): the response is identical and reveals nothing.**

| Case | Response |
|---|---|
| New email | `204 No Content` |
| Already-subscribed email (after normalization) | `204 No Content` |

Conceptual SQL:

```sql
INSERT INTO subscribers (email) VALUES ($1)
ON CONFLICT ON CONSTRAINT uq_subscribers_email
DO NOTHING
```

The conflict is an expected, normal outcome (E3), and the API never reveals whether an email was already subscribed.
- The conflict target is **named on purpose**. A target-less `ON CONFLICT DO NOTHING` would silently absorb any future, unrelated unique constraint.
- The exact TypeORM mechanism that produces this SQL is a verification spike (§15).

| Layer | Definition |
|---|---|
| Request schema | `z.strictObject({ email })`: trim → lowercase → validate as email, max 254. Component id `CreateSubscriberDto` |
| Field codes | `REQUIRED`, `INVALID_FORMAT`, `TOO_LONG`, `UNKNOWN_FIELD` |
| Table | `subscribers`: `id uuid PRIMARY KEY DEFAULT uuidv7()`, `email varchar(254) NOT NULL`, `created_at timestamptz NOT NULL DEFAULT now()`. **No `updated_at` in V1:** the row is insert-only (no update path exists). Following D10, `updated_at` is added by its own migration when the first update path arrives (e.g. unsubscribe) |
| Constraints | `pk_subscribers`, `uq_subscribers_email`, `ck_subscribers_email_lowercase` (`CHECK (email = lower(email))`) |
| Documented errors | `400 VALIDATION_FAILED`, `500 INTERNAL_ERROR` |
| Contract | A new endpoint, published through OpenAPI; xuan-web consumes it through its snapshot flow |
| Rate limiting / bot protection | Not in this slice (launch gate, D9) |

**E2E outcomes:**

| Request | Expected |
|---|---|
| New email | 204, empty body, one normalized row |
| Same email, different case/whitespace | 204, still one row |
| Missing email | `REQUIRED` |
| Malformed email | `INVALID_FORMAT` |
| 255 characters | `TOO_LONG` |
| Extra field | `UNKNOWN_FIELD` |
| Form-encoded body | Rejected |

**Lessons this slice deliberately does not teach** (learned in courses instead, rather than distorting subscriber behavior): R4 response DTO mapping, and E2 DB-error → `AppError` conflict translation (a 409).

---

## 6. Request lifecycle

```
request
  │ JSON parser (JSON only) ─► helmet · CORS ─► [guards: auth slice]
  ▼
APP_PIPE  StandardSchemaValidationPipe (Zod)  ── fail ──► AppError(validation) ─┐
  ▼                                                                              │
Controller (HTTP only) ─► Service (use case) ─► Repository<Entity> ─► PostgreSQL │
  │                          │  tx: dataSource.transaction(m => m.getRepository(E))
  │                          └─ DB fact → AppError (E2) / ON CONFLICT result (E3) ┤
  ▼                                                                              │
returns payload DTO (mapped from entity) or void with @HttpCode(204)             │
  ▼                                                                              ▼
APP_INTERCEPTOR  { data } (204: empty body)                 APP_FILTER  AppError · HttpException · unknown(500 + log)
  ▼                                                                              ▼
response                                                                  error envelope
```

## 7. Contract ownership

| Artifact | Role |
|---|---|
| `xuan-api/docs/api-contract.md` + `xuan-web/docs/api-contract.md` | **Human contract policy.** Shared wire sections are mirrored identically and changed through coordinated, paired work. xuan-api adds a producer-obligations section |
| xuan-api's generated OpenAPI document (`/docs-json`) | **Authoritative executable contract** of the implemented API |
| `xuan-web/openapi/openapi.json` | **Consumer snapshot**, pulled from xuan-api and committed; frontend types derive from it |

- The two Markdown files are never competing runtime truths.
- **When runtime/OpenAPI and Markdown disagree, that's a contract defect**, resolved explicitly rather than by silently picking one.
- Auth sections are mirrored as "consumer expectation; producer design pending the auth slice".

## 8. Rule classes

Same model as xuan-web:

| Class | Meaning | Deviation |
|---|---|---|
| INVARIANT | Breaking it creates a security, correctness or architecture defect | Not allowed. Changing one needs the owner's decision and a docs change first |
| DEFAULT | The expected choice | Allowed with a reason stated in the plan or PR |
| CONTEXT-DEPENDENT | No default; decide per case | Record the choice and reason in the plan or PR |
| PREFERENCE | Style and consistency | Follow it; not argued in review |

The per-decision tables in §5 are the input to `code-rules.md`, which assigns IDs and enforcement (lint / test / review). It is the **authoritative** wording and classification.

**PREFERENCE candidates:**
- Nest file naming (`subscribers.controller.ts`, kebab-case)
- the D6 naming scheme, plus `<module>.errors.ts`
- named exports
- comments explain *why*
- explicit over magical; boring over clever

## 9. Source-of-truth docs (to be derived from this spec)

| Doc | Owns | Does not own |
|---|---|---|
| `CLAUDE.md` | Short project map, status, INVARIANT summary (one line per ID), doc map, skills, Superpowers interplay, learning-first summary, commands | Rationale; full rule text |
| `docs/architecture.md` | WHAT + WHY of the application architecture: system context, layout/ownership/direction, module anatomy, lifecycle, persistence access, validation/serialization, error model, envelope/OpenAPI mechanism, config, bootstrap, decisions log (each with *revisit when*), open questions | Rule registry; DB conventions |
| `docs/api-contract.md` | The shared wire contract (mirror) + API producer obligations + the §7 ownership model | Implementation detail |
| `docs/database.md` | WHAT + WHY of PostgreSQL / TypeORM / migrations / integrity: conventions, constraints as authority, migration lifecycle and reversibility, transactions, TypeORM guardrails explained, DB-error translation facts, local Postgres + `psql` practice | Rule registry |
| `docs/code-rules.md` | **Canonical rule registry:** ID · class · concise rule · enforcement | Rationale (it links to it) |
| `docs/development-workflow.md` | Task lifecycle + Superpowers mapping, trivial fast path, **learning-first mode** + transition, local setup, commands, adding dependencies, contract changes, Git (branches/commits/PRs), progressive CI, definition of done, secrets, testing strategy (levels, harness, `_test` guard) | Architecture rationale |

- `docs/testing.md` is created only if testing outgrows `development-workflow.md`.
- `docs/superpowers/specs/` holds frozen design records; `docs/superpowers/plans/` holds implementation plans.

**Overlap resolutions:**

| Risk | Resolution |
|---|---|
| Contract in two repos | §7: identical mirror + paired changes; OpenAPI is the executable truth |
| `code-rules.md` vs the explanatory docs | Rules worded once (in code-rules). The others explain *why* and cite IDs without restating rules |
| CLAUDE.md invariant summary | One line per ID; `code-rules.md` wins on any difference |
| Learning-first in three places | Full text in workflow; CLAUDE.md summary + link; `xuan-api-feature` mode switch + link. **Not** in `code-rules.md` (a collaboration rule, not a code rule) |
| This spec vs the docs | This spec is frozen; the docs are the living truth |
| `backend-mental-model.md` | Local learning only; never cited as a source of rules |

## 10. Project skills (to be built with `superpowers:writing-skills`)

| Skill | Use when | Responsibility (order of work) | Points to |
|---|---|---|---|
| `xuan-api-feature` | Adding, changing or fixing a backend capability (endpoint, service, entity, schema/DTO, errors, tests) | Classify → owning module → contract/OpenAPI impact → invariants and constraints → schema impact (**hands off to `xuan-database-change`**) → test level → request schema → service + persistence → controller + response DTO → errors + docs decorators → verify → review. **Two modes:** *learning* (explain, give command/code shape, wait, review) and *delegated* (implement) | architecture, api-contract, code-rules, workflow |
| `xuan-database-change` | Any schema change, including schema-only tasks (index, constraint, backfill) | Entity change → explicit names → generate → **read the SQL** → `down()` or documented roll-forward → run → inspect in `psql` → revert/run (learning) → e2e on `xuan_test` → expand → migrate → contract when live data exists | database, code-rules |
| `xuan-api-architecture-review` | Before claiming done, before a PR, reviewing the owner's code (its main use while learning) | Scope → safe checks → `rg` leads → **read in context** ("a search hit is a lead, not a verdict") → checklist → severity → report. Never invents rules; unverified ≠ passing | code-rules, workflow |

**Review severity** (as in xuan-web):

| Finding | Severity |
|---|---|
| INVARIANT violated | Blocker |
| DEFAULT deviated without a stated reason | Must justify |
| Missing tests for behavior, failing checks | Major |
| PREFERENCE, mechanical tests with no behavior | Nit |
| Depends on intent; no rule covers it | Question |

- If behavior testing shows `xuan-database-change` adds nothing over a reference file inside `xuan-api-feature`, it folds back into one.
- No auth, testing, OpenAPI or error skills.
- **No worked-example reference files until real backend code exists.**
- Superpowers owns process: brainstorming, plans, TDD, debugging, verification, general review, finishing a branch.

## 11. Deferred decisions

| Deferred | Trigger |
|---|---|
| Auth: global guard + `@Public()`, users/roles, cookies, refresh lifecycle, CSRF header/Origin enforcement | Auth slice design |
| Rate limiting + `trust proxy` | **Before public launch** |
| Pagination implementation (`PageQueryDto`, `PageInfoDto`, paginated decorator) | Courses |
| First R4 mapping; first E2 → 409 | Courses |
| Module-to-module details; cross-module transactions | First real consumer (orders/entitlements) |
| Custom repository/query classes; dedicated mappers; local layering | Their D2/D4/D3 signals |
| Integration gateways, unsubscribe, consent fields | Provider slice |
| Structured logging, request IDs | First deployment |
| Least-privilege DB roles, CI pipeline, deployment | Deployment work |
| Success `message`/`code`; framework 4xx codes (413, 415) | First real need (additive contract change) |
| Optimistic concurrency, soft delete, background jobs | A slice that needs them |
| Money/currency, i18n of `message` (already open in xuan-web) | Product decisions |
| TypeScript 7; Testcontainers; coverage thresholds; Drizzle re-comparison | Ecosystem or pain signal |

## 12. Learning-first collaboration mode

**Temporary.** It applies to the foundation and the first vertical slices. It's a **workflow** rule, encoded in `CLAUDE.md`, `development-workflow.md` and `xuan-api-feature`, never in `code-rules.md`.

| Claude | Owner |
|---|---|
| Explains the next task, the concept and why it exists | Runs setup, Yarn, Nest and Docker commands |
| Gives the command or a small code shape when needed | Creates files and types the implementation |
| Reviews what the owner wrote; diagnoses failures; challenges architecture violations; suggests tests | Configures PostgreSQL; creates, runs and reverts migrations; inspects the database |
| **Waits.** Implements only a task the owner explicitly delegates | Runs tests; fixes issues with guidance |

**Reading is not implementing.** Claude may freely read and inspect source files, configuration files, documentation, generated output and diffs during review. The state-changing restrictions below still apply exactly as written.

**Commands Claude may run during learning-mode review** (safe, read-only, non-destructive):
- `git status`, `git diff`, `git log`
- lint, typecheck, build
- unit tests that don't mutate external state
- read-only `psql`: `SELECT`, `\d`, `\dt`, and `EXPLAIN` that doesn't execute a mutating statement
- other clearly read-only inspection

**State-changing actions** need the owner's explicit approval or a delegated task:
- source-file edits; package installation/removal
- migration generate/run/revert; DB reset/`TRUNCATE`
- e2e/integration suites that mutate `xuan_test`; seed scripts
- Docker up/down or volume removal
- any SQL that mutates data or schema
- anything else that materially changes project or database state

In these cases Claude recommends the exact command and waits. The restriction may be relaxed later, per task class.

**Learning-mode plan task template:**

```
[learn] | [delegate]
Goal · Why this exists · Concept being learned · What I should do/type ·
How to verify · Expected result · Common failure to watch for
```

**Transition targets.** These are signals, **not gates**. They help the owner judge whether they understand enough to review AI implementation intelligently:
1. Trace a request through pipe → controller → service → repository → filter/interceptor and say what each one owns.
2. Subscribers implemented manually (important); the first relational courses work experienced manually (strongly preferred).
3. Write a migration, explain its SQL, run/revert/inspect it.
4. Write e2e tests on the real DB, and explain the `_test` guard.
5. Diagnose a failing test with hints only.
6. Explain each INVARIANT and what breaks without it.

**Delegation is always per task class, explicitly chosen by the owner, and reversible at any time.** It's recorded in `development-workflow.md`.

## 13. Next steps

1. Owner reviews this spec.
2. Source-of-truth docs derived from this spec through a controlled, planned pass (§9 ownership, no duplicated prose), each reviewed.
3. `superpowers:writing-skills` for the three skills: desired behavior → baseline/pressure tests → write → retest → refine → verify they point to docs.
4. `superpowers:writing-plans` for the learning-first foundation + Subscribers plan (§12 template).
5. Owner implements.

## 14. Rejected alternatives (index)

| Decision | Rejected |
|---|---|
| D1 ORM | Drizzle (1.0 RC at decision time), Prisma, MikroORM |
| D2 Persistence | Wrapper repository per module; repository ports + implementations |
| D3 Layout | Flat Nest root; per-module presentation/application/domain/infrastructure |
| D4 Requests | class-validator + class-transformer `ValidationPipe`; `nestjs-zod` |
| D4 Responses | Return entities; `ClassSerializerInterceptor` + `@Exclude`; `plainToInstance` + `@Expose` |
| D5 Errors | `HttpException` in services; a class per error by default; result types; constraint map in the filter; per-module filters; a generic 409 fallback |
| D6 Envelope | Controllers wrapping by hand; opt-in envelope; Swagger CLI plugin |
| D7 Config | `@nestjs/config` (second loading path for the CLI) |
| D8 Postgres | Native install as the project server (PG 12 is EOL; no version parity) |
| D11 Testing | Jest; Testcontainers; mocked-repository CRUD tests |
| D12 Repeat signup | 409 `EMAIL_ALREADY_SUBSCRIBED` (email enumeration) |

## 15. Verification spikes during implementation

These are not brainstorming topics. Real framework behavior decides them. If one disproves an assumption, the docs change explicitly.

| Item | Proven by |
|---|---|
| Zod issue vendor narrowing in the `StandardSchemaValidationPipe` `exceptionFactory`; detecting `REQUIRED` in Zod 4 | Translator unit tests + validation e2e |
| `.meta({ id })` produces named request components; Zod request bodies appear correctly in OpenAPI | "Document builds" e2e |
| How the interceptor detects `@HttpCode(204)` | "204 has an empty body" fixture e2e |
| Whether `@ApiErrorResponses` appends `VALIDATION_FAILED` automatically or explicitly | Choose while implementing |
| Helmet CSP vs Swagger UI | Open `/docs` locally |
| `process.loadEnvFile()` precedence vs real env vars | `loadConfig` unit test |
| oxlint can enforce the `process.env` and dependency-direction rules (else ESLint + boundaries) | A deliberate violation fails lint |
| TypeORM CLI under ESM (loader vs `dist/`); entity glob in the CLI DataSource | First `migration:generate` |
| `DEFAULT uuidv7()`, named CHECK/UNIQUE generated correctly and **stable** (a second generate is empty) | Generate twice |
| TypeORM `.orIgnore()` emits a target-less `ON CONFLICT DO NOTHING`, which would swallow any unique conflict; the subscriber insert must target `uq_subscribers_email` explicitly | Read the logged SQL |
| Malformed JSON reaches the filter and becomes `VALIDATION_FAILED` with `fields: []` | Fixture e2e |
