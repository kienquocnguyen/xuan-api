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
- **Implemented 2026-10-15** (`GET /posts`, `GET /admin/posts`): `page` ≥ 1 (default 1), `pageSize` 1–50 (default 12); a page beyond `totalPages` returns `200` with empty `items`; `PageInfoDto` = `{ page, pageSize, totalItems, totalPages }`.

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
- At most **50** `fields` entries are reported (a huge invalid document can't produce thousands).

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

**Implemented (2026-10-14, auth slice; design spec A1–A14).** Google is the only sign-in method. The app session is an opaque server-side session in an HttpOnly cookie; there are no access/refresh tokens, no register/login/refresh endpoints, and no token ever appears in a response body.

| Endpoint | Purpose |
|---|---|
| `GET /auth/google?returnTo=/path` | Browser navigation. Starts Google sign-in (302 to Google). `returnTo` is an optional relative path; anything else → `400 VALIDATION_FAILED` |
| `GET /auth/google/callback` | Google's redirect back (not in OpenAPI). Success → 302 to `AUTH_WEB_URL + returnTo` with the session cookie set. Failure → 302 to `AUTH_WEB_URL/login?authError=<CODE>` |
| `GET /auth/me` | Current user `{ data: CurrentUserDto }`; `401 UNAUTHENTICATED` without a valid session |
| `POST /auth/logout` | Ends the session, clears the cookie, `204`. Works without a session |

`authError` codes (query string, not an error envelope): `GOOGLE_SIGN_IN_FAILED` (cancelled, bad/expired/forged state, failed exchange), `EMAIL_NOT_VERIFIED`, `ACCOUNT_CONFLICT` (the email belongs to another account; no silent linking).

| Cookie | Attributes |
|---|---|
| `xc_session` | Random 256-bit token; `HttpOnly; SameSite=Lax; Path=/`; **no `Domain`** (host-only on the API host); `Max-Age` = `AUTH_SESSION_TTL_DAYS` (default 14); `Secure` unless `AUTH_COOKIE_SECURE=false` (local HTTP only, refused in production). Server-side revocable; the database stores only its SHA-256 |
| `xc_oauth` | Signed, single-use OAuth state for the Google round trip; `HttpOnly; SameSite=Lax; Path=/auth/google; Max-Age=600` |

- The frontend never reads, stores or decodes the session; it sends `credentials: 'include'` and asks `GET /auth/me`.
- Routing by role is the frontend's job: `user` → home; `editor`/`admin` → dashboard. Authorization is always enforced by the API.
- A new sign-in replaces any session presented with it (no session fixation).

## 8. CORS and CSRF: defense in depth

**Implemented (I20, D21, auth slice):**
- strict CORS allowlist of exact origins, with `credentials: true`;
- allowed headers `Content-Type` and `X-Requested-With`;
- JSON-only body parsing;
- safe methods never mutate (the one exception is the OAuth callback GET, protected by the signed single-use state, PKCE and nonce);
- **every POST/PUT/PATCH/DELETE needs `X-Requested-With: XMLHttpRequest`**, and an `Origin` header, when present, must be an allowed origin; otherwise `403 FORBIDDEN` (`CsrfGuard`).

| Layer | What it does | What it does *not* cover |
|---|---|---|
| `SameSite=Lax` cookies | Cookies aren't sent on cross-*site* subrequests | Same-site attackers; top-level GET navigations, which is why GET must be safe |
| Strict CORS allowlist + `credentials: true` | Only listed origins can read responses or send non-simple credentialed requests. No wildcard origin | "Simple" requests are still *sent*, even if their responses can't be read |
| JSON bodies + custom header (`X-Requested-With: XMLHttpRequest`) on state-changing requests | Forces a CORS preflight | Depends on CORS being correct; nothing against XSS |
| `Origin` validation on state-changing requests | Rejects requests from origins outside the allowlist even when the cookie would be sent | XSS on an allowed origin |
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
| `GET /services` | Public. Returns the Services catalog, the offers shown on Work With Me and the homepage "Ways", as `{ data: ServiceDto[] }`. **Published services only**, ordered by `sort_order` then `slug`, **not paginated in V1**. Errors: `500 INTERNAL_ERROR` |
| `GET /services/:slug` | Public. Returns one published service as `{ data: ServiceDto }`. **No slug-format validation** (a stated D7 deviation: the slug is an opaque lookup key). An unknown, unpublished or malformed slug → `404 NOT_FOUND`. Errors: `404 NOT_FOUND`; `500 INTERNAL_ERROR` |
| `GET /auth/me` | Session. `{ data: CurrentUserDto }`. Errors: `401 UNAUTHENTICATED`; `500` |
| `POST /auth/logout` | Public, CSRF-checked. `204`, idempotent. Errors: `403 FORBIDDEN` (missing header / foreign `Origin`); `500` |
| `GET /auth/google`, `GET /auth/google/callback` | Browser navigations (302), see §7 |
| `GET /admin/users?role=` | Admin. `{ data: AdminUserDto[] }` oldest first; optional exact `role` filter; **not paginated in V1** (small admin-only list). Errors: `400`, `401`, `403`, `500` |
| `PUT /admin/editors/:userId` | Admin. Makes a `user` an `editor`; idempotent for an editor → `{ data: AdminUserDto }`. Errors: `400` (malformed id), `401`, `403`, `404 NOT_FOUND`, `409 ADMIN_ROLE_LOCKED` (target is an admin, including yourself), `500` |
| `DELETE /admin/editors/:userId` | Admin. Makes an `editor` a `user` (the account stays); idempotent for a user → `204`. Errors as for `PUT` |

Both are implemented (`src/modules/services/`, 2026-10-14) and proven by exact-body e2e (`test/services.e2e-spec.ts`) and the OpenAPI e2e.

| `GET /posts?page&pageSize` | Public. `{ data: { items: PostSummaryDto[], pageInfo } }`: published Vietnamese posts, newest `publishedAt` first (tie: `id`). Errors: `400`, `413`, `500` |
| `GET /posts/:slug` | Public. `{ data: PostDto }`. Opaque slug key (D7 deviation, as services): unknown, malformed or **draft** → `404 NOT_FOUND`. Errors: `404`, `500` |
| `GET /admin/posts?status&page&pageSize` | Editor/admin. `{ data: { items: AdminPostSummaryDto[], pageInfo } }`, newest `updatedAt` first. **Editors see only their own posts**, admins all. Errors: `400`, `401`, `403`, `413`, `500` |
| `GET /admin/posts/:id` | Editor/admin. `{ data: AdminPostDto }`. Another author's post → `403` for editors (reads included). Errors: `400`, `401`, `403`, `404`, `413`, `500` |
| `POST /admin/posts` | Editor/admin, CSRF. Body `SavePostDto`; creates a **draft** authored by the caller → `201 { data: AdminPostDto }`. Errors: `400`, `401`, `403`, `409 POST_SLUG_TAKEN`, `413` (body > 512 kB), `500` |
| `PUT /admin/posts/:id` | Editor/admin owner, CSRF. Full replacement (omitted optional fields → `null`). Slug immutable once ever published → `409 POST_SLUG_LOCKED`; a published post can't become empty → `409 POST_BODY_EMPTY`. Errors: `400`, `401`, `403`, `404`, `409` (`POST_SLUG_TAKEN`, `POST_SLUG_LOCKED`, `POST_BODY_EMPTY`), `413`, `500` |
| `POST /admin/posts/:id/publish` | Editor/admin owner, CSRF. Idempotent. Sets `publishedAt` on the first publication only (kept across unpublish/republish). A body without a visible character → `409 POST_BODY_EMPTY`. Errors: `400`, `401`, `403`, `404`, `409`, `413`, `500` |
| `POST /admin/posts/:id/unpublish` | Editor/admin owner, CSRF. Back to draft, idempotent; `publishedAt` and the slug lock stay. Errors: `400`, `401`, `403`, `404`, `413`, `500` |

**Post DTOs:** `PostAuthorDto` = `{ displayName, avatarUrl }` (no id, no email); `PostSummaryDto` = `{ id, slug, title, excerpt, publishedAt, author }`; `PostDto` = summary + `{ language, body, bodyVersion, seoTitle, seoDescription, updatedAt }`; `AdminPostAuthorDto` = `{ id, displayName, avatarUrl }`; `AdminPostSummaryDto` = `{ id, slug, title, status, publishedAt, updatedAt, author }`; `AdminPostDto` = summary + `{ language, excerpt, body, bodyVersion, seoTitle, seoDescription, createdAt }`. Request components: `SavePostDto`, `PostsPageQuery`, `AdminPostsQuery`, `PostIdParam`, `PostBodyDocument`, `PostBodyNode`, `PostBodyMark`. **`body`** is a TipTap 3 / ProseMirror JSON document, version 1 (blog spec §4): `paragraph`, `heading` (levels 2–3), `bulletList`, `orderedList`, `listItem`, `blockquote`, `text`, `hardBreak`; marks `bold`, `italic`, `link` (absolute `https`/`http`/`mailto` only). Unknown nodes, attributes or unsafe links → `400`; TipTap's default link attributes (`target`, `rel`, `class`, `title`) are accepted and stripped, so the stored/returned link is `{ href }`. Limits: 256 KiB serialized, 5 000 nodes, depth 12, 10 000 chars per text node.

**Courses** (course platform outcome 1, `src/modules/courses/`; course spec §11.1, §11.3). Every admin route is **admin only** (`user` and `editor` → `403`), needs a session (`401`) and, for writes, the CSRF header (`403`). Every admin route with input can also return `400 VALIDATION_FAILED` and `413 PAYLOAD_TOO_LARGE`; every route can return `500`. Malformed path ids → `400` with field code `INVALID_FORMAT`. Every curriculum write returns the whole `AdminCourseDto`.

| Endpoint | Behavior |
|---|---|
| `GET /courses` | Public. `{ data: CourseSummaryDto[] }`: **published courses only**, newest `publishedAt` first (tie: `id`), **not paginated in V1** (a handful of courses, as services). Errors: `500` |
| `GET /courses/:slug` | Public. `{ data: CourseDto }`: the published outline, only **published lessons**, sections without one omitted, curriculum order. **No video field.** Opaque slug key (D7 deviation): unknown, malformed or **draft** (also unpublished after publication) → `404 NOT_FOUND`. Errors: `404`, `500` |
| `GET /admin/courses` | `{ data: AdminCourseSummaryDto[] }`, drafts included, newest `updatedAt` first, unpaginated. A course's `updatedAt` is its latest meaningful change, curriculum edits included; no-ops don't move it. Errors: `401`, `403`, `500` |
| `POST /admin/courses` | Body `SaveCourseDto`; creates a **draft** with no curriculum → `201`. Errors: `409 COURSE_SLUG_TAKEN` |
| `GET /admin/courses/:courseId` | `{ data: AdminCourseDto }`. Errors: `404` |
| `PUT /admin/courses/:courseId` | Full replacement of `slug`, `title`, `summary`. The slug is locked once the course was **ever** published, also while unpublished → `409 COURSE_SLUG_LOCKED`. Errors: `404`, `409 COURSE_SLUG_TAKEN` / `COURSE_SLUG_LOCKED` |
| `POST /admin/courses/:courseId/publish` | Idempotent (no write when already published). Needs at least one published lesson → `409 COURSE_NEEDS_PUBLISHED_LESSON`. Sets `publishedAt` on the first publication only. Errors: `404`, `409` |
| `POST /admin/courses/:courseId/unpublish` | Back to draft, idempotent; `publishedAt` and the slug lock stay. Grants and progress (later outcomes) stay. Errors: `404` |
| `POST /admin/courses/:courseId/sections` | Body `SaveCourseSectionDto`; appends a section → `201`. Errors: `404` |
| `PUT /admin/course-sections/:sectionId` | Renames the section. Errors: `404` |
| `DELETE /admin/course-sections/:sectionId` | Only an **empty** section → `204`; later sections move up one position. Errors: `404`, `409 SECTION_NOT_EMPTY` |
| `PUT /admin/courses/:courseId/curriculum-order` | Body `CurriculumOrderDto` `{ sections: [{ id, lessonIds }] }` listing **every** section and **every** lesson of the course exactly once, in the new order. One request covers reordering sections, reordering lessons and moving lessons between this course's sections; lesson ids never change. Anything else (missing, duplicate, foreign id) → `409 CURRICULUM_ORDER_MISMATCH`, nothing changed. Errors: `404`, `409` |
| `POST /admin/course-sections/:sectionId/lessons` | Body `SaveCourseLessonDto`; appends a **draft** lesson → `201`. Errors: `404` |
| `PUT /admin/course-lessons/:lessonId` | **Full replacement**: an **omitted** `videoId`, `privacyHash` or `durationSeconds` is cleared to `null`; an explicit JSON `null` is `400 INVALID_TYPE` (send no key to clear). The video reference stays editable on a published lesson, but a published lesson can't lose its video → `409 LESSON_VIDEO_MISSING`. Errors: `404`, `409` |
| `POST /admin/course-lessons/:lessonId/publish` | Idempotent. Needs a `videoId` → `409 LESSON_VIDEO_MISSING`. Errors: `404`, `409` |
| `POST /admin/course-lessons/:lessonId/unpublish` | Idempotent. Refused for the **last** published lesson of a **published** course → `409 COURSE_NEEDS_PUBLISHED_LESSON` (unpublish the course first). Errors: `404`, `409` |
| `DELETE /admin/course-lessons/:lessonId` | Only a **draft** lesson → `204`; later lessons in its section move up one position. Errors: `404`, `409 LESSON_IS_PUBLISHED` |

**Course DTOs:** `CourseSummaryDto` = `{ id, slug, title, summary, publishedAt }`; `CourseDto` = summary + `{ sections: CourseOutlineSectionDto[] }`; `CourseOutlineSectionDto` = `{ id, title, lessons: CourseOutlineLessonDto[] }`; `CourseOutlineLessonDto` = `{ id, title, durationSeconds: number | null }`. **Public course DTOs never carry a video field** (no `videoId`, `privacyHash` or `vimeo*`). `AdminCourseSummaryDto` = `{ id, slug, title, summary, status, publishedAt, updatedAt, publishedLessonCount, lessonCount }`; `AdminCourseDto` = summary + `{ createdAt, sections: AdminCourseSectionDto[] }`; `AdminCourseSectionDto` = `{ id, title, position, lessons: AdminCourseLessonDto[] }`; `AdminCourseLessonDto` = `{ id, title, position, status, videoId: string | null, privacyHash: string | null, durationSeconds: number | null, updatedAt }`. Lists are in curriculum order; `position` is informational (`0..n-1`). Request components: `SaveCourseDto` `{ slug, title, summary }`, `SaveCourseSectionDto` `{ title }`, `SaveCourseLessonDto` `{ title, videoId?, privacyHash?, durationSeconds? }`, `CurriculumOrderDto`, `CourseIdParam`, `CourseSectionIdParam`, `CourseLessonIdParam`. Validation: slugs lowercase kebab-case ≤ 160 (never lowercased for the client); titles are trimmed, 1–200 characters (summary 1–500), so whitespace-only → `TOO_SHORT`; text with a NUL or broken Unicode → `INVALID`; `videoId` digits only, 1–20; `privacyHash` alphanumeric 1–64 and only together with `videoId` (`INVALID` at `privacyHash`); `durationSeconds` an integer 1–86 400. Course error codes (409, `courses.errors.ts`): `COURSE_SLUG_TAKEN`, `COURSE_SLUG_LOCKED`, `COURSE_NEEDS_PUBLISHED_LESSON`, `LESSON_VIDEO_MISSING`, `LESSON_IS_PUBLISHED`, `SECTION_NOT_EMPTY`, `CURRICULUM_ORDER_MISMATCH`. Proven by `test/courses.e2e-spec.ts`, `test/admin-courses.e2e-spec.ts` and the OpenAPI e2e.

**`ServiceDto`** = `{ id, slug, title, summary }`. It has no price, no duration and no booking or calendar fields. `isPublished`, `sortOrder` and `createdAt` stay internal. A service is a catalog offer, not an appointment (`data-model.md` §3.1). Application, booking and calendar endpoints aren't part of the current contract; they come with the application/booking slice.

**`CurrentUserDto`** = `{ id, email, displayName, avatarUrl: string | null, role: 'user' | 'editor' | 'admin' }`. **`AdminUserDto`** = the same + `createdAt` (ISO 8601). No provider ids, session data, tokens or timestamps beyond `createdAt`.

**Authorization:** every route requires a session unless documented as public (401 otherwise); role-gated routes answer 403 to other roles; author-owned resources (future posts) answer 403 to editors who aren't the author. No admin-role changes through the API.

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
| 7 | §7 | **Replace** the expected register/login/refresh + JWT access/refresh cookies with the implemented contract: Google-only (`GET /auth/google?returnTo=` navigation, `/login?authError=` codes), one opaque `xc_session` cookie, **`GET /auth/me` instead of `GET /users/me`**, `POST /auth/logout`. **Remove the apiClient refresh/retry flow** (no refresh endpoint; a 401 means signed out) |
| 8 | §8 | All layers implemented: the web apiClient **must send `X-Requested-With: XMLHttpRequest` on every POST/PUT/PATCH/DELETE** |
| 9 | §9 | Add the contract-identifier rules (coordinated change; breaking for generated consumers; staging when needed) |
| 10 | endpoint notes | Public Services catalog: `GET /services`, `GET /services/:slug` (no price in V1); `ServiceDto` = `{ id, slug, title, summary }` (no duration); published only, ordered, unpaginated; unknown/unpublished/malformed slug → 404 |
| 11 | endpoint notes | Auth + admin: `CurrentUserDto`, `AdminUserDto`, `/admin/users`, `PUT`/`DELETE /admin/editors/:userId`, `ADMIN_ROLE_LOCKED` (409); role routing (user → home, editor/admin → dashboard) |
| 12 | endpoint notes | Blog posts: `/posts`, `/admin/posts` routes, the post DTOs and request components, `POST_SLUG_TAKEN` / `POST_SLUG_LOCKED` / `POST_BODY_EMPTY` (409), pagination §3 implemented, the 50-field cap. xuan-web renders `body` with a React renderer for the version-1 allow-list (never as HTML) and renders the post title as the page's `<h1>` |
| 13 | endpoint notes | Courses (outcome 1): `/courses`, `/courses/:slug` (public; published only; no video fields; a not-yet-published course's outline is `404`, so the static course page still renders without an outline), the `/admin/courses…`, `/admin/course-sections…`, `/admin/course-lessons…` routes (admin only), the course DTOs and request components, the seven course 409 codes. A lesson `PUT` clears omitted optional fields and rejects explicit `null`. **"Chưa mở đăng ký" stays a web decision** for every published course: `published` means visible, not for sale (course spec §10.5, §15). Learner routes arrive with outcome 2 |
| — | outside the contract | xuan-web's `architecture.md` lists a planned `subscribers` feature. Newsletter ("Creator Notes") now *needs product confirmation*; if confirmed, rename it to an explicit newsletter capability |
