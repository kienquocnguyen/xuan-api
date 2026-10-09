# Code Rules

This is the **canonical rule registry** for `xuan-api`. For every rule it answers four questions:

| Question | Where |
|---|---|
| What is the rule? | The **Rule** column, the authoritative wording |
| What class is it? | The section it's in, and its ID prefix (`I`, `D`, `C`) |
| How is it enforced? | The **Enforcement** column |
| Where is the WHY? | The **Why** column, which points to the doc section that owns the reasoning |

- This file **wins on wording and classification**. The other docs explain rules and cite their IDs, but never restate them.
- It contains no rationale. If a rule's *why* is unclear, read the linked section.
- Collaboration and process rules (learning-first mode, Git, review flow, Definition of Done) live in `development-workflow.md`, not here.
- The *Why* links name the section by title. Section numbers are added in the documentation consistency pass.

## Rule classes

| Class | Meaning | Deviation |
|---|---|---|
| **INVARIANT** (`I`) | Breaking it creates a security, correctness, contract or architecture defect | Not allowed. Changing one needs the owner's decision and a docs change first |
| **DEFAULT** (`D`) | The expected choice | Allowed with a reason stated in the plan or PR |
| **CONTEXT-DEPENDENT** (`C`) | No default; decide per case, using the stated criteria | Record the choice and the reason in the plan or PR |
| **PREFERENCE** | Style and consistency | Follow it; not argued in review |

## Enforcement legend

| Value | Meaning |
|---|---|
| `lint*` | Mechanically enforced by the linter. *The tool (the starter's oxlint, or ESLint + boundaries) is settled by a foundation verification spike. Until then it's enforced by review* |
| `unit` | A unit test proves it |
| `e2e` | An end-to-end test (real HTTP + real PostgreSQL) proves it |
| `review` | Checked by `xuan-api-architecture-review`, with a search as a lead and the surrounding code read before any verdict |
| `config` | Rejected at startup by config validation |

---

## INVARIANT

### Boundaries and ownership

| ID | Rule | Enforcement | Why |
|---|---|---|---|
| I1 | Only the business module that owns an entity registers it with `TypeOrmModule.forFeature(...)`. No other module registers or injects that entity's repository; a module that needs the capability imports the owning Nest module and calls its explicitly exported providers | review | architecture.md: Persistence access |
| I2 | Imports follow the allowed-dependency table: `config/` and `errors/` import no application layer; `database/` imports only `config/`; `http/` imports only `config/` and `errors/`; no platform folder imports `modules/`; a module reaches another module only through that module's exported providers, never its repositories, private providers or entity internals. V1 modules do not import another module's entities; cross-module ORM relation metadata is governed by C12 | lint\*, review | architecture.md: Allowed dependencies |
| I3 | Controllers never inject repositories or `DataSource` | review | architecture.md: Persistence access |

### Configuration and secrets

| ID | Rule | Enforcement | Why |
|---|---|---|---|
| I4 | Only `src/config/` reads `process.env` | lint\* | architecture.md: Configuration |
| I5 | Configuration is loaded and validated by `loadConfig()` before the app listens. Invalid configuration stops startup, and validation errors name variables without printing their values | unit, review | architecture.md: Configuration |
| I6 | No secrets, credentials or real customer data are committed. `.env` and `.env.test` are ignored; only `.env.example` is committed, with fake values | `.gitignore`, review | development-workflow.md: Secrets |

### Persistence and database

| ID | Rule | Enforcement | Why |
|---|---|---|---|
| I7 | Schema changes happen only through migrations run by an explicit command. `synchronize` is never enabled, and `migrationsRun` never runs migrations on app boot, in any environment | review | database.md: Migrations |
| I8 | Inside `dataSource.transaction(async (manager) => …)`, every database access that participates in the transaction uses repositories obtained from that `manager`, never the normally injected repository | review | database.md: Transactions |
| I9 | Request input objects are never passed wholesale to persistence (`save`, `insert`, `update`, `create`, `merge`). Persisted fields are assigned explicitly | review | database.md: TypeORM guardrails |

### HTTP contract and errors

| ID | Rule | Enforcement | Why |
|---|---|---|---|
| I10 | TypeORM entities are never returned as API responses. Responses are explicit response DTOs produced by explicit mapping. Entity-level `@Exclude` and `class-transformer` are not used as the response-safety mechanism | e2e (exact body), review | architecture.md: Validation and serialization |
| I11 | Every successful payload response is wrapped as `{ data }` by the global success interceptor | e2e | api-contract.md: Success envelope · architecture.md: Envelope and OpenAPI |
| I12 | A no-content endpoint declares `@HttpCode(204)`, returns `void` and sends an empty body. A payload endpoint that returns `undefined` is an application bug answered with 500, never a silent `{}` | e2e | api-contract.md: Success envelope · architecture.md: Envelope and OpenAPI |
| I13 | Every error response uses the contract's error envelope with a stable `UPPER_SNAKE_CASE` code. Request validation failures are `400 VALIDATION_FAILED` with `details.fields[]` (dot-path `field`, user-safe `message`, stable field `code`). Framework-raised errors that are reachable today are translated to baseline codes with a user-safe message, including `413 PAYLOAD_TOO_LARGE` for a body over the JSON size limit | unit (translator), e2e | api-contract.md: Error envelope |
| I14 | Application code throws `AppError` for business failures, never Nest `HttpException` classes | review | architecture.md: Error model |
| I15 | The HTTP layer never infers business meaning from raw database errors. A constraint violation that the owning module didn't translate becomes `500 INTERNAL_ERROR` and is logged, never a generic 409 | review | architecture.md: Error model · database.md: Database errors |
| I16 | Responses never carry stack traces, SQL, constraint names or internal identifiers. Unknown errors get a generic message | e2e (fixture), review | architecture.md: Error model |
| I17 | Logs never contain request bodies, auth headers, cookies, passwords or other sensitive request data by default | review | architecture.md: Error model |
| I18 | Every endpoint documents every error code it can return, including `500 INTERNAL_ERROR`, using the same module-owned error definitions the runtime throws | e2e (document builds), review | api-contract.md: Error envelope · architecture.md: Envelope and OpenAPI |
| I19 | Response DTO class names, request OpenAPI component ids and error codes are public, machine-readable consumer contract identifiers. Changing or removing any of them requires an explicit, coordinated contract change: renaming or removing an error code is a breaking API-contract change, and renaming an OpenAPI component is breaking for generated consumers. Expand → migrate → contract is used when the underlying wire or schema evolution needs compatibility staging | review | api-contract.md: Evolving the contract |
| I20 | CORS allows only exact, configured origins (never a wildcard), sends `credentials: true`, and allows the request headers the contract requires (`Content-Type`, `X-Requested-With`) | config, e2e, review | architecture.md: HTTP bootstrap · api-contract.md: CORS and CSRF |

### Testing

| ID | Rule | Enforcement | Why |
|---|---|---|---|
| I21 | Destructive test cleanup refuses to run unless it can prove it's connected to the dedicated test database, including the `_test` database-name check | e2e harness, review | development-workflow.md: Testing |

---

## DEFAULT

### Modules and layers

| ID | Rule | Enforcement | Why |
|---|---|---|---|
| D1 | One Nest module per business capability, under `src/modules/<capability>/`. Folders are created when their first file needs them. No generic `common/`, `shared/` or `utils/` | review | architecture.md: Layout and ownership |
| D2 | Controllers handle HTTP only: receive validated input, call a service, map the result to the response DTO | review | architecture.md: Module anatomy |
| D3 | Services own use-case logic. Services of simple modules inject TypeORM `Repository<Entity>` directly | review | architecture.md: Persistence access |
| D4 | Controllers return the payload DTO, never an already-wrapped envelope | review | architecture.md: Envelope and OpenAPI |
| D5 | The controller invokes response mapping. Services don't return HTTP response DTOs. Trivial mapping functions live next to their response DTO | review | architecture.md: Validation and serialization |
| D6 | Global validation, exception handling and success wrapping are registered as `APP_PIPE`, `APP_FILTER` and `APP_INTERCEPTOR` providers in `HttpContractModule`. App-level HTTP setup lives in `configureApp()`, called by both `main.ts` and the e2e app factory | review, e2e | architecture.md: HTTP bootstrap |

### Request validation

| ID | Rule | Enforcement | Why |
|---|---|---|---|
| D7 | Request body, query and params are validated with Zod 4 schemas through Nest's `StandardSchemaValidationPipe` | review | architecture.md: Validation and serialization |
| D8 | Object request schemas reject unknown fields (`z.strictObject`) | e2e, review | architecture.md: Validation and serialization |
| D9 | A malformed UUID in a path parameter is `400 VALIDATION_FAILED` (field `id`, code `INVALID_FORMAT`) | e2e | api-contract.md: Error envelope |

### Errors and logging

| ID | Rule | Enforcement | Why |
|---|---|---|---|
| D10 | Each business module owns its domain-specific error codes and factories in `<module>.errors.ts`. Baseline codes live with `AppError` in `src/errors/` | review | architecture.md: Error model |
| D11 | Database errors are translated at the call site: `database/` helpers answer factual questions (e.g. "a unique violation on constraint X?"), and the owning service assigns meaning by throwing `AppError` | review | architecture.md: Error model · database.md: Database errors |
| D12 | Unknown and 5xx errors are logged at error level by the global filter, with method, route, error name, message, stack and (for database errors) the Postgres code and constraint. Expected 4xx outcomes are not error-level logs | review | architecture.md: Error model |

### Envelope and OpenAPI

| ID | Rule | Enforcement | Why |
|---|---|---|---|
| D13 | Successful payload responses contain `data` only. The contract's optional `message` and `code` are not emitted until a real use exists | e2e | api-contract.md: Success envelope |
| D14 | A paginated endpoint returns `{ items, pageInfo }` as its payload; the global interceptor wraps it like any other payload | e2e | api-contract.md: Pagination · architecture.md: Envelope and OpenAPI |
| D15 | Endpoints are documented with the `http/` helpers: `@ApiEnvelopeResponse` (later `@ApiPaginatedEnvelopeResponse`), `@ApiErrorResponses` and `@ApiNoContentResponse`. `VALIDATION_FAILED` is documented on endpoints with validated input. Auth and rate-limit errors are documented only once those concerns exist | e2e (document builds), review | architecture.md: Envelope and OpenAPI |
| D16 | The response DTO named in the Swagger decorator is the same class as the controller method's return type | review | architecture.md: Envelope and OpenAPI |
| D17 | Request documentation comes from the Zod schema, named with `.meta({ id })`. Response documentation comes from response DTO classes with hand-written `@ApiProperty` (no Swagger CLI plugin) | e2e (document builds), review | architecture.md: Envelope and OpenAPI |

### Configuration and HTTP bootstrap

| ID | Rule | Enforcement | Why |
|---|---|---|---|
| D18 | Configuration is read only through `loadConfig()`, the single path shared by the app (as a custom provider), the TypeORM migration CLI and tests (with `.env.test`) | review | architecture.md: Configuration |
| D19 | Environment differences flow only through validated `AppConfig` values, not through scattered `NODE_ENV` checks | review | architecture.md: Configuration |
| D20 | `/docs` and `/docs-json` are served only when validated config enables them; the default is disabled | config, review | architecture.md: HTTP bootstrap |
| D21 | Only JSON request bodies are parsed, with a conservative size limit. Another body parser is added only for the feature that needs it. A body over the limit is answered with `413 PAYLOAD_TOO_LARGE` (I13) | e2e, review | architecture.md: HTTP bootstrap |
| D22 | Helmet's default headers are applied and shutdown hooks are enabled (so the database pool closes). No global route prefix and no API versioning | review | architecture.md: HTTP bootstrap |
| D23 | Public write endpoints are rate-limited before public production launch | review (launch checklist) | architecture.md: HTTP bootstrap |

### Database

| ID | Rule | Enforcement | Why |
|---|---|---|---|
| D24 | Tables are snake_case and plural, columns snake_case, entity properties camelCase. Table and multi-word column names are declared explicitly in the entity. No custom `NamingStrategy` | review | database.md: Naming |
| D25 | Every constraint and index has an explicit, stable name: `pk_<table>`, `uq_<table>_<cols>`, `fk_<table>_<col>`, `ix_<table>_<cols>`, `ck_<table>_<rule>` | review (migration SQL) | database.md: Naming |
| D26 | API/business entities use database-generated UUID v7 primary keys: `id uuid PRIMARY KEY DEFAULT uuidv7()` | review (migration SQL) | database.md: Primary keys |
| D27 | Business records have `created_at timestamptz NOT NULL DEFAULT now()`. `updated_at` is added only when the record changes during its lifecycle | review (migration SQL) | database.md: Timestamps |
| D28 | Columns holding real instants use `timestamptz`, never `timestamp` without a time zone. Instants are ISO 8601 UTC strings on the wire | review | database.md: Timestamps |
| D29 | String columns use `varchar(n)` where a real maximum exists, `text` otherwise | review (migration SQL) | database.md: Strings and canonical identifiers |
| D30 | An intentionally case-insensitive business identifier has one canonical stored representation, enforced at the database boundary (e.g. a CHECK constraint) | review (migration SQL), e2e | database.md: Strings and canonical identifiers |
| D31 | Data invariants (uniqueness, references, required values, allowed values) are enforced by database constraints, not only by application checks | review (migration SQL), e2e | database.md: Constraints as authority |
| D32 | An `ON CONFLICT` clause names its conflict target (`ON CONFLICT ON CONSTRAINT <name>` or explicit columns), never a target-less `ON CONFLICT DO NOTHING` | review (logged SQL) | database.md: Constraints as authority |
| D33 | Each migration contains one logical change. Its SQL is read before it runs. A migration that's merged or applied anywhere is not rewritten: a new migration follows | review | database.md: Migrations |
| D34 | A migration implements a meaningful `down()` when the change is safely reversible | review, local revert | database.md: Migrations |
| D35 | Migrations live in `src/database/migrations/` | review | database.md: Migrations |
| D36 | Writes use explicit `insert`/`update` or QueryBuilder calls rather than `save()` as a generic shortcut | review | database.md: TypeORM guardrails |
| D37 | Relations are neither eager nor lazy. Each query loads the relations it needs explicitly | review | database.md: TypeORM guardrails |
| D38 | Non-trivial queries use QueryBuilder or explicit queries where relational or query behavior deserves visibility, and their generated SQL is inspected | review | database.md: TypeORM guardrails |

### Testing

| ID | Rule | Enforcement | Why |
|---|---|---|---|
| D39 | Tests run on Vitest with supertest. E2E tests run against the real PostgreSQL `xuan_test` database: migrations are applied once before the suite, application tables are truncated between tests, and e2e files run serially | review | development-workflow.md: Testing |
| D40 | Test level follows risk: unit tests for pure logic; e2e per endpoint outcome with exact-body assertions; platform behavior through a test-only fixture controller; an OpenAPI document-build test. No mocked-repository tests for trivial CRUD | review | development-workflow.md: Testing |

---

## CONTEXT-DEPENDENT

| ID | Decision | Criteria | Why |
|---|---|---|---|
| C1 | A module-specific repository or query class | Only on a concrete signal: the same non-trivial query is reused; QueryBuilder/raw code obscures the use case; persistence logic becomes substantial; a complex query deserves its own real-database test | architecture.md: Persistence access |
| C2 | A dedicated mapper | When mapping becomes substantial, reused, nested, or makes the controller hard to read | architecture.md: Validation and serialization |
| C3 | An explicit transaction | When several writes must succeed or fail together. Once used, I8 applies | database.md: Transactions |
| C4 | Repository ports, a separate domain model, or internal layering inside one module | Only for a genuine second persistence implementation or genuinely rich domain logic in that module. Never for symmetry across modules | architecture.md: Persistence access · Layout and ownership |
| C5 | An integration gateway (interface + adapter) for an external provider | When an external integration exists. Gateways are separate from persistence and are never a reason for repository ports | architecture.md: Persistence access |
| C6 | Handle a conflict as a normal result (`INSERT … ON CONFLICT`) instead of translating a constraint error (D11) | When the conflict is an expected outcome and SQL expresses it clearly. Not a requirement for every unique conflict. D32 applies | database.md: Constraints as authority |
| C7 | Stripping, instead of rejecting, unknown fields on a specific endpoint | Only with a stated reason (D8 is the default) | architecture.md: Validation and serialization |
| C8 | A primary-key strategy other than UUID v7 | With a concrete technical or domain reason (D26 is the default) | database.md: Primary keys |
| C9 | An irreversible or data-destructive migration | No misleading `down()`. The migration and plan document the recovery or roll-forward strategy | database.md: Migrations |
| C10 | Expand → migrate → contract for a schema change | When the change would break existing data or running code (renames, type changes, new `NOT NULL` on populated tables, drops) | database.md: Migrations |
| C11 | A new stable error code for a framework-level status that isn't part of the current runtime contract (e.g. 415) | When the behavior is deliberately exposed to clients. Added to the contract as an additive change | api-contract.md: Error envelope |
| C12 | ORM relation metadata between entities owned by different business modules | Deferred: decided explicitly when the first real database relation across modules appears. The decision must keep entity/table ownership clear, keep repositories private to the owning module, keep business behavior flowing through exported providers, and limit the dependency to ORM relation metadata, never general cross-module persistence access | architecture.md: Deferred architecture |

---

## PREFERENCE

- **Files:** kebab-case with Nest's type suffixes: `services.module.ts`, `services.controller.ts`, `services.service.ts`, `service-offering.entity.ts`, `services.errors.ts`. Class names may be more explicit than the business word when it collides with a Nest term (`ServiceOffering`, `ServicesCatalogService`). Request schemas and response DTOs live in the module's `dto/` folder: `dto/create-service.dto.ts` (a request schema, when one exists), `dto/service.dto.ts`.
- **Names:**
  - response DTO classes `<Thing>Dto` (`ServiceDto`, `CourseListItemDto`, `PageInfoDto`)
  - request components `<Verb><Thing>Dto` (`CreateServiceDto`, set through `.meta({ id })`)
  - Zod schema variables `<verb><Thing>Schema` (`createServiceSchema`)
  - inferred input types `<Verb><Thing>Input` (`CreateServiceInput`)
  - error factories camelCase on the module's errors object
- **Exports:** named exports.
- **Code style:** explicit over magical; boring over clever; no wrapper or abstraction without a responsibility; few globals.
- **Comments:** explain *why*, not *what*.
- **Tests:** unit tests colocated as `*.spec.ts`; e2e tests in `test/` as `*.e2e-spec.ts`.
