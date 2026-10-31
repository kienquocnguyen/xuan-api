---
name: xuan-debug
description: Diagnose xuan-api failures using layer evidence and falsifiable experiments, then regression-first fixes when authorized. Use for failing tests or API incidents.
---

# Systematic backend debugging

Paths are repository-root-relative. Authority: `docs/development-workflow.md`
§§1–3, 11–14; `docs/code-rules.md`; affected sections of `docs/architecture.md`,
`docs/api-contract.md` and `docs/database.md`. Codex permissions and verification
mechanics are in `AGENTS.md` and `docs/codex-workflow.md`.

1. State the symptom, expected behavior, affected version and safe reproduction.
   Check the contract/product expectation first: documented behavior may need an
   owner decision rather than a bug fix. Production incidents authorize no writes
   by implication. Request sanitized logs/request ids/statuses rather than tokens,
   cookies, connection strings or customer records.
2. Gather a timeline and trace request → validation → guards → controller → service
   → persistence/transaction → response translation. Explicitly classify evidence
   among contract, validation, authentication/authorization, application service,
   database/transaction, caching (if actually present), runtime config, deployment,
   external provider/infrastructure, and expected product behavior. Do not assume
   a cache or service exists. Distinguish wrong configuration from wrong code.
3. Write one falsifiable hypothesis: predicted observation, smallest safe experiment,
   success/failure meaning and stopping boundary. Prefer local synthetic inputs and
   existing provider fakes. Never experiment on Neon Production or real customer
   data, replay payments/emails, run unsafe endpoints, or read secrets to reproduce.
   Live inspection beyond supplied evidence needs explicit authorized access.
4. Observe the experiment. Contradictory evidence means revisit the failing layer
   and hypothesis; do not stack speculative patches. Record what ruled alternatives
   out and what remains unknown. Deployment/provider fixes may need owner action.
5. When a code fix is authorized, use workflow §11's regression boundary. Observe
   the regression fail (RED) for the identified cause; implement the smallest
   justified fix; observe GREEN. Reproduction blocked by database permission means
   report the missing evidence, not waive the regression requirement.
6. Use `$xuan-backend-change` for contract/schema effects and `$xuan-backend-review`
   before claiming done. Run focused tests then required checkpoint gates; preserve
   external mocks, security and test guards. Report source/ref, observations,
   remaining uncertainty and approvals needed. No deployment or Git publication is
   implied by a successful local diagnosis.
