# API Contract (xuan-api ⇄ xuan-web)

This document says what `xuan-api` promises to `xuan-web`, seen from the **producer** side.
- §1–§9 are the **shared wire policy**. They mirror `xuan-web/docs/api-contract.md`, and a change to them is a change to both repos.
- §10–§12 are producer-only: our obligations, our endpoints, and the pending mirror deltas.
- Rule wording: `code-rules.md`. Implementation mechanism: `architecture.md` §9–§10.

## 0. Contract ownership

| Artifact | Role |
|---|---|
| `xuan-api/docs/api-contract.md` and `xuan-web/docs/api-contract.md` | **Human contract policy.** The shared wire sections stay mirrored and are changed through coordinated, paired work |
| xuan-api's generated OpenAPI document (`GET /docs-json`) | **The authoritative, machine-readable description of the implemented API** |
| `xuan-web/openapi/openapi.json` | **Consumer snapshot**, pulled from xuan-api and committed. xuan-web's generated types derive from it |

- The two Markdown files are not competing runtime truths.
- **When runtime/OpenAPI and Markdown disagree, that's a contract defect**, resolved explicitly by fixing one side deliberately. Never silently pick one and ignore the mismatch.

## 1. Basics

| Item | Value |
|---|---|
| Production API | `https://api.xuancreative.com` |
| Production web | `https://xuancreative.com` |
| Local | web `http://localhost:3000`, API `http://localhost:4000` (same-site: ports don't affect site) |
| Format | JSON request/response bodies (`Content-Type: application/json`). The API parses JSON bodies only |
| Status codes | HTTP status is the protocol-level outcome. Bodies carry no duplicated `statusCode` |
| Safe methods | `GET`/`HEAD` never change state (required by the CSRF model, §8) |
| Versioning | None in phase 1; breaking changes follow §9 |

## 2. Success envelope

```json
{ "data": <T>, "message": "optional human-readable note", "code": "OPTIONAL_SEMANTIC_CODE" }
```

- The consumer unwraps it and uses `data`.
- `message` and `code` on success are informational, and frontend behavior must not depend on them. **The API currently emits `data` only** (D13).
- Endpoints with no payload return **`204 No Content` with an empty body** (I12).

## 3. Pagination

```json
{ "data": { "items": [ ... ], "pageInfo": { "page": 1, "pageSize": 20, "totalItems": 134, "totalPages": 7 } } }
```

- Query params: `page` (1-based), `pageSize`.
- Offset pagination is the default. Cursor pagination is a per-endpoint decision for feeds, if one ever needs it.
- Keeping pagination inside `data` means the envelope stays the same for every endpoint (D14).

## 4. Error envelope

```json
{
  "data": null,
  "error": {
    "code": "EMAIL_ALREADY_EXISTS",
    "message": "This email is already registered.",
    "details": {}
  }
}
```

- `code` is `UPPER_SNAKE_CASE`, stable and machine-readable. Frontend logic branches on `code` (and `status`), never on `message`.
- `message` is user-safe English: no stack traces, SQL, constraint names or internal identifiers (I16). The frontend may show it for known 4xx codes.
- Every error code an endpoint can return is listed in its OpenAPI responses, including `500 INTERNAL_ERROR` (I18).

**Baseline codes:**

| Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Request body/query/params invalid, or the body isn't valid JSON. `details.fields` present |
| 401 | `UNAUTHENTICATED` | No valid session |
| 403 | `FORBIDDEN` | Authenticated but not allowed |
| 404 | `NOT_FOUND` | Resource doesn't exist *or* the caller may not know it exists; also unknown routes |
| 409 | domain-specific, e.g. `EMAIL_ALREADY_EXISTS` | Business conflict |
| 413 | `PAYLOAD_TOO_LARGE` | Request body exceeds the API's size limit |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected. The message is generic |

**Validation details:**

```json
"details": { "fields": [ { "field": "address.city", "message": "City is required.", "code": "REQUIRED" } ] }
```

- `field` is the dot path of the request property (`items.0.name` for arrays), so it maps directly onto React Hook Form field names.
- A body that isn't valid JSON returns `VALIDATION_FAILED` with `fields: []`.

**Field codes** (stable):

| Code | Meaning |
|---|---|
| `REQUIRED` | Value missing |
| `INVALID_TYPE` | Wrong type |
| `INVALID_FORMAT` | Wrong format (email, UUID, …) |
| `TOO_SHORT` / `TOO_LONG` | String length out of range |
| `TOO_SMALL` / `TOO_LARGE` | Number out of range |
| `UNKNOWN_FIELD` | A property the endpoint doesn't accept. One entry per unknown key, at its dot path |
| `INVALID` | Any other rule |

Malformed path identifiers (e.g. a non-UUID `id`) are `VALIDATION_FAILED` with `INVALID_FORMAT`, not 404 (D9).

## 5. Consumer error handling

Consumer-only; see xuan-web's §5. The producer guarantees only that every failure it emits matches §4.

## 6. OpenAPI pipeline

```
xuan-api: Zod request schemas + response DTO classes + @nestjs/swagger
  → GET /docs-json (non-production, or protected)
  → xuan-web: openapi/openapi.json     (committed snapshot; `yarn api:pull`)
  → src/generated/api-schema.ts        (openapi-typescript; `yarn api:generate`)
  → features/*/api/**                  (endpoint functions use the types)
```

**API side:**
- Responses are documented **with the envelope**, through reusable decorators (`@ApiEnvelopeResponse(Dto)`).
- Error responses are documented with the error schema and their possible codes.
- Request schemas are named components (e.g. `Create<Thing>Dto`); response DTOs are named components (e.g. `ServiceDto`).
- **These names are consumer contract identifiers** (I19).

**Web side:**
- The snapshot is committed so contract changes show up as reviewable diffs.
- CI regenerates and fails if `src/generated` differs from the committed output.

## 7. Authentication and cookies

> **Consumer expectation; producer design pending the auth slice.** Nothing in this section is implemented or decided on the API side yet. It's mirrored so the expectation is visible. The auth slice will confirm or change it through §9.

| Endpoint | Purpose |
|---|---|
| `POST /auth/register` | Create account; sets session cookies |
| `POST /auth/login` | Sets session cookies |
| `POST /auth/refresh` | Rotates the refresh token; issues a new access token |
| `POST /auth/logout` | Revokes the refresh token; clears cookies |
| `GET /users/me` | Current user + roles; 401 if no session |

| Cookie | Expected attributes |
|---|---|
| Access token (JWT) | `HttpOnly; Secure; SameSite=Lax; Path=/`; **no `Domain`** (host-only on `api.xuancreative.com`); short-lived (≈15 min) |
| Refresh token | `HttpOnly; Secure; SameSite=Lax; Path=/auth/refresh`; host-only; longer-lived; rotated on every use; revocable server-side |

- Local dev may drop `Secure` when `NODE_ENV=development`, never in production.
- JWT secrets and DB credentials exist only in `xuan-api`'s environment.
- The frontend never reads, stores or decodes tokens.

## 8. CORS and CSRF: defense in depth

**Implemented now (I20, D21):**
- strict CORS allowlist of exact origins, with `credentials: true`;
- allowed headers `Content-Type` and `X-Requested-With`;
- JSON-only body parsing;
- safe methods never mutate.

**Pending the auth slice:** rejecting state-changing requests that lack the custom header, and `Origin`/`Referer` validation.

| Layer | What it does | What it does *not* cover |
|---|---|---|
| `SameSite=Lax` cookies *(auth slice)* | Cookies aren't sent on cross-*site* subrequests | Same-site attackers; top-level GET navigations, which is why GET must be safe |
| Strict CORS allowlist + `credentials: true` | Only listed origins can read responses or send non-simple credentialed requests. No wildcard origin | "Simple" requests are still *sent*, even if their responses can't be read |
| JSON bodies + custom header (`X-Requested-With: XMLHttpRequest`) on state-changing requests *(enforcement: auth slice)* | Forces a CORS preflight | Depends on CORS being correct; nothing against XSS |
| `Origin` validation on state-changing requests *(auth slice)* | Rejects requests from origins outside the allowlist even when the cookie would be sent | XSS on an allowed origin |
| Safe methods never mutate | Makes Lax's top-level-GET allowance harmless | — |
| XSS prevention (sanitized rich content, CSP later) | Protects every layer above | — |

**Revisit with token-based CSRF** if the API ever accepts form-encoded or multipart state-changing requests from browsers, a BFF is introduced, or the cookie scope is broadened.

## 9. Evolving the contract

The repos deploy independently.

**Wire and schema changes** follow **expand → migrate → contract**:
1. **API:** add the new field or endpoint without breaking the old one, then deploy.
2. **Web:** pull the snapshot, regenerate, use the new contract, then deploy.
3. **API:** remove the old shape only once the web no longer uses it.

**Contract identifiers** (I19):
- Response DTO class names, request component ids and error codes change only through an explicit, coordinated contract change.
- Renaming or removing an error code is a breaking API-contract change.
- Renaming an OpenAPI component is breaking for generated consumers.
- Staging (expand → migrate → contract) is used when the underlying wire evolution needs it.

**Markdown policy changes** to §1–§9 are made in both repos as paired work (§0).

## 10. Producer obligations

`xuan-api` guarantees, and enforces through the cited rules:

| Obligation | Rules |
|---|---|
| Every successful payload is `{ data }`; no-content is an empty 204 | I11, I12, D13 |
| Every error is the §4 envelope with a stable code; validation uses `details.fields[]` and the field codes above | I13 |
| Internals never reach the wire | I16 |
| Responses are explicit DTOs, never persistence entities | I10 |
| Every endpoint's possible error codes are in OpenAPI, from the same definitions the runtime throws | I18 |
| Request and response component names and error codes are stable identifiers | I19 |
| CORS exactly as §8 | I20 |
| OpenAPI is served at `/docs-json` when enabled by config (not by default in production) | D20 |
| OpenAPI and runtime agree: exact-body e2e tests and a document-build test guard the drift | `architecture.md` §10 |

## 11. Endpoints

The authoritative list is the OpenAPI document. This table records deliberate behavior that a schema alone doesn't explain.

| Endpoint | Behavior |
|---|---|
| `GET /services` | Public. Returns the Services catalog: the offers shown on Work With Me and the homepage "Ways". No price in V1. The exact fields, ordering and whether the list is paginated are settled in the slice's implementation plan, and then documented in OpenAPI. Errors: `500 INTERNAL_ERROR` |
| `GET /services/:slug` | Public. Returns one service by slug. Errors: `404 NOT_FOUND` for an unknown slug; `500 INTERNAL_ERROR`. Whether the slug's format is validated (and so a `400 VALIDATION_FAILED`) is settled in the slice plan |

No newsletter/subscription endpoint is part of the current contract. That capability needs product confirmation (`data-model.md`).

## 12. Pending xuan-web mirror deltas

This file is ahead of `xuan-web/docs/api-contract.md` on the points below. Under §0, the owner decides when to make the paired xuan-web change. Until then, these are the exact deltas:

| # | xuan-web section | Delta |
|---|---|---|
| 1 | new §0 | Add the contract ownership model (Markdown policy / OpenAPI executable / committed snapshot; a disagreement is a contract defect) |
| 2 | §1 | Note that the API parses JSON bodies only |
| 3 | §2 | Note that the API currently emits `data` only on success |
| 4 | §4 baseline codes | Add `413 PAYLOAD_TOO_LARGE`; 400 also covers invalid JSON; 404 also covers unknown routes |
| 5 | §4 validation details | Add the field-code table (`REQUIRED`, `INVALID_TYPE`, `INVALID_FORMAT`, `TOO_SHORT`/`TOO_LONG`, `TOO_SMALL`/`TOO_LARGE`, `UNKNOWN_FIELD`, `INVALID`); array dot paths; one `UNKNOWN_FIELD` entry per key; invalid JSON → `fields: []`; malformed path ids → `INVALID_FORMAT` |
| 6 | §6 | API side is Zod request schemas + response DTO classes; request components are named; component names are consumer contract identifiers |
| 7 | §7 | Mark as "consumer expectation; producer design pending the auth slice" |
| 8 | §8 | Mark which layers are implemented now and which are pending the auth slice |
| 9 | §9 | Add the contract-identifier rules (coordinated change; breaking for generated consumers; staging when needed) |
| 10 | endpoint notes | Public Services catalog: `GET /services`, `GET /services/:slug` (no price in V1) |
| — | outside the contract | xuan-web's `architecture.md` lists a planned `subscribers` feature. Newsletter ("Creator Notes") now *needs product confirmation*; if confirmed, rename it to an explicit newsletter capability |
