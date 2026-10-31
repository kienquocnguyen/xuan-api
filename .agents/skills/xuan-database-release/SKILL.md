---
name: xuan-database-release
description: Prepare xuan-api PostgreSQL schema changes or production release readiness packets with migration and rollback safeguards. Preparation never grants execution authority.
---

# Database and release safety

Paths are repository-root-relative. Read `AGENTS.md`, `docs/codex-workflow.md`,
`docs/database.md` (practice and §12 map), `docs/data-model.md` where concepts change,
`docs/api-contract.md` §9, and `docs/development-workflow.md` §§3.5, 8–13.
Adapt `.claude/skills/xuan-database-change/SKILL.md` for schema procedure only.
Read `.claude/skills/xuan-git-branch-cohesion/SKILL.md` before topology decisions.

TypeORM `migration:show` may create the migrations table; it is not guaranteed
read-only. Do not execute it on a protected target without the appropriate owner
approval. A command that displays migration status still requires this safety check.

## Schema preparation

1. State business invariants and design the physical map before entity/migration
   edits: types, nullability, defaults, named PK/FK/UQ/CK/indexes and reasons,
   diagram, status decided. Update concepts only when needed. Get the documented
   map approval before a new table or any learning-mode entity change (Checkpoint M).
2. Plan compatibility and C9/C10 recovery: expand → migrate → contract for changes
   that break rows or running code. Never weaken a constraint to evade approval.
3. With implementation authorization, align entity and map. Generating a migration
   requires its own documented permission and verified target; it is not a harmless
   offline check. Read every generated SQL statement against the map. Never rewrite
   merged/applied migrations, use synchronize, or enable boot-time migrations.
4. Prepare the exact execution packet: environment/target identity without secrets,
   pending migrations, reviewed SQL, backup/restore evidence required for the target,
   expected schema/data effects, reversibility and stop conditions. No Codex database
   grant is inherited from Claude or the expired B1–B4 exception.
5. Only after exact approval, verify the isolated test target and preflight before
   mutations. Observe run → inspect (`psql`) → revert/re-run when safely reversible
   → empty second generate, plus real-database tests for behavioral constraints.
   Guard configured and connected identity; `NODE_ENV=test` alone proves nothing.
   Never bypass the guarded harness or use Neon Production for experiments.
6. Mark implemented only with observed matching schema; record all unrun steps.
   Any unexpected target, SQL effect or failure stops execution for owner direction.

## Release readiness preparation

1. Follow the existing `dev` → `main` release PR, merge-commit and retained-branch
   model. Capture proposed refs, approved scope and the pre-release application
   deployment reference. Codex needs separate publication and deployment approval.
2. Collect workflow §§10–13 gates (release adds build), architecture and independent
   whole-branch review, contract/schema compatibility, pending migrations, frontend
   coordination and backward-compatible deployment order. Unit success is insufficient.
3. Prepare owner-approved checks for deployment health, error rates/logs, contract,
   auth and key user flows; specify observation window, success/failure criteria,
   accountable operator and stop/rollback decision. Do not invent provider commands
   or describe an untested production runbook as established repository practice.
4. Record safe application rollback to the captured deployment reference and when a
   correction/revert PR is safer. Application deployment rollback does not reverse
   database migrations, payments, emails or other external side effects. Database
   recovery and external compensation need explicit design and approval. Never
   rewrite migration history or perform destructive recovery unapproved.
5. Report missing release/rollback infrastructure or evidence as a gap. Preparation
   is allowed within scope; migration, production changes and deployment stop at
   their respective owner approval boundaries.
