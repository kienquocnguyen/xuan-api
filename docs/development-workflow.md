# Development Workflow

This document covers how work moves from an idea to `dev`, and from `dev` to `main`. That includes how Claude and the owner collaborate while the owner is learning.
- Architecture: `architecture.md`.
- Rules: `code-rules.md`.
- Database practice: `database.md`.
- Wire contract: `api-contract.md`.

## 1. Task lifecycle

Superpowers provides the process. The xuan-api skills plug in at fixed points.

| Task | Path |
|---|---|
| New capability or subsystem; change to a boundary, contract or architecture | `superpowers:brainstorming` (architectural) → spec in `docs/superpowers/specs/` → `superpowers:writing-plans` → execution (§3 decides who types) → review → verify → `superpowers:finishing-a-development-branch` |
| Small change to existing code | `superpowers:brainstorming` (bounded: a short design in chat, approval) → implement → review → verify |
| **Trivial change** (§2) | inspect → implement → relevant verification |
| Bug | `superpowers:systematic-debugging` → regression test (§11) → fix → review → verify |
| Schema change | Whichever row above fits, with `xuan-database-change` for the schema part (§8) |
| Contract change | §7, then whichever row above fits |

**Where the xuan-api skills plug in:**

| Stage | What applies |
|---|---|
| Design and planning | Specs and plans respect `architecture.md`, `database.md` and `api-contract.md`. Each plan task names its skill and states the class and reason for any deviation from a DEFAULT or choice under a C rule |
| Implementation | `xuan-api-feature` for capabilities, including their tests; it hands schema work to `xuan-database-change`. Test-first follows `superpowers:test-driven-development`, at the level §11 picks |
| Review | `xuan-api-architecture-review` together with `superpowers:requesting-code-review` |
| Done | `superpowers:verification-before-completion`, then §13 |

**If a skill and the docs disagree, the docs win.** Fix the skill.

## 2. Trivial fast path

A change is trivial when it's one of:
- comment or doc wording;
- formatting;
- an obvious local rename or refactor inside one file;

**and** it changes none of: behavior, the API contract or OpenAPI, the database schema or migrations, configuration/env, security, module boundaries, or what a test proves.

- Verification is whatever's relevant: lint, typecheck, the affected tests.
- If a "trivial" change turns out to touch anything in the "none of" list, stop and take the full path.
- This project rule overrides the Superpowers default of brainstorming before every change.

## 3. Learning-first mode

**Status: active.** It covers the foundation and the first vertical slices. It's temporary and is relaxed per task class (§3.5).

### 3.1 Roles

| Claude | Owner |
|---|---|
| Explains the next task, the concept and why it exists | Runs setup, Yarn, Nest and Docker commands |
| Gives the command, or a small code shape, when needed | Creates files and types the implementation |
| Reviews what the owner wrote (`xuan-api-architecture-review`) | Configures PostgreSQL; creates, runs and reverts migrations; inspects the database |
| Diagnoses failures (`superpowers:systematic-debugging`), challenges architecture violations, suggests tests | Runs tests; fixes issues with guidance |
| **Waits.** Implements only a task the owner explicitly delegates | Decides what to delegate |

### 3.2 What Claude may run

**Reading is not implementing.** Claude may freely read and inspect source files, configuration, documentation, generated output and diffs.

| Allowed during review (safe, read-only) | Needs the owner's explicit approval, or a delegated task |
|---|---|
| `git status`, `git diff`, `git log` | Source-file edits |
| lint, typecheck, build | Installing or removing packages |
| Unit tests that don't mutate external state | `migration:generate` / `run` / `revert` |
| Read-only `psql`: `SELECT`, `\d`, `\dt`, `EXPLAIN` that doesn't execute a mutating statement | Database reset, `TRUNCATE` |
| Other clearly read-only inspection | E2E/integration suites (they mutate `xuan_test`) |
| | Seed scripts |
| | `docker compose up/down`, volume removal |
| | Any SQL that mutates data or schema |
| | Anything else that materially changes project or database state |

For anything in the right-hand column, Claude recommends the exact command and waits for the owner to run it.

### 3.3 Plan task template

Every meaningful task in a learning-mode plan has:

```
[learn] | [delegate]
Goal · Why this exists · Concept being learned · What I should do/type ·
How to verify · Expected result · Common failure to watch for
```

`[delegate]` tasks are ones the owner has explicitly handed to Claude. The same plan format serves both modes.

### 3.4 Review loop

```
owner finishes a task ─► asks for review ─► Claude: safe checks (§3.2) + reads the diff in context
   ─► report with severity (xuan-api-architecture-review) ─► owner fixes ─► owner runs e2e/migrations ─► next task
```

Fixes are proposed in chat. The owner applies them.

### 3.5 Transition to more delegation

These are **learning targets and signals, not gates.** They help the owner judge whether they understand enough to review AI-written code intelligently.

1. Trace a request through pipe → controller → service → repository → filter/interceptor, and say what each one owns.
2. The Services catalog slice implemented manually (important). The first relational courses work experienced manually (strongly preferred).
3. Write a migration, explain its SQL, run/revert/inspect it.
4. Write e2e tests on the real database, and explain the `_test` guard (I21).
5. Diagnose a failing test with hints only.
6. Explain each INVARIANT and what breaks without it.

**Delegation is always per task class, explicitly chosen by the owner, and reversible at any time.** No checklist has to be complete before delegating anything.

**Record each delegated task class here:**

| Task class | Delegated since | Notes |
|---|---|---|
| *(none yet)* | | |

## 4. Local setup

**Tools already on the machine** (no new desktop tools without a stated need, purpose and required/optional status):

| Tool | Used for |
|---|---|
| VS Code | Code |
| Terminal | Nest, Yarn, Docker, migrations, `psql` |
| Docker Desktop | Local PostgreSQL |
| pgAdmin | Optional database GUI |
| Postman | Manual exploratory API calls (automated tests are the real verification) |
| SourceTree | Git visualization |

**Baseline:**

| Item | Setup |
|---|---|
| Node | **24 LTS** via NVM for Windows (`nvm install 24`, `nvm use 24`). Pinned with `engines` and `.nvmrc` |
| Yarn | **4**, via Corepack (`corepack enable`); version pinned by `packageManager`; `nodeLinker: node-modules`. Same as xuan-web |
| NestJS | **12**, starting from the official starter's defaults (ESM, Vitest, TS ^6) |
| TypeScript | **6.x, pinned.** TS 7 waits until Nest and `@nestjs/swagger` officially support it |
| Lint / format | Lint must enforce I2 and I4 (tool settled by a verification spike: the starter's oxlint, else ESLint + boundaries). Prettier with xuan-web's settings |
| PostgreSQL | Docker Compose `postgres:18`, service `db`, host port **5433** (the native PostgreSQL 12 on 5432 is left untouched). An init script creates `xuan_dev` and `xuan_test`, owned by login role `xuan_app`. Details and practice: `database.md` §11 |
| Env files | Copy `.env.example` → `.env` (development) and `.env.test` (test, pointing at `xuan_test`) |

## 5. Commands

Each script is added together with the tool it runs.

| Command | Purpose | Available |
|---|---|---|
| `yarn start:dev` | Dev server (`http://localhost:4000`) | With the Nest app |
| `yarn build` / `yarn start:prod` | Build / run the build | With the Nest app |
| `yarn lint` | Lint, including boundary rules | With lint |
| `yarn typecheck` | `tsc --noEmit` | With the Nest app |
| `yarn format` / `yarn format:check` | Prettier write / check | With Prettier |
| `yarn test` | Unit tests | With Vitest |
| `yarn test:e2e` | E2E against `xuan_test` (mutates it) | With the e2e harness |
| `yarn db:up` / `yarn db:down` | Start / stop the Compose database | With Compose |
| `yarn migration:generate` / `:create` / `:run` / `:revert` / `:show` | Migrations (through `loadConfig()`) | With TypeORM |

## 6. Adding a dependency

1. Name the responsibility it takes over, and confirm that responsibility exists **now**.
2. `yarn add` (or `yarn add -D`). During learning-first mode the owner runs this (§3.2).
3. Mention it in the PR description: *what it's for, and what we would otherwise hand-write*.

## 7. Changing the API contract

Ownership model: `api-contract.md` §0.

1. Decide the change against `api-contract.md` §9 (expand → migrate → contract for wire changes; coordinated change for contract identifiers, I19).
2. Change the API and its OpenAPI output together. The exact-body e2e tests and the document-build test must agree.
3. If the shared policy (§1–§9) changes, update **both** `api-contract.md` files as paired work.
4. xuan-web pulls the snapshot and regenerates in its own PR.

A mismatch between runtime/OpenAPI and Markdown is a contract defect: fix it explicitly.

## 8. Changing the database schema

Follow `xuan-database-change`, with `database.md` as the reference.
- The migration SQL is read before it runs.
- Reversible migrations are reverted and re-run locally.
- A second `migration:generate` must come back empty.
- **The physical database map** (`database.md` §12) is updated in the same change whenever the schema changed. Checking it is part of schema-change review.
- If the change alters business concepts or their relationships, `data-model.md` is updated too.

## 9. Git: branches, commits, PRs

**Initial baseline: TBD.** The repository has no commits yet. The owner decides the first commit and when `main`/`dev` are created, after the documentation and skills are reviewed. Until then, nothing is committed.

The intended model once the baseline exists:

| Branch | Role | Changes arrive by |
|---|---|---|
| `main` | Release / production-ready | Release PRs from `dev` only |
| `dev` | Integration; the default branch | Task PRs only |
| Task branch (`feat/`, `fix/`, `chore/`, `docs/`) | One task | The task's own commits |

- **No direct commits to `dev` or `main`** after the baseline.
- **Task:** branch from an up-to-date `dev` → implement → verify (§13) → PR to `dev` → review → merge. When a Superpowers skill asks for the base branch, it's `dev`.
- **Release:** verification on `dev` → PR `dev` → `main` → merge and deploy.
- One task per branch and per PR. No `release/*` or `hotfix/*` until a real need appears (docs first, §15).

**Naming** follows xuan-web's convention (its `development-workflow.md` §5.1):
- Branches: `<type>/<action>-<scope>[-<detail>]`, e.g. `feat/build-services-catalog`, `chore/setup-database`; `fix/<scope>-<detail>`.
- Commits: Conventional Commits `<type>(<scope>): <imperative description>`. Semantic, singular scopes such as `service`, `course`, `auth`, `database`, `http`, `config`, `tooling`.

## 10. CI (progressive)

There's no CI yet. Gates are added by trigger as the tooling exists:

| Trigger | Gates |
|---|---|
| Task PR → `dev` | lint, typecheck, unit, e2e (with a PostgreSQL service container and the same env variables), the migration "generate twice" check |
| Release PR `dev` → `main` | everything above + build |

## 11. Testing

Test **behavior that carries risk**, at the cheapest level that proves it (D40). `superpowers:test-driven-development` decides *when* (test first); this section decides *which level* and *what*.

### Levels

| Code | Level |
|---|---|
| Pure logic: Zod-issue translator, `loadConfig()` validation, future domain rules | **Unit**, table-driven (`*.spec.ts`, colocated) |
| Platform behavior: `{ data }` envelope, 204 empty body, `undefined` → 500, `AppError` → envelope, unknown error → generic 500 with no leaked text, malformed JSON, over-limit body | **E2E** against a **test-only fixture controller** in `test/` |
| Each endpoint outcome: success, each validation failure type, each business outcome, each translated constraint | **E2E**: real HTTP + real PostgreSQL + **exact body** (`toEqual`) |
| The OpenAPI document builds with the expected named components | **E2E** |
| Simple CRUD services with mocked repositories; key/alias/config objects with no logic | **None.** A mock can't prove a constraint |

### Harness (`test/`)

Created with the first e2e test.

| Piece | Contract |
|---|---|
| Global setup | Loads config with `NODE_ENV=test`, runs the **I21 guard**, applies migrations to `xuan_test` once |
| App factory | Builds `AppModule` with `@nestjs/testing`, calls the **same `configureApp()`** as `main.ts` (D6), and initializes it |
| Database cleanup | Before each test: the I21 guard, then `TRUNCATE` all application tables (never the migrations table) |
| Fixture controller | A test-only module exercising platform behavior without any business module |
| Execution | E2E files run **serially** (shared database, D39) |

**The `_test` guard (I21)** refuses destructive cleanup unless the connected database is provably the dedicated test database: its name ends in `_test`, and it matches the configured test database. A wrong `.env.test` must never truncate `xuan_dev`.

### Bugs

1. Find the root cause with `superpowers:systematic-debugging`.
2. If the symptom is documented behavior, it's a question for the owner, not a test to write.
3. Otherwise write a test at the level above that reproduces the symptom, watch it fail, then fix.

A test never seen failing proves nothing.

## 12. Review flow

| Review | Covers |
|---|---|
| `xuan-api-architecture-review` | Project rules, **evidence first**: a search hit is a lead, not a verdict. Severity: Blocker (INVARIANT) · Must justify (unexplained DEFAULT deviation) · Major (missing tests or checks) · Nit (PREFERENCE) · Question (depends on intent; no rule covers it). Never invents rules; unverified ≠ passing |
| `superpowers:requesting-code-review` | General code quality |

During learning-first mode, the review runs only safe checks itself (§3.2). Mutating suites are run by the owner, and their output is part of the evidence.

## 13. Definition of Done

- [ ] Behavior matches the approved design or plan.
- [ ] `xuan-api-architecture-review` passes: no INVARIANT violations, and every DEFAULT deviation and C-rule choice is justified.
- [ ] Tests at the level §11 picks exist, and were seen failing before passing where they prove new behavior.
- [ ] `lint`, `typecheck`, `test` and `test:e2e` pass, with output observed (not assumed).
- [ ] Schema changes: SQL read; reversible migrations reverted and re-run; the second generate is empty; the physical database map (`database.md` §12) matches the new schema.
- [ ] The OpenAPI document builds; new or changed responses and error codes are documented.
- [ ] Contract changes followed §7. Docs are updated if a decision or rule changed.

## 14. Secrets

**Always (I6):**
- `.env.example` documents every variable with fake values.
- `.env` and `.env.test` are gitignored.
- Never paste real credentials, tokens or customer data into fixtures, tests, issues or plans.

**Before making the repo public:**
- [ ] Scan the full history for secrets (e.g. gitleaks); rotate anything found. Deleting isn't enough.
- [ ] Remove real customer data and internal URLs.
- [ ] README explains the architecture.

## 15. Changing the engineering system

- **A rule or decision:** edit `docs/` first, then the code. `code-rules.md` owns rule wording and classes; the explanatory docs own the reasoning.
- **Skills** (`.claude/skills/`) are changed with `superpowers:writing-skills`. They link to docs and rule IDs and never restate them.
- **`CLAUDE.md`** stays short: identity, working mode, invariant summary, doc map, skills, commands.
- **`docs/backend-mental-model.md`** is local-only learning material. It's never a source of rules.
