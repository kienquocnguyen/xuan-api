---
name: xuan-git-branch-cohesion
description: Use when about to create, split, stack, merge, finish, clean up or delete a xuan-api branch, cherry-pick, rebase, force-push, choose a PR base, port work from an old or WIP branch, or decide whether docs, tests, migrations, seeds or support plumbing belong on the current branch - including when the next task depends on a PR that is not merged yet, or a Superpowers skill offers to delete a branch after merge.
---

# Keeping a xuan-api branch to one mergeable outcome

## Overview

`docs/development-workflow.md` §9 owns the canonical Git flow and naming. This skill decides **where work goes** and stops you from improvising.

**The owner's Git flow is final.** Follow it exactly. Never invent an alternative strategy (stacks, GitFlow hotfix/release branches, cleanup routines). If a task seems to need a different topology, **stop and ask the owner.**

```text
Feature:  dev → feat/* → PR → dev → KEEP branch
Bug:      dev → fix/*  → PR → dev → KEEP branch
Release:  dev → PR → main → production
```

1. Normal feature/fix branches start from the **latest `dev`** (updated from `origin/dev`).
2. **One branch = one cohesive mergeable outcome**, not one file category.
3. Implementation, tests, docs, migrations, seeds, OpenAPI, config and plumbing for that outcome stay **on the same branch** as scoped commits.
4. Feature/fix (and chore/refactor/docs/test) PRs target `dev`.
5. Production release is `dev` → PR → `main`. Nothing else merges into `main`.

## Merge does not mean delete

6. Merged branches are **kept, locally and remotely**.
7. Deleting any branch requires the **owner's explicit instruction or approval** of that specific deletion.
8. **No automatic branch cleanup.** Merge permission (`development-workflow.md` §3.5) never includes deleting the source branch.
9. Retained labels are intentional: the owner uses SourceTree to see which commits belonged to which feature, compare implementations, debug regressions and onboard developers. A short branch list is not a goal.

When `superpowers:finishing-a-development-branch` (or any skill) says `git branch -d`, `git branch -D`, `git push origin --delete` or `gh pr merge --delete-branch`: **skip that step.** Project rules override it. Worktree removal is fine; the branch stays.

## Where does this change go?

| The change | Goes |
|---|---|
| The outcome needs it to be complete, verified or documented: docs, tests, migration, seed, module wiring, a test-helper tweak, a platform fix the outcome exercises | **Current branch**, as its own scoped commit (`docs(database): …`, `fix(http): …`) |
| Unrelated to the outcome (a typo elsewhere, an idea, a different module's bug) | **Ledger / note it**. Fix it on a branch cut from `dev` *after* this outcome merges |
| A useful piece of an old or WIP branch | Read it (`git show <sha>:<path>`), then **re-type it once** on the current branch against today's platform. The old branch stays untouched |

## When is a new branch legitimate?

Only when **all** of these are true:
- the previous outcome's PR is **merged** into `dev`;
- local `dev` has been updated from `origin/dev`;
- the new work is an independent mergeable outcome.

If the next outcome depends on an unmerged PR, **do not stack.** Close that PR first: get it through review and merge it (delegated when its conditions hold). If the merge is blocked on the owner, do work that doesn't need a branch: read-only inspection, reading the plan, drafting the ledger. Then branch from the updated `dev`.

## Exceptional only, with owner approval

10. **Cherry-pick** is a recovery tool (one isolated commit from abandoned work), never normal flow. Ask first unless the owner requested that exact cherry-pick.
11. **Rebase is not a substitute for bad topology.** No `rebase`, `rebase --onto`, cherry-pick or force-push to keep stacks alive or repair avoidable splits. A history-rewriting rebase needs approval.
12. **Force-push:** never `main`, `dev` or shared branches; never routine. Any history rewrite needs approval. No direct pushes to `dev` or `main`.
13. **No hotfix flow exists.** Don't assume `hotfix/*`, `release/*` or back-merges; ask.

## Never

- A branch cut from another unmerged feature/fix/WIP branch, or a PR based on one.
- Separate `docs/`, `chore/`, `test/` or `db/` branches for pieces of the current outcome.
- Deleting a merged (or any) branch, locally or remotely, without the owner's explicit instruction.
- Recreating a branch that was already deleted, unless the owner asks.

## Rationalizations

| Excuse | Reality |
|---|---|
| "The branch is merged, so deleting it is standard cleanup" | Here it isn't. Merged branches are kept as history. Only the owner deletes |
| "The finishing skill says to delete it" | Project rules override Superpowers. Skip the deletion step |
| "The owner said clean up / finish the task" | That's not a deletion instruction. Ask if unsure |
| "Don't sit idle, so stack on the open PR" | Merging is delegated. Finish the open PR; the idle time is shorter than a rebase chain |
| "Starting from `dev` won't compile" | Then the dependency isn't merged yet. Merge it first |
| "Rebasing is mechanical" | Every rebase re-runs verification and risks conflicts. A stack multiplies both |
| "Cherry-picking keeps the history" | It imports obsolete plumbing. Port the useful parts once |
| "A docs branch keeps things atomic" | Scoped commits are atomic. A docs PR would describe unmerged code |
| "A different flow would be cleaner here" | The flow is final. Ask the owner instead of inventing one |

## Red flags: stop and re-read this skill

- `git branch -d/-D`, `git push --delete`, `--delete-branch` or "cleanup" anywhere in your plan
- `git switch -c` while `HEAD` isn't freshly updated `dev`
- A PR base other than `dev` (or `main` for a `dev` release PR)
- `--force`, `--force-with-lease`, `rebase --onto` or `cherry-pick` in your plan
- "stacked on #N, do not merge before it"
