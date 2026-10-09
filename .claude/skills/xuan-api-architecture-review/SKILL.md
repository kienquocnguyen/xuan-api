---
name: xuan-api-architecture-review
description: Use when reviewing xuan-api code, a diff or a branch, before claiming a xuan-api task is complete, before opening a PR, when the owner asks for a review of code they wrote, or when asked whether code follows the backend architecture, database rules or testing strategy.
---

# xuan-api architecture review

## Overview

This checks a change against `docs/code-rules.md`: **evidence first, then judgment.** It runs alongside `superpowers:requesting-code-review`, which covers general quality.

**A search hit is a lead, not a verdict.** Open the file and read the surrounding code before reporting. If a finding depends on intent, it's a Question. If no rule covers it, it's a Question for the owner. Never invent a rule.

## Procedure

1. **Scope.** Pick the base:
   - a base or file list you were given;
   - else the PR target (`gh pr view --json baseRefName -q .baseRefName`);
   - else `dev` for a task branch, or `main` for a `dev` → `main` release.

   Collect `git diff --name-only <base>...HEAD` plus uncommitted changes. **Before the Git baseline exists**, the scope is the uncommitted files, or the diff you were shown. Read the plan or PR for stated DEFAULT deviations and C-rule choices; none stated means unstated.
2. **Checks.** Run whichever exist: `yarn lint`, `yarn typecheck`, `yarn test`. Run `yarn test:e2e` only in delegated mode. **In learning mode, only safe checks run** (`development-workflow.md` §3.2), and e2e output comes from the owner. A boundary-lint failure is an INVARIANT finding.
3. **Searches** over the changed files (below). Read every hit in context.
4. **Read each changed file** against the I, D and C rules.
5. **Completeness:**

   | Change touched | Requires |
   |---|---|
   | A route | Its outcome tests at the workflow §11 level; `@ApiEnvelopeResponse`/`@ApiNoContentResponse` + `@ApiErrorResponses` |
   | `src/database/migrations/` | `docs/database.md` §12 changed in the same diff (and `data-model.md` if concepts changed) |
   | Contract | The contract docs (workflow §7) |
6. **Report** in the format below.

```bash
rg -n "process\.env" src -g "!src/config/**"                                              # I4
rg -n "forFeature\(" src/modules                                                          # I1: entity owned by this module?
rg -n "from '.*modules/" src/config src/errors src/database src/http                       # I2
rg -n "from '.*database/" src/http                                                        # I2
rg -n "InjectRepository|DataSource" src/modules -g "*.controller.ts"                       # I3
rg -n "synchronize|migrationsRun" src                                                     # I7
rg -n "\.transaction\(" src                                                               # I8: read the callback
rg -n "\.(save|insert|update|create|merge)\(" src/modules                                 # I9, D36: input passed wholesale?
rg -n "@Exclude|ClassSerializerInterceptor|plainToInstance" src                           # I10
rg -n "Exception\(" src/modules                                                           # I14
rg -n "eager:|lazy:" src                                                                  # D37
rg -n "orIgnore\(|ON CONFLICT DO NOTHING" src                                             # D32
rg -n "z\.object\(" src/modules                                                           # D8: strictObject?
rg -n "origin:\s*(true|'\*'|\"\*\")" src                                                  # I20
rg -n "\"(PK|UQ|FK|IDX|CHK|REL)_[0-9a-f]|TIMESTAMP NOT NULL|TIMESTAMP DEFAULT" src/database/migrations   # D25, D28
rg -n "TRUNCATE" test                                                                     # I21: guarded?
rg -n "toMatchObject" test                                                                # D40: exact body?
```

## Severity

| Finding | Severity | Blocks? |
|---|---|---|
| INVARIANT violated | **Blocker** | Yes |
| DEFAULT deviated, or C-rule chosen, without a stated reason | **Must justify** | Until a reason is recorded or the code changes |
| DEFAULT deviated with a stated, sound reason | Note | No |
| Missing tests for behavior; failing checks; migration without the §12 map update | **Major** | Yes |
| PREFERENCE; tests with no behavior | Nit | No |
| Depends on intent, or no rule covers it | **Question** (name the suspected rule, or "no rule") | Until answered |

One defect hit by several rules is one finding listing every ID. Split only when the fixes differ.

**The fix must be the one the docs prescribe, not a new invention.** For example, a missing "not found" error uses the baseline `NOT_FOUND` definition from `src/errors/`. A module errors file holds only that module's *own* codes (D10). Check `architecture.md` / `api-contract.md` before proposing a new code or file.

## Report format

```
Verdict: PASS | PASS WITH NOTES | BLOCKED

Scope: <base or file list> · Mode: learning | delegated

Checks run: <command → result>, ...   (or "not available: <why>")

Findings (most severe first):
- [Blocker|Must justify|Major|Nit|Question] <rule IDs> <path:line>: <what is wrong> — why: <risk, one clause> → <fix>

Unverified: <each thing you could not check, and why>
```

- **BLOCKED** if any Blocker, Must justify, Major or open Question blocks.
- **PASS WITH NOTES** if only Notes/Nits, or if any check couldn't run.
- **PASS** needs every check run and observed.

Time pressure doesn't change the verdict. Unverified is never passing. Link the doc section for reasoning instead of restating it.
