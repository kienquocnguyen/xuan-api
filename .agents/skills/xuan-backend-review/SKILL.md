---
name: xuan-backend-review
description: Review xuan-api architecture, authorization, tests and whole-branch quality before claiming completion or preparing a PR. Use fresh-context independent review when whole-branch independence is required.
---

# Backend review

Paths are repository-root-relative. Read `docs/code-rules.md`, workflow
§§9–13 in `docs/development-workflow.md`, the relevant architecture/contract/database
sections, and `.claude/skills/xuan-api-architecture-review/SKILL.md` for the existing
search leads, severity and report format. Docs win; this Skill grants no mutations.

1. State review mode: implementer self-review, owner-code review, or fresh-context
   independent whole-branch review. Independence requires no implementer conversation
   history. Use the bounded packet in `docs/codex-workflow.md`; if unavailable, require
   a separate Codex session or Claude review. Re-verify context isolation for each
   review; the no-history capability observed in one session on 2026-10-30 does not
   guarantee it across runtimes. Prefer runtime-enforced read-only sandboxing where
   available; otherwise state that read-only is an instruction, not enforcement.
   Never rename self-review as independent.
2. Verify base/head and changed-file inventory against actual Git state. Include
   uncommitted/untracked task files explicitly; committed refs do not contain them.
   Review the whole outcome, not just the last fix. Read source diff, surrounding
   callers/callees, tests and approved design yourself before accepting conclusions.
3. Apply the canonical architecture-review searches as leads. Check module ownership
   and dependency direction, controller/service responsibilities, input validation,
   mass assignment, DTO mapping, error definitions/envelopes, component identities,
   transaction manager use, migration/map consistency and external gateways.
4. For security-sensitive surfaces trace anonymous, authenticated, wrong-role,
   wrong-owner and permitted requests; check CSRF/CORS, session revocation and cookie
   semantics, no leaked fields/logs, provider failure paths and rate limits where
   relevant. Read guards and service predicates, not decorators alone. Use existing
   auth/provider fakes; never call real providers or access secrets for review.
5. Assess cohesion, coupling, complexity, reuse, readability, testability, security
   boundaries and change frequency. Neither file length nor more abstractions proves
   quality. Report maintainability concerns with a concrete failure/change cost.
6. Inspect verification evidence for the actual reviewed state. Implementer-reported
   test results are leads, not independently verified evidence. Rely on output you
   directly observed or raw logs/artifacts you independently inspected; other claims
   remain Unverified. Reuse valid evidence instead of duplicating full suites.
   Run additional safe focused checks
   when a gap warrants them; mutating tests need explicit approval, guarded isolated
   target and serialized execution. Missing evidence stays Unverified.
7. Report path/line, rule, demonstrated risk and suggested correction. Use canonical
   severities: Blocker, Must justify, Major, Nit, Question; use the canonical verdict
   and Unverified semantics, never turn an unrun check into PASS. Also flag general
   correctness/security defects with their evidence. Reconcile Critical/blocking
   Important general-review findings before any authorized merge; do not assume
   severity names from the two review systems are interchangeable.

Return findings to the primary agent; the primary integrates and verifies fixes.
The reviewer owns no publication, database or production authority. Re-review
material fixes and identify which earlier evidence remains applicable.
