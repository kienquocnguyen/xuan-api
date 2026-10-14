---
name: xuan-git-branch-cohesion
description: Use when about to create, split, stack or delete a xuan-api branch, cherry-pick, rebase, port work from an old or WIP branch, or decide whether docs, tests, migrations, seeds or support plumbing belong on the current branch - including when the next task depends on a PR that is not merged yet.
---

# Keeping a xuan-api branch to one mergeable outcome

## Overview

`docs/development-workflow.md` §9 owns branch, commit and PR naming. This skill decides **where work goes**.

**One branch = one mergeable outcome, and branches are cut only from an up-to-date `dev`.** The cycle is: finish → review → merge → update `dev` → branch again. History stays atomic through scoped commits *inside* the branch, not through extra branches.

## Where does this change go?

| The change | Goes |
|---|---|
| The outcome needs it to be complete, verified or documented: docs, tests, migration, seed, module wiring, a test-helper tweak, a platform fix the outcome exercises | **Current branch**, as its own scoped commit (`docs(database): …`, `fix(http): …`) |
| Unrelated to the outcome (a typo elsewhere, an idea, a different module's bug) | **Ledger / note it**. Fix it on a branch cut from `dev` *after* this outcome merges |
| A useful piece of an old or WIP branch | Read it (`git show <sha>:<path>`), then **re-type it once** on the current branch against today's platform. The old branch stays untouched as a reference until the replacement has merged |

## When is a new branch legitimate?

Only when **all** of these are true:
- the previous outcome's PR is **merged** into `dev`;
- local `dev` has been updated from `origin/dev`;
- the new work is an independent mergeable outcome.

If the next outcome depends on an unmerged PR, **do not stack.** Close that PR first: get it through review and merge it, since merging into `dev` is delegated when its conditions hold (`development-workflow.md` §3.5). If the merge is blocked on the owner, use the time for work that doesn't need a branch: read-only inspection, reading the plan, drafting the next physical map in the ledger. Then branch from the updated `dev`.

## Never

- A branch cut from another unmerged task branch, or a PR based on one.
- `rebase --onto`, force-push chains, or "rebase after every upstream change" to keep stacked branches alive.
- Cherry-picking a WIP commit wholesale, or merging or rebasing an old branch to "not lose" it.
- Separate `docs/`, `chore/` or `test/` branches for pieces of the current outcome.
- Deleting a reference branch before its replacement has merged.

## Rationalizations

| Excuse | Reality |
|---|---|
| "Don't sit idle, so stack on the open PR" | Merging is delegated. Finish the open PR; the idle time is shorter than a rebase chain |
| "Starting from `dev` won't compile" | Then the dependency isn't merged yet. Merge it first |
| "Rebasing is mechanical" | Every rebase re-runs verification and risks conflicts. A stack multiplies both |
| "Cherry-picking keeps the history" | It imports obsolete plumbing. Port the useful parts once |
| "A docs branch keeps things atomic" | Scoped commits are atomic. A docs PR would describe unmerged code |

## Red flags: stop and re-read this skill

- `git switch -c` while `HEAD` isn't freshly updated `dev`
- A PR base other than `dev` (or `main` for a release)
- `--force-with-lease`, `rebase --onto` or `cherry-pick` in your plan
- "stacked on #N, do not merge before it"
