---
name: xuan-api-feature
description: Use when adding, changing or fixing a backend capability in xuan-api - an endpoint, controller, service/provider, entity, request schema, response DTO, error definition, OpenAPI decorator, cross-module call, or the tests for any of these - in learning-first or delegated mode.
---

# Building a xuan-api capability

## Overview

Rules and their reasons live in `docs/`. Cite rule IDs from `docs/code-rules.md`; never restate rules. This skill is the **order of work**. Superpowers drives process (brainstorming, plans, TDD, debugging); this skill decides *where code goes, what shape it has and which test proves it*.

**Tests belong to the task, not to a later sitting.** A capability without its test at the `docs/development-workflow.md` §11 level isn't done, whatever the deadline.

## Mode first

| Signal | Mode | You |
|---|---|---|
| Task tagged `[learn]`, or no explicit delegation | **Learning** (`development-workflow.md` §3) | Explain the step, give the command or a small code shape, **wait**, then review. Reading and safe checks only (§3.2) |
| Owner explicitly delegated this task or task class | **Delegated** | Implement the steps below yourself, including running e2e |

"I'm tired", "make it fast" and "you know best" are **not** delegation. Mode never changes the order of work or what "done" means.

## Workflow

1. **Classify** (`development-workflow.md` §1–§2). Trivial → inspect, implement, verify, stop. Otherwise the plan names this skill, and any DEFAULT deviation or C-rule choice with its reason.
2. **Owner module** (`architecture.md` §3–§6). Code goes in the module that owns the table (I1). Need another module's data? Import its module and call an exported provider (I2). A relation across modules is C12: stop and ask.
3. **Contract** (`api-contract.md`). Find the endpoint's documented behavior and error codes. Missing or different → it's a contract change (workflow §7). A new response field or DTO name is a consumer contract identifier (I19).
4. **Schema impact.** Any new or changed table, column, constraint or index → **REQUIRED SUB-SKILL:** `xuan-database-change`, before the entity is touched.
5. **Tests first** (workflow §11, `superpowers:test-driven-development`). Write the e2e outcome tests (exact body, `toEqual`) and watch them fail. Pure logic → a table-driven unit test.
6. **Request schema** (D7, D8): Zod `strictObject`, `.meta({ id })` (D17).
7. **Service** (D3, D11, I14): use-case logic through `Repository<Entity>`. Failures throw `AppError` with a module or baseline definition (D10).
8. **Controller** (D2, D4, D5, I3): validated input → service → explicit mapping to the response DTO. Return type = the decorator's DTO (D16).
9. **Docs decorators** (D15, I18): `@ApiEnvelopeResponse` / `@ApiNoContentResponse` + `@ApiErrorResponses` from the same definitions you throw.
10. **Verify** (workflow §13): lint, typecheck, unit, e2e, with output observed. In learning mode the owner runs e2e. Then **REQUIRED SUB-SKILL:** `xuan-api-architecture-review`, then `superpowers:verification-before-completion`.
11. **Close:** commit messages and the PR title and body follow `development-workflow.md` §9.2–§9.3. Use that template; don't invent one. A Verification box is ticked only for a check whose output was observed. Anything not run stays unchecked, even if the owner asks to "tick everything".

## Under time pressure

Shrink the scope, never the proof. A sitting may end at **RED**: the test is written and failing, ready for next time. It must never end with behavior that has no test.
- **Learning mode:** cut the session plan to "write the failing test", and leave the implementation for next time.
- **Delegated mode:** an owner request to skip tests is recorded, and the task is reported **not done** (DoD), not "done, tests later".

## Quick reference

| Need | Put it in |
|---|---|
| Table mapping | `modules/<m>/<thing>.entity.ts`; class name may differ from the business word (`ServiceOffering`) |
| Use cases | `modules/<m>/<m>.service.ts` (`ServicesCatalogService`) |
| Request schema + type | `modules/<m>/dto/<verb>-<thing>.dto.ts` |
| Response DTO + mapper | `modules/<m>/dto/<thing>.dto.ts` |
| Module error definitions | `modules/<m>/<m>.errors.ts` (first own code only; baseline `NOT_FOUND` needs none) |
| E2E outcome tests | `test/<m>.e2e-spec.ts` (harness: workflow §11) |

## Common mistakes

| Mistake | Instead |
|---|---|
| "Skip/add the tests after the demo" | Test is part of the task; end at RED if time runs out |
| Manual curl/Postman as the verification | Exploration only; e2e exact body is the proof |
| Returning the entity "because it has no secrets" | I10 + D5 mapping |
| `NotFoundException` "because it's simpler" | `AppError` + baseline definition (I14) |
| `forFeature(OtherModuleEntity)` for a read | Exported provider (I1, I2); C12 for relations |
| Editing the entity before the schema change is designed | `xuan-database-change` first |
| Treating "make it fast" as delegation | Learning mode until explicitly delegated |
