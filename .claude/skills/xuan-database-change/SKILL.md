---
name: xuan-database-change
description: Use when a xuan-api task creates or changes database schema - a new table, column, constraint, index, foreign key, default, backfill or data migration, a TypeORM entity change, migration:generate/run/revert, or a schema-only task with no endpoint.
---

# Changing the xuan-api database schema

## Overview

`docs/database.md` holds the rules and reasons. Cite rule IDs from `docs/code-rules.md`; never restate them. This skill is the **order of work**.

**The physical map is the design, not the paperwork.** `database.md` §12 is written **before** the entity or migration, then the database is checked against it.

## Mode

Learning or delegated, as in `development-workflow.md` §3:
- **Learning mode:** the owner edits the entity and runs `migration:generate/run/revert`. You review the map, the SQL and the `psql` output.
- **Delegated mode:** you run them yourself.

## Workflow

1. **Invariant first.** State in one line what must always be true ("a slug is unique and lowercase"). Each invariant becomes a constraint (D31).
2. **Design the map** (`database.md` §12):
   - every column with its PostgreSQL type, required/nullable and default;
   - PK, FK, UQ, CK and IX, each with its explicit name (D24–D30);
   - a short note per key or constraint saying why it exists;
   - a Mermaid block and the table map;
   - status *decided*.

   If business concepts or relationships change, update `data-model.md` too.
3. **Checkpoint.** A new table, or any change in learning mode: **stop and get the owner's approval of the map** before touching the entity. Never invent columns the plan hasn't settled.
4. **Live data?** A change that breaks existing rows or running code (`NOT NULL` on a populated table, renames, type changes, drops) → plan expand → migrate → contract (C10). Irreversible → document roll-forward instead of `down()` (C9).
5. **Entity:** names and types exactly as in the map; constraints named in decorators (`@Unique('uq_…')`, `@Check('ck_…')`, `primaryKeyConstraintName`).
6. **`migration:generate`, then READ the SQL** (D33) against the map:
   - names match, no `PK_`/`UQ_` hashes (D25);
   - `timestamptz`, not `TIMESTAMP` (D28);
   - defaults (`uuidv7()`, `now()`);
   - CHECKs present;
   - one logical change;
   - meaningful `down()` (D34).

   Wrong? Fix the entity and regenerate. Rewrite a migration only if it has never run anywhere.
7. **Run, then inspect:** `migration:run`, then `\d+ <table>` in `psql`. It must match the map column by column (`database.md` §11).
8. **Reversible?** `migration:revert`, `\d+` again, `migration:run` again. Always while learning.
9. **Generate again.** The second `migration:generate` must be empty.
10. **Prove it:** e2e on `xuan_test` for each invariant that has behavior (I21 guard), e.g. a translated constraint (`database.md` §9).
11. **Close:** map status *implemented*; workflow §8 and DoD §13 are satisfied. Return to `xuan-api-feature` if the task continues.

## Quick reference

| Check | Command |
|---|---|
| Tables / one table | `\dt` · `\d+ <table>` (inside `docker compose exec db psql -U xuan_app xuan_dev`) |
| Applied migrations | `SELECT * FROM migrations;` |
| Server version (`uuidv7()` needs 18) | `SELECT version();` |

## Common mistakes

| Mistake | Instead |
|---|---|
| Updating `database.md` §12 after `migration:run` | The map comes first and is approved; the database is checked against it |
| Entity first, "we'll see what TypeORM generates" | The map decides; the generated SQL is checked against it |
| Accepting hashed `PK_…`/`UQ_…` names | Name them in the entity, regenerate |
| Hand-editing the SQL only | The entity must agree, or the next generate shows a diff |
| `synchronize: true` "just locally" | Never (I7). Debug the migration instead |
| `ADD … NOT NULL` on a populated table | Nullable → backfill → `SET NOT NULL` (C10) |
| Adding columns "the future slice will need" | Only what the plan settled |
