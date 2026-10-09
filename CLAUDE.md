# xuan-api

Backend for **Xuan Creative**: NestJS 12 · REST · PostgreSQL 18 · TypeORM 1.x · Zod 4 · OpenAPI. A modular monolith in its own repo, deployed separately from `xuan-web` (Next.js). The generated OpenAPI document is the executable contract between them (`docs/api-contract.md` §0).

**Status:** documentation phase. No application code yet. Git baseline:
A single initial engineering-system commit is established on main.
dev branches from that baseline and is the default integration branch (`docs/development-workflow.md` §9).

## Working mode: LEARNING-FIRST (active)

The owner implements the early backend by hand.

- **Claude** explains, plans, reviews, debugs and **waits**.
- **Claude may read** anything and run safe read-only checks.
- **Claude never** edits files, installs packages, runs migrations or e2e suites, or mutates the database or Docker unless the owner approves that action or has delegated the task.

Full rules, task template and delegation record: `docs/development-workflow.md` §3.

## Non-negotiable rules (INVARIANT)

`docs/code-rules.md` has the authoritative wording, plus every DEFAULT (D), CONTEXT-DEPENDENT (C) and PREFERENCE rule.

- A DEFAULT deviation needs a stated reason.
- Changing an INVARIANT needs the owner's decision and a docs change first.

| ID  | Rule                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Only the owning module registers an entity with `forFeature`; others use its exported providers                                                                              |
| I2  | Imports follow the allowed-dependency table (`architecture.md` §4)                                                                                                           |
| I3  | Controllers never inject repositories or `DataSource`                                                                                                                        |
| I4  | Only `src/config/` reads `process.env`                                                                                                                                       |
| I5  | Config is validated before listening; errors never print values                                                                                                              |
| I6  | No secrets or real customer data committed                                                                                                                                   |
| I7  | Schema changes only through explicit migration commands; never `synchronize` or boot-time migrations                                                                         |
| I8  | Inside a transaction, use only the transaction's manager                                                                                                                     |
| I9  | Never pass request input wholesale to persistence                                                                                                                            |
| I10 | Entities never reach the wire; responses are explicit DTOs                                                                                                                   |
| I11 | Successful payloads are wrapped `{ data }` by the global interceptor                                                                                                         |
| I12 | No-content = `@HttpCode(204)` + `void` + empty body; `undefined` elsewhere is a 500 bug                                                                                      |
| I13 | Every error uses the error envelope with a stable code; validation = `VALIDATION_FAILED` + `details.fields[]`; framework errors → baseline codes (incl. `PAYLOAD_TOO_LARGE`) |
| I14 | Business failures throw `AppError`, never `HttpException`                                                                                                                    |
| I15 | HTTP never infers meaning from database errors; untranslated violations → 500                                                                                                |
| I16 | No stack traces, SQL or constraint names on the wire                                                                                                                         |
| I17 | No sensitive request data in logs                                                                                                                                            |
| I18 | Every endpoint documents every error code it can return, from the runtime definitions                                                                                        |
| I19 | DTO names, request component ids and error codes are consumer contract identifiers                                                                                           |
| I20 | CORS: exact origins only, `credentials: true`, contract headers                                                                                                              |
| I21 | Destructive test cleanup only on the provable `_test` database                                                                                                               |

## Where things are

| Need                                                                                                              | Read                                                 |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Layout, ownership, dependencies, lifecycle, errors, envelope, config, bootstrap, decisions (AD-n), deferred items | `docs/architecture.md`                               |
| Business concepts and relationships (users, roles, services, courses, content…), confirmed vs open                | `docs/data-model.md`                                 |
| PostgreSQL / TypeORM / migrations / constraints / transactions / `psql` practice; **the physical database map**   | `docs/database.md`                                   |
| Envelopes, error and field codes, OpenAPI pipeline, CORS/CSRF, contract ownership, pending xuan-web deltas        | `docs/api-contract.md`                               |
| Every rule with class, enforcement and rationale link                                                             | `docs/code-rules.md`                                 |
| Task lifecycle, learning-first mode, local setup, commands, Git, CI, testing, review, DoD, secrets                | `docs/development-workflow.md`                       |
| Frozen design records / implementation plans                                                                      | `docs/superpowers/specs/`, `docs/superpowers/plans/` |

`docs/backend-mental-model.md` is local-only learning material, never a source of rules.

## Project skills

Located in `.claude/skills/`. They're changed only with `superpowers:writing-skills`.

- **xuan-api-feature**: adding, changing or fixing a backend capability (learning and delegated modes).
- **xuan-database-change**: any schema change, including schema-only tasks.
- **xuan-api-architecture-review**: evidence-first review before done or a PR, and of the owner's code.

## Working with Superpowers

- Superpowers owns process: brainstorming, plans, TDD, debugging, verification, general review, finishing branches. Xuan skills own project conventions. Docs win over skills.
- Every plan task names its Xuan skill. In learning-first mode, tasks are tagged `[learn]` / `[delegate]`.
- Trivial changes take the fast path (`docs/development-workflow.md` §2).

## Dependencies and commands

- Install a dependency only when a task needs its responsibility now. **Yarn 4 only.**
- Commands arrive with their tools: `docs/development-workflow.md` §5. None exist yet.
