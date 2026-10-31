---
name: xuan-backend-change
description: Plan and implement xuan-api backend capabilities with contract coordination and behavioral tests. Use for endpoint or service changes, not incident diagnosis or release execution.
---

# Backend change

Paths below are repository-root-relative. Read `AGENTS.md` and
`docs/codex-workflow.md` for Codex authorization; canonical process is
`docs/development-workflow.md` §§1–3, 7, 9, 11–13, and rule wording is
`docs/code-rules.md`. Adapt the procedure in
`.claude/skills/xuan-api-feature/SKILL.md` without importing Claude grants or
requiring unavailable Superpowers tools.

1. Classify the outcome and confirm learning versus explicit Codex delegation.
   Trivial work takes §2. Otherwise get the required design approval: short chat
   design for small changes; a spec and plan for capabilities/boundary changes.
   Use existing spec/plan locations, not a competing planning system. Plan tasks
   name their Skill, verification and justified D/C choices; learning tasks use §3.3.
2. Inspect the owning module and its neighbors against `docs/architecture.md`
   §§3–9. Identify controller, service, repository, DTO, guard, transaction and
   integration responsibilities. New layers need a concrete problem. Cross-module
   ORM relations require the C12 owner decision, not a convenient entity import.
3. Compare intended behavior with `docs/api-contract.md` §§0, 6–10 and workflow §7.
   Inventory routes, request schemas/component ids, response DTO identities,
   envelopes, stable errors, auth/ownership, compatibility and consumer impact.
   A mismatch is an explicit contract defect. Schema impact invokes
   `$xuan-database-release` before entity edits.
4. Use workflow §11's cheapest sufficient behavioral boundary. Pure logic gets
   table-driven unit tests; endpoint/constraint outcomes get real HTTP/PostgreSQL
   exact-body e2e; OpenAPI gets the document-build test. Do not substitute mocked
   CRUD/controller tests for these guarantees. Observe RED for the intended reason,
   implement the smallest complete outcome, observe GREEN, then refactor.
   Mutating suites stop for exact authorization and test-target safeguards.
5. Implement with established local shapes: validated Zod input, service use case,
   module-owned persistence, explicit response mapping, shared error definitions
   and matching OpenAPI decorators. Check denial/error paths, resource ownership,
   transaction manager use, safe logs and external-provider fakes.
6. Run focused checks during work, then the applicable mandatory gates in workflow
   §§10–13. Reuse still-valid evidence; record commands, source ref/diff, environment
   class, result and omissions without secrets. Invoke `$xuan-backend-review`.
7. For a contract handoff, give the frontend owner the approved producer ref,
   endpoints/components/error and auth deltas, compatibility/deployment sequence,
   test evidence, and any paired policy changes. Frontend snapshot pull/generation
   happens in its separately authorized PR; do not edit xuan-web here.
8. Prepare local PR text using workflow §9.3 and report unverified gates. Git
   publication and database/deployment permissions are separate from implementation.
   A blocked operation does not prevent independent authorized preparation.
