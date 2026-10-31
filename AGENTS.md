# Codex in xuan-api

This is the XuanCreative backend: Node 24, Yarn 4, NestJS 12 ESM,
TypeScript 6, Zod 4, TypeORM 1.x, PostgreSQL 18, Vitest and supertest.

## Authority and context

- [docs/code-rules.md](docs/code-rules.md) owns rule wording and classification.
- [docs/development-workflow.md](docs/development-workflow.md) owns lifecycle,
  learning/delegation, Git, testing, review and Definition of Done.
- Read applicable sections of [architecture](docs/architecture.md),
  [database](docs/database.md), [API contract](docs/api-contract.md) and
  [conceptual data model](docs/data-model.md) for the affected boundary.
- Living docs take precedence over frozen `docs/superpowers/` records and Skills.
  INVARIANT changes require an owner decision and docs first; justify DEFAULT
  deviations and record CONTEXT-DEPENDENT decisions. Preserve PREFERENCE consistency.
- Preserve `CLAUDE.md` and `.claude/skills/`. Claude-specific authority in workflow
  §3.5 is not a Codex grant. An ambiguous grant is a question, not permission.

## Start and execute

Read the task, inspect status and affected code, establish scope and authorization.
Default to learning-first unless the owner explicitly delegates the Codex task.
Use workflow §2 for trivial tasks; otherwise follow §1, including design approval,
proportionate planning, test-first at §11's behavioral boundary, review and §13.
Read only relevant context; reuse evidence only while its source/configuration
remain applicable. Follow [the Codex adapter](docs/codex-workflow.md) for operation.

Repository Skills in `.agents/skills/`:

- `xuan-backend-change`: design, implementation, TDD and contract handoff.
- `xuan-debug`: evidence-first layer diagnosis and regression workflow.
- `xuan-backend-review`: architecture/security and independent whole-branch review.
- `xuan-database-release`: schema preparation and release/rollback safety.

`src/modules/` owns business capabilities and repositories; `config/`, `errors/`,
`database/` and `http/` have the dependencies in architecture §4. Controllers handle
HTTP and explicit DTO mapping; services own use cases and module persistence.
Cross-module access uses exported providers. Assess cohesion by responsibility,
coupling, complexity, reuse, readability, testability, security and change frequency;
use neither arbitrary file limits nor speculative layers.

## Safety and evidence

- Instructions and Skills never grant operations. Codex needs explicit scope for
  edits, installations, database operations, external services and Git mutations.
  Database-mutating tests need the documented approval and isolated target/guards.
  Never reproduce bugs or run cleanup/migration experiments on Neon Production.
- Do not read or disclose secret env files, tokens or customer data. Use sanitized
  evidence and variable names. Do not modify another repository without approval.
- Before Git operations inspect status and exact task ownership. Before topology
  decisions read workflow §9 and `.claude/skills/xuan-git-branch-cohesion/SKILL.md`.
  Preserve unrelated work; when staging is authorized use exact file paths and
  inspect the staged diff. Never broad-stage, force-push, rewrite shared history,
  bypass protection or delete branches. Claude Git grants do not apply to Codex.
- Use delegation only for bounded independent work when requested by the owner or
  applicable instructions. Primary agent owns integration and verification.
  Independent review requires a fresh context and the review packet in the guide;
  otherwise use a separate session. Self-review must be labeled self-review.
- Report observed commands, results and unverified gates. Never claim completion,
  independence, production readiness or runtime parity without evidence.
