# Codex backend workflow

This is an operating adapter, not a second rulebook. `code-rules.md` owns rule
wording/classes; `development-workflow.md` owns process. Architecture, database,
contract and conceptual-model docs retain their existing responsibilities. Skills
lose to docs. `CLAUDE.md` and `.claude/skills/` remain intact.

## Start a task

Launch Codex in xuan-api. Root `AGENTS.md` supplies repository instructions; inspect
any applicable nested instructions. Read workflow §§1–3 and the rule registry once
per relevant context, then only the sections and source needed for this outcome.
Re-read when scope, governance or evidence changes, not before every helper edit.

State the functional outcome, exclusions, learning/delegated mode and allowed
operations. Inspect `git status --short --untracked-files=all`, current branch and
affected code before edits. Apply `AGENTS.md`'s learning/delegation and authorization
boundaries to the stated task scope.

Example requests:

- “Plan a new endpoint in learning mode; inspect its contract and propose a design.”
- “Use $xuan-backend-change for this approved plan; local code/tests only; no DB runs.”
- “Use $xuan-debug on these sanitized symptoms; diagnosis only, no live operations.”
- “Prepare a migration/release approval packet with $xuan-database-release.”

Use the trivial fast path only when workflow §2 applies. Small nontrivial changes
still need the bounded design approval in §1. New capabilities/boundaries use the
existing spec/plan locations and lifecycle; no Superpowers installation is needed
to carry out design, planning, RED/GREEN, review and verification procedures.

## Skill entrypoints

Native Skills are instruction-only folders under `.agents/skills/`, each with YAML
`name` and `description` in `SKILL.md`. Metadata supports selection; the body is
read on use. Invoke by `$name` or request the corresponding workflow in plain
language. Optional UI YAML and repository Codex config are unnecessary here.

| Skill | Load when | Canonical procedure adapted |
| --- | --- | --- |
| `xuan-backend-change` | Planning/implementing capabilities, TDD and consumer contracts | workflow §§1, 7, 11–13; Claude feature recipe |
| `xuan-debug` | Failures/incidents and regression-first fixes | workflow §11 Bugs and evidence-first diagnosis |
| `xuan-backend-review` | Architecture/security review or explicitly independent whole-branch review | workflow §12 and Claude architecture-review recipe |
| `xuan-database-release` | Any schema work or release-readiness preparation | database practice/map, Claude database recipe, workflow §§8–10 |

No separate TDD, auth, contract or Git micro-Skills: those are integrated at their
actual checkpoints. Before Git topology decisions read workflow §9 and the existing
Claude branch-cohesion recipe. Its Claude-specific merge grant is excluded.

## Verification checkpoints

The inspected stack is Node 24, Yarn 4.18.1 (`.yarnrc.yml` uses the committed CJS
release and node-modules), NestJS 12 ESM, TS 6.0.2, TypeORM 1.1.x, Zod 4,
PostgreSQL 18, Vitest 4/supertest. Use `package.json` as the live script inventory.
No frontend build/design tooling applies.

During implementation, use focused tests. Pure logic uses colocated `*.spec.ts`;
endpoint outcomes, translated constraints and contract/platform behavior use
`test/**/*.e2e-spec.ts` against real PostgreSQL, exact response bodies and the same
`configureApp()`. OpenAPI builds in `test/openapi.e2e-spec.ts` through
`src/http/openapi/setup-open-api.ts`. There is no separate controller, integration,
API-contract, auth or migration script: these concerns live in unit/e2e tests and
the explicit migration procedure. Google is replaced by the harness fake; other
providers require appropriate isolated mocks/fakes, never live side effects.

Observe RED at the appropriate behavior boundary, then GREEN. Mocked repository
CRUD tests do not establish database constraints. Use workflow §§10–13 at completion:
`yarn lint`, `yarn typecheck`, `yarn test`, authorized `yarn test:e2e`, plus relevant
OpenAPI and migration evidence; release adds `yarn build`. `yarn format:check` is
available for source/test formatting. Workflow §10 describes intended CI gates;
no `.github` CI configuration was found. Do not claim they run remotely.

`yarn test:e2e` is mutating: preflight → migrations → serial Vitest; cleanup truncates
application tables. Exact permission and positively isolated test target are needed
before execution. The guard checks configured identity, connected identity and
cleanup, not just `NODE_ENV`. Never bypass it or experiment on Neon Production.
Yarn 4 executes package scripts through its portable shell, so run `yarn test:e2e`
directly from PowerShell once authorized. Do not manually decompose the script,
run its migration/test steps separately, or rewrite it as a shell workaround;
preserve the guarded preflight → migrations → tests sequence.

Store compact evidence: command, relevant source ref/uncommitted scope, environment
class (no credentials), observed result, RED/GREEN where needed and omissions.
Reuse still-valid evidence; changes that invalidate it require renewed checks.
Implementer-reported results are leads, not independently verified evidence. A
reviewer may rely on output it directly observed or raw logs/artifacts it
independently inspected for the reviewed state. Other claims remain Unverified.
Unrun mandatory gates mean incomplete verification, even if unit tests pass.
For workflow-only edits use metadata/path/diff checks; database suites add no useful
proof; do not run them merely to validate documentation.

## Delegation and independent review

Use subagents only when requested by the owner or applicable instructions and when
independence offsets coordination cost. Bound each task by question, domain, input
refs, expected evidence, permitted tools and explicit read/write ownership. Contract,
database, auth/security and test analysis can run independently read-only; dependency
chains and shared-file edits should remain sequential. Agents share this workspace,
so allocate disjoint write paths or use separately authorized isolation. Do not
parallelize database-mutating suites. Sensitive work favors read-only review with
sanitized evidence. Prefer runtime-enforced read-only sandboxing where available;
otherwise disclose that read-only is an instruction, not enforcement. Primary
agent integrates, resolves findings and verifies.
Delegation never expands Git, database, production or external-service permission.

For genuinely independent whole-branch review, start without implementer chat history
(for example, `fork_turns: "none"` where supported), and give only this bounded packet:

```text
Task brief and explicit exclusions:
Approved design/implementation plan (paths and approval evidence):
Base ref + resolved SHA; head ref + resolved SHA:
Changed-file inventory and exact uncommitted/untracked overlay, if any:
Governance: AGENTS.md, code-rules.md, workflow §§7–13, affected domain docs:
Verification: commands/results, source state, environment class, omissions;
  distinguish implementer claims from directly observed output or inspected raw artifacts:
Reviewer scope: read actual whole diff, surrounding source and relevant tests;
  independently test conclusions; read-only unless separately authorized.
Return: severity, path/line, rule/risk, evidence, unverified items and verdict.
```

Do not send the implementer's conclusions as facts or fork the implementer's full
conversation and call it independent. Record the context mode, refs and scope actually
reviewed. Re-verify context isolation for each review; a prior session's capability
probe does not guarantee it in the current runtime. If fresh separation is
unavailable/unproven, require a
separate Codex session or Claude Code review. A self-review remains useful and must
be labeled.

## Contract and operational boundaries

Backend changes affect independently deployed xuan-web consumers. Follow workflow
§7 and API contract §§0, 6, 9: coordinate request/response identities, error codes,
envelopes, authorization, compatibility and expand/migrate/contract sequencing.
Provide the frontend owner a producer ref, explicit delta, compatibility order,
verification and paired policy changes. Consumer snapshot/type generation occurs
in its own authorized PR. Neither this guide nor a backend task permits editing it.

Schema work follows the approved physical map before entity edits, reviewed SQL,
target-specific approvals, run/inspect/revert/re-run when reversible and empty second
generate. See the database Skill. Never infer Codex permission from the expired
blog exception. Do not read secret env files to identify targets; use approved,
redacted target attestations and the documented guards. Missing permission blocks
execution, not independent design or review.

Existing release topology is `dev` → PR → `main`; merges use merge commits and keep
branches. Repository docs do not provide a complete production deployment/rollback
runbook. Before a future release obtain owner-approved target/operator, pre-release
deployment ref, compatibility sequence, migration/backup recovery plan, verification,
observability/error checks, rollback criteria and observation window. No provider
command or production readiness is implied by this adapter.

Application deployment rollback does not reverse database migrations, payments,
emails or other external side effects. Compensation/database recovery need explicit
approval; never rewrite migration history or perform destructive recovery unapproved.

## Git preparation and cooperation

Workflow §9 is unchanged: latest merged `dev` → one cohesive task branch → PR to
`dev`; release only `dev` → `main`; no stacks, automatic deletion or alternative
hotfix model. Keep code/tests/docs/schema/OpenAPI/plumbing for the same outcome
together. Preserve branches after merge. Never force-push shared history or bypass
protection. Git operations require authorization for the current Codex task.

For future authorized Git changes, inspect status first, identify exact task-owned
paths, preserve unrelated work, stage explicit safe file paths only, and inspect
`git diff --cached` before any separately authorized commit. Never use broad staging
or include env files, secrets, dumps, logs or customer data. Draft the §9.3 PR body
locally with unchecked unrun gates. Publication needs a Codex-specific owner grant.

Claude and Codex share canonical docs and existing plans; hand off refs, scope,
decisions, approvals, findings and evidence rather than competing policies. Do not
edit Claude instructions/Skills to make Codex work. Propose agent-neutral governance
amendments separately for owner approval before applying them.

## Runtime checks and limits

Check actual client/runtime capabilities rather than inferring them from an
installed CLI version. Verify fresh-context support for each independent review;
context separation does not establish filesystem isolation or a read-only sandbox.

- [Official Skill documentation](https://learn.chatgpt.com/docs/build-skills)
  documents `.agents/skills` discovery and metadata/body loading. Static validation
  checks layout/metadata, not actual discovery. If a Skill is absent from the
  selector, restart Codex and explicitly open the Skill path; do not
  claim loading succeeded merely because a file exists.
- [Official subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents)
  describes client-specific delegation. Recheck actual tools in future sessions;
  do not install global/repository configuration to assume support.
- Add no third-party Superpowers implementation without a concrete verified gap
  and owner approval. Repository config needs a verified necessity and supported
  syntax; do not change global Codex configuration as part of repository setup.
