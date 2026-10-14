# Blog posts (CMS/API): design

**Status:** DRAFT awaiting owner review (2026-10-15), branch `feat/build-blog-posts`. **Not approved for planning or implementation.** Revised after an independent spec review (same day). Frozen once merged; living docs carry the result.

**Decision tags:**

| Tag | Meaning |
|---|---|
| **[Owner]** | Stated by the owner in this design conversation, or already settled in canonical docs |
| **[Proposed]** | Claude's proposal. Needs explicit owner approval in the spec review before it is planned |
| **[Open]** | An owner decision that is **not** made (§9). Excluded from this outcome; the design stays independent of it. Items marked **blocks planning** must be answered before `writing-plans` |

## 1. Outcome

Xuân (admin) and editors write posts with a structured rich-text body and SEO metadata, keep them as drafts, and publish or unpublish them. The public site lists and reads published posts. Authorization reuses the existing Google sessions, roles and ownership policy. `xuan-web` builds the editor and the public pages against this contract in its own, separate outcome.

**In scope:** a `content` module owning posts; author foreign key to `users`; TipTap/ProseMirror JSON body validation (text-only allow-list, §4); draft/published lifecycle; SEO title/description; public list (paginated) and read-by-slug; authoring list/read/create/update/publish/unpublish with ownership; the first pagination and first request-body plumbing; a larger body limit for post writes; migration, docs, OpenAPI, tests.

**Out of scope (owner decisions first, §9):** images (in the body and as cover/OG), media upload/storage, categories, tags, archive, scheduled publishing, slug redirects, deletion mechanism, preview links, featured/reading time, multilingual UI/API, search, comments, feeds, the xuan-web editor and pages.

## 2. Requirements and decisions

| # | Decision | Tag | Source / why |
|---|---|---|---|
| B1 | Every post has exactly one **author user**. Admin manages all posts; an editor manages only their own; users and guests manage none. The public sees **published** posts only | [Owner] | `data-model.md` §4; owner brief 2026-10-15 |
| B2 | Two states: **draft** and **published** | [Owner] | Owner brief |
| B3a | **Vietnamese only in V1, i18n-ready** | [Owner] | Owner answer 2026-10-15 |
| B3b | How "i18n-ready" is realized: a `language` column fixed to `'vi'` by a CHECK, slug unique **per language**, `language` returned in DTOs but never accepted as input, no translation groups | [Proposed] | Shapes the future multilingual URL model (`/posts/:slug` stays the `vi` route; another language would add a prefix or parameter then) |
| B4 | Body is **TipTap/ProseMirror JSON** (TipTap **3.x**), stored as validated `jsonb` with a **body version**; explicit node and mark allow-list; size limits; unsafe links, attributes and embedded content rejected; no custom nodes or embeds | [Owner] | Owner answer 2026-10-15 |
| B5 | SEO metadata: **SEO title** and **SEO description**, optional (the web falls back to title/excerpt) | [Owner] scope, [Proposed] shape | Owner brief; OG image waits for media (OD-3) |
| B6 | Module `modules/content/` owns table `content_posts` | [Proposed] | `database.md` §12 already names `content_posts.author_id` |
| B7 | **C12 resolution, first cross-module database relation:** `content_posts.author_id` gets a real FK (`fk_content_posts_author_id → users(id) ON DELETE RESTRICT`), declared with TypeORM 1.1's **`@ForeignKey('User', …)` using a string target**: FK metadata only, no `@ManyToOne`, no relation property and **no import of the `User` class** (so I2's "no import of another module's entities" holds). `migration:generate` then emits the FK, and a second generate stays empty | [Proposed] | A hand-written FK without metadata is dropped by the next `migration:generate` (TypeORM's `dropOldForeignKeys`). The decorator exists in `node_modules/typeorm/decorator/ForeignKey.d.ts` (1.1.2); **planning starts with a spike** (generate → read SQL → generate again empty → `RESTRICT` and name correct). If only `@ForeignKey(() => User)` works, that's a cross-module import and needs an owner decision plus a docs change before continuing |
| B8 | `UsersModule` exports **one narrow provider**, `UserProfilesReader.findPublicProfiles(ids)` → `{ id, displayName, avatarUrl }[]` (no email, no role). `UsersModule` exports nothing today; this is its first export | [Proposed] | Exported providers are a module's public API (architecture §4); a neutral, read-only profile reader doesn't expose sign-in or role changes |
| B9 | **Slug supplied by the client** (the editor suggests one), validated server-side: canonical `^[a-z0-9]+(?:-[a-z0-9]+)*$`, ≤ 160 chars, enforced by a CHECK (D30). Duplicate within the language → `409 POST_SLUG_TAKEN` | [Proposed] | One rule, one error; Vietnamese slugification is UI convenience |
| B10 | Authoring routes under `/admin/posts` with `@Roles('editor', 'admin')`; public routes under `/posts` | [Proposed] | One dashboard area for editors and admins; `/admin/users` stays admin-only through its own `@Roles('admin')` |
| B11 | A non-owner editor gets **`403 FORBIDDEN`** when managing someone else's post | [Owner] | `api-contract.md` §11 |
| B12 | Editors also **cannot read** another author's post through `/admin/posts/:id` (403) and their list shows only their own; admins see all | [Proposed] | `data-model.md` §4 covers manage actions only; reading drafts of others is not granted anywhere |
| B13 | A draft or unknown slug on the public route → `404 NOT_FOUND` (no existence leak) | [Proposed] | Same as `/services/:slug` |
| B14 | **Last write wins** on concurrent edits in V1. A later optimistic-concurrency precondition (e.g. `If-Match` on `updatedAt`) stays **optional**, so adding it is not a contract break | [Proposed] | Answers the open question in `architecture.md` §14 for posts only; §14 is updated if approved |
| B15 | **Post write routes accept JSON bodies up to 512 kB**; every other route keeps 100 kB. Mechanism: a path-scoped `express.json({ limit: '512kb' })` for `POST /admin/posts` and `PUT /admin/posts/:id`, mounted **before** the global parser (which skips an already-parsed body), with the same `413 PAYLOAD_TOO_LARGE` translation and parse-error marker as the global one | [Proposed] | A long article's TipTap JSON exceeds 100 kB (D21 permits a parser change for the feature that needs it). Note: parsing happens before guards, so an unauthenticated client can make the server parse up to 512 kB on these two routes; the CSRF guard and 401 still reject the request. **Spike in planning** |
| B16 | **`publishedAt` semantics** (OD-12, **blocks planning**): proposal A = set on the **first** publish and kept across unpublish/republish; alternatives: B = reset on every publish; C = client-settable (backdating/imports) | [Open] | Affects public ordering, SEO and scheduled publishing; not client-settable unless C is chosen |

## 3. Data model

### 3.1 Conceptual

```
User (users module) 1 ──< Post (content module)
```

The author is set from the session at creation and **never changes through the API** in V1. A demoted author's posts stay as they are (published ones stay public); only an admin can manage them afterwards.

### 3.2 Physical: `content_posts` [Proposed, B6–B9]

| Column | Type | Null | Default | Constraint |
|---|---|---|---|---|
| `id` | `uuid` | no | `uuidv7()` | `pk_content_posts` (D26) |
| `author_id` | `uuid` | no | — | `fk_content_posts_author_id` → `users(id)` `ON DELETE RESTRICT` (B7) |
| `language` | `varchar(16)` | no | `'vi'` | `ck_content_posts_language`: `language IN ('vi')` (widening it is the i18n change) |
| `slug` | `varchar(160)` | no | — | `ck_content_posts_slug_format` (B9); `uq_content_posts_language_slug (language, slug)` |
| `title` | `varchar(200)` | no | — | `ck_content_posts_title_not_blank`: `btrim(title) <> ''` |
| `excerpt` | `varchar(400)` | yes | — | `ck_content_posts_excerpt_not_blank`: `excerpt IS NULL OR btrim(excerpt) <> ''` |
| `body` | `jsonb` | no | — | `ck_content_posts_body_is_doc`: `jsonb_typeof(body) = 'object' AND body->>'type' = 'doc'` |
| `body_version` | `smallint` | no | `1` | `ck_content_posts_body_version`: `body_version IN (1)` |
| `status` | `varchar(16)` | no | `'draft'` | `ck_content_posts_status`: `status IN ('draft','published')` |
| `published_at` | `timestamptz` | yes | — | `ck_content_posts_published_has_date`: `status <> 'published' OR published_at IS NOT NULL` |
| `seo_title` | `varchar(200)` | yes | — | `ck_content_posts_seo_title_not_blank` (same pattern as excerpt) |
| `seo_description` | `varchar(400)` | yes | — | `ck_content_posts_seo_description_not_blank` |
| `created_at` | `timestamptz` | no | `now()` | D27 |
| `updated_at` | `timestamptz` | no | `now()` | Set by every real change (D27); idempotent publish/unpublish don't write |

**Indexes:** `ix_content_posts_public_list (language, status, published_at DESC, id DESC)` for the public list; `ix_content_posts_author_id_updated_at (author_id, updated_at DESC, id DESC)` for the editor list and the FK; the admin list orders by `updated_at DESC, id DESC`.

Lengths follow D29. The migration is generated, read, reverted and re-run, and a second generate is empty (`xuan-database-change`); `database.md` §12 is updated in the same branch.

## 4. Body document (version 1) [B4]

### 4.1 Allow-list (TipTap 3.x JSON)

Version 1 is **text-only**: no `image` node (see OD-1). Images arrive as an additive version 2 together with the media decision, so no stored version-1 document is ever invalidated by a later host allow-list.

| Node | Allowed children | Allowed attrs (anything else → 400) |
|---|---|---|
| `doc` | block nodes; `content` may be `[]` (an empty document) | — |
| `paragraph` | inline nodes; `content` may be omitted (empty paragraph) | — |
| `heading` | inline nodes; `content` may be omitted | `level`: 1, 2 or 3 [Owner] (see OD-11) |
| `bulletList` | `listItem` (≥ 1) | — |
| `orderedList` | `listItem` (≥ 1) | `start`: integer 1–100 000 (TipTap default 1); `type`: `null` (TipTap 3 default) |
| `listItem` | a `paragraph` first, then block nodes (TipTap's `paragraph block*`) | — |
| `blockquote` | block nodes (≥ 1) | — |
| `text` | — | `text`: non-empty string; `marks`: each allowed mark at most once |
| `hardBreak` | — | `marks`: same allow-list as `text` (TipTap may emit them) |

**Block nodes** (children of `doc`, `blockquote`, `listItem` after its first paragraph): `paragraph`, `heading`, `bulletList`, `orderedList`, `blockquote`. **Inline nodes:** `text`, `hardBreak`.

| Mark | Allowed attrs |
|---|---|
| `bold`, `italic` | none |
| `link` | `href` (required): see the link rule below. TipTap 3.28's default attributes are accepted **only with their default values**: `target: "_blank"` or `null`, `rel: "noopener noreferrer nofollow"` or `null`, `class: null`, `title: null` |

**Link rule:** `href` is parsed with the WHATWG `URL` parser; it must be absolute with scheme `https:`, `http:` or `mailto:` (compared case-insensitively after parsing), ≤ 2 048 chars, no credentials (`user:pass@`), no whitespace or control characters. Relative links, protocol-relative `//host`, fragment-only `#anchor`, `javascript:`, `data:`, `vbscript:` and every other scheme → 400. (Editors will meet the `#anchor` rejection; in-page anchors can be added later as an additive rule.)

**Strings:** every string in the body and in the request (title, slug, excerpt, SEO fields) rejects `\u0000` (`INVALID`), because PostgreSQL can't store it and the database error would otherwise surface as a 500 (I15).

**Canonical storage (the single exception to "reject, don't drop"):** the link mark's known default attributes listed above are **stripped**; the stored mark is `{ "type": "link", "attrs": { "href": … } }`. Every other unknown or non-default key is rejected. A `GET` therefore returns the canonical document, which may differ from the request by exactly those attributes (covered by a round-trip test). The web renderer decides `rel`/`target` itself.

### 4.2 Versioning

`body_version` = 1 for this allow-list. An additive change (e.g. `image` in version 2) bumps the version and widens the CHECK; stored version-1 documents stay valid and are served with `bodyVersion: 1`. A breaking change needs a data migration (C10).

### 4.3 Limits and validation order

| Limit | Value [Proposed] |
|---|---|
| Serialized body size | ≤ 256 KiB, measured as UTF-8 bytes of `JSON.stringify(body)` |
| Total nodes | ≤ 5 000 |
| Nesting depth | ≤ 12 |
| Text per text node | ≤ 10 000 chars |
| Reported validation issues | at most 50 `details.fields[]` entries |

**Order:** (1) the request passes the 512 kB raw parser limit (B15); (2) an **iterative** (non-recursive) pass checks size, depth and node count first, so a pathologically deep document can never overflow the stack (a `RangeError` would be a 500); (3) only then the recursive Zod parse runs. All failures are `400 VALIDATION_FAILED` with paths into the document (e.g. `body.content.3.content.0.marks.0.attrs.href`).

### 4.4 Implementation shape and components

- A recursive Zod 4 schema in `modules/content/` with named components **`PostBodyDocument`**, **`PostBodyNode`** and **`PostBodyMark`** (D17), plus a pure limits function; both unit-tested table-driven (D40).
- **Response documentation (a stated D17 clarification):** response DTO classes are hand-written (`@ApiProperty`), but a recursive document can't be; `PostDto.body` / `AdminPostDto.body` reference the Zod-generated component with `@ApiProperty({ $ref: getSchemaPath('PostBodyDocument') })`. The OpenAPI e2e proves the reference resolves.
- **Risk, partly verified (2026-10-15 throwaway probe):** `z.toJSONSchema(…, { target: 'openapi-3.0' })` emits a self-referencing named definition and parses nested documents; `@nestjs/swagger` rewrites `definitions` into `components/schemas`. Planning proves it end to end.

## 5. HTTP contract [Proposed endpoints]

### 5.1 Public (`@Public()`)

| Route | Result | Errors |
|---|---|---|
| `GET /posts?page&pageSize` | `{ data: { items: PostSummaryDto[], pageInfo } }`: language `vi`, published only, newest `published_at` first (tie: `id` desc). Query component `PostsPageQuery`: `page` ≥ 1 (default 1), `pageSize` 1–50 (default 12), unknown keys → 400. A page beyond `totalPages` → `200` with empty `items` | `400`, `413`*, `500` |
| `GET /posts/:slug` | `{ data: PostDto }`, language `vi`. The slug is an **opaque lookup key** (no format validation; a stated D7 deviation, as `/services/:slug`) | `404 NOT_FOUND` (missing, malformed or draft), `500` |

\* `@ApiErrorResponses` adds `413` automatically whenever `VALIDATION_FAILED` is listed (existing helper behavior).

### 5.2 Authoring (`@Roles('editor', 'admin')`)

| Route | Result | Errors |
|---|---|---|
| `GET /admin/posts?status&page&pageSize` | `{ data: { items: AdminPostSummaryDto[], pageInfo } }`. Query component `AdminPostsQuery` (`status?`, `page`, `pageSize`). Editor: own posts; admin: all (B12). Newest `updated_at` first (tie: `id` desc) | `400`, `401`, `403`, `413`*, `500` |
| `GET /admin/posts/:id` | `{ data: AdminPostDto }`. Path component `PostIdParam` (uuid, D9) | `400`, `401`, `403`, `404`, `413`*, `500` |
| `POST /admin/posts` | `201 { data: AdminPostDto }`: new **draft**, author = current user. Body component `SavePostDto` | `400`, `401`, `403`, `409 POST_SLUG_TAKEN`, `413`, `500` |
| `PUT /admin/posts/:id` | `{ data: AdminPostDto }`: replaces all editable fields (full replacement, §5.3). **Slug behavior on published posts blocks planning (OD-4)** | `400`, `401`, `403`, `404`, `409 POST_SLUG_TAKEN`, `413`, `500` |
| `POST /admin/posts/:id/publish` | `{ data: AdminPostDto }`; idempotent (no write if already published) | `400`, `401`, `403`, `404`, `413`*, `500` |
| `POST /admin/posts/:id/unpublish` | `{ data: AdminPostDto }`; back to draft, idempotent | `400`, `401`, `403`, `404`, `413`*, `500` |

All writes pass the existing CSRF guard (`X-Requested-With` + allowed `Origin`). Every query and path route uses `@ApiSchemaParameters` (D15).

### 5.3 DTOs and request components (I19 identifiers)

| Name | Kind | Fields |
|---|---|---|
| `PostAuthorDto` | response | `displayName`, `avatarUrl: string \| null` (no id, no email) |
| `PostSummaryDto` | response | `id`, `slug`, `title`, `excerpt: string \| null`, `publishedAt`, `author: PostAuthorDto` |
| `PostDto` | response | `PostSummaryDto` + `language`, `body` (`PostBodyDocument`), `bodyVersion`, `seoTitle: string \| null`, `seoDescription: string \| null`, `updatedAt` |
| `AdminPostAuthorDto` | response | `id`, `displayName`, `avatarUrl: string \| null` |
| `AdminPostSummaryDto` | response | `id`, `slug`, `title`, `status: 'draft' \| 'published'`, `publishedAt: string \| null`, `updatedAt`, `author: AdminPostAuthorDto` |
| `AdminPostDto` | response | `AdminPostSummaryDto` + `language`, `excerpt`, `body`, `bodyVersion`, `seoTitle`, `seoDescription`, `createdAt` |
| `PageInfoDto` | response | `page`, `pageSize`, `totalItems`, `totalPages` (`api-contract.md` §3) |
| `SavePostDto` | request body (`strictObject`) | `slug`; `title` (trimmed, 1–200); `body`; `excerpt?` (≤ 400); `seoTitle?` (≤ 200); `seoDescription?` (≤ 400). Optional strings are trimmed; blank or **omitted → `null`** (full replacement on PUT). Author, status, dates and language are not input (I9) |
| `PostsPageQuery`, `AdminPostsQuery`, `PostIdParam` | request query/path | as in §5.1–§5.2 |
| `PostBodyDocument`, `PostBodyNode`, `PostBodyMark` | request/response schema | §4 |

`PageQueryDto` / `PageInfoDto` (the architecture §15 names) become the shared pagination pieces; `PostsPageQuery` and `AdminPostsQuery` extend the page schema. The pagination schema and `PageInfoDto` live in `src/http/pagination/`; `@ApiPaginatedEnvelopeResponse` lives with the other helpers in `src/http/openapi/`.

**New error code:** `POST_SLUG_TAKEN` (409, kind `conflict`) in `modules/content/content.errors.ts`; the content service translates the named unique violation (I14, I15). Everything else uses baseline codes.

### 5.4 First-time plumbing this outcome brings in (architecture §15)

- Pagination (`PageQueryDto`, `PageInfoDto`, `@ApiPaginatedEnvelopeResponse`; D14, D15).
- First request body (`@Body({ schema })`) and its OpenAPI request component.
- The post write body limit (B15).

## 6. Behavior details

- **Create:** status `draft`, `published_at` null, `language` `vi`, author from `@CurrentUser()`.
- **Update:** load → `assertCanManageOwnedResource(actor, post.authorId)` → replace editable fields → `updated_at = now()`. Allowed in both states; changes to a published post are live immediately. **Slug changes on published posts: OD-4 (blocks planning).**
- **Publish / unpublish:** load → ownership check → if the state already matches, return it unchanged (no write, `updated_at` unchanged) → otherwise switch state and set `updated_at`; `published_at` per OD-12.
- **Author display:** list endpoints batch-load profiles for the page's distinct `authorId`s through `UserProfilesReader` (one extra query per page, no N+1).
- **Transactions:** single-row writes need none; the slug conflict is recognized by the constraint name.

## 7. Security and privacy

- The body allow-list (§4) is the API's XSS boundary; `xuan-web` must render documents with a React renderer for the version-1 allow-list and never inject HTML.
- No author email anywhere; public DTOs omit author ids.
- Drafts never leak through public routes.
- Request bodies are never logged (I17).
- Public routes are read-only: D23 (rate limiting of public **write** endpoints) is not triggered here.

## 8. Testing (D39, D40)

- **Unit:** body validator and limits, table-driven: every node/mark, each forbidden scheme and URL form, unknown keys, link default-attribute stripping, NUL, empty documents, depth/node/size limits, the 50-issue cap, a deep document that must return 400 (not crash).
- **E2E (real `xuan_test`):** each endpoint outcome with exact bodies: public list and pagination (beyond last page, `pageSize` 51 → 400, unknown query key → 400); published read; draft/missing/malformed slug → 404; exact public bodies contain no author id or email; authoring as admin, owner editor, other editor (403), user (403), guest (401); create; duplicate slug → 409; update full replacement (omitted optional → null); round-trip canonicalization; publish/unpublish idempotency (no `updated_at` change); CSRF on writes; 413 above 512 kB on post writes and above 100 kB elsewhere; NUL → 400.
- **Schema e2e** (`content-posts-schema.e2e-spec.ts`): every CHECK (`slug_format`, `language`, `title_not_blank`, excerpt/SEO not blank, `body_is_doc` incl. non-object JSON, `body_version`, `status`, `published_has_date`), the per-language unique constraint, FK `RESTRICT`.
- **OpenAPI e2e:** routes, parameters, request components (`SavePostDto`, `PostsPageQuery`, `AdminPostsQuery`, `PostIdParam`, `PostBodyDocument`/`Node`/`Mark`), response DTOs, the body `$ref`, error codes per route (I18).

## 9. Open owner decisions

| # | Decision | Status | What stays independent now |
|---|---|---|---|
| OD-1 | **Images in the body**: excluded from version 1 (proposal) vs allowed now with any `https:` host. The owner said "images as appropriate"; any-host images decide privacy/tracking and CSP `img-src`, and a later host allow-list would invalidate stored documents | **Confirm** | Version 2 adds `image` additively with OD-2 |
| OD-2 | **Image upload & storage** (provider, processing, host allow-list, limits) | Open | No media tables or routes |
| OD-3 | **Cover image + alt**, **OG image** (depend on OD-2) | Open | No columns |
| OD-4 | **Slug change on published posts**: lock after first publish (proposed: the reversible default; loosening later is additive) vs allow without redirects vs a redirect table | **Blocks planning** | Draft slugs are freely editable in every option |
| OD-5 | **Categories** (table vs fixed list) and **tags** | Open | No taxonomy columns |
| OD-6 | **Archive** state and **scheduled publishing** (needs background jobs, architecture §15) | Open | Status CHECK widens additively |
| OD-7 | **Deletion mechanism**: editors deleting their own posts is settled (`data-model.md` §4); hard vs soft delete is open | Open | No delete route; unpublish hides a post |
| OD-8 | **Preview links** for drafts | Open | Authors read drafts via the authenticated `GET /admin/posts/:id` |
| OD-9 | **Public filtering** (category/tag/author) and **search** | Open | Pagination only |
| OD-10 | **Optional metadata**: featured flag, reading time | Open | Not stored |
| OD-11 | **H1 inside the body**: keep levels 1–3 (owner's list) or 2–3 only (the page title is normally the single `<h1>`; Quoc Editor restricts to 2–3) | **Confirm** | Allow-list has 1–3 per owner |
| OD-12 | **`publishedAt` semantics** (B16): first publish kept (proposed) / reset on each publish / client-settable | **Blocks planning** | — |
| OD-13 | **Publishing an empty body**: allowed (proposed: no extra rule) or rejected | **Confirm** | — |
| OD-14 | **Multilingual** UI/API (English, translation groups, hreflang) | Open | B3b keeps it additive |

## 10. Documentation changes on this branch (docs first)

- `data-model.md`: §3 content post row (owning module `content`, V1 scope), §5 open decisions (OD-1…OD-14).
- `database.md` §12: `content_posts` map, "current schema" row and erDiagram; the first cross-module FK (B7).
- `architecture.md`: §3 layout (`modules/content/`, `http/pagination/`); §13 a new AD for the C12 resolution (B7, B8) and the body limit (B15); §10 helper table; §14 concurrency for posts (B14); §15 rows for content, pagination, first request body; §16 the FK and body-limit spikes; §17 future-references text.
- `code-rules.md`: C12 points to its resolution; D21 notes the post write limit; D17 notes the recursive body `$ref` clarification.
- `api-contract.md`: endpoints, DTOs, components, `POST_SLUG_TAKEN`, pagination implemented, xuan-web mirror deltas (§12).
- `CLAUDE.md`: status line ("current slice").

## 11. Outcome boundaries and next outcomes

One branch, one PR (`feat/build-blog-posts`): migration, module, endpoints, plumbing, docs, OpenAPI, tests. It's large; the plan front-loads the B7 (FK metadata) and B15 (body limit) spikes so they can't block late. Later outcomes, each from `dev` once its decision is made: images + media (OD-1/2/3), taxonomy (OD-5), slug redirects (OD-4 if chosen), deletion (OD-7), archive/scheduling (OD-6), and in `xuan-web` the editor and public pages against this contract.
