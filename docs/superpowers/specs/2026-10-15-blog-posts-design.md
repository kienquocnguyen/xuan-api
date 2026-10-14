# Blog posts (CMS/API): design

**Status:** DRAFT awaiting owner review (2026-10-15), branch `feat/build-blog-posts`. Not approved for planning or implementation. Frozen once merged; living docs carry the result.

**Decision tags used below:**

| Tag | Meaning |
|---|---|
| **[Owner]** | Stated by the owner in this design conversation, or already settled in canonical docs |
| **[Proposed]** | Claude's proposal. Needs explicit owner approval in the spec review before it is planned |
| **[Open]** | An owner decision that is **not** made. Excluded from this outcome; the design stays independent of it |

## 1. Outcome

Xuân (admin) and editors write posts with a structured rich-text body and SEO metadata, keep them as drafts, and publish or unpublish them. The public site lists and reads published posts. Authorization reuses the existing Google sessions, roles and ownership policy. `xuan-web` builds the editor and the public pages against this contract in its own, separate outcome.

**In scope:** a `content` module owning posts; author relation to `users`; TipTap/ProseMirror JSON body validation; draft/published lifecycle; SEO title/description; public list (paginated) and read-by-slug; authoring list/read/create/update/publish/unpublish with ownership; the first pagination and first request-body plumbing; migration, docs, OpenAPI, tests.

**Out of scope (each needs an owner decision first, §9):** image upload/storage, cover image, OG image, categories, tags, archive, scheduled publishing, slug redirects, deletion, preview links, featured/reading time, multilingual UI/API, search, comments, RSS/sitemap feeds, the xuan-web editor and pages.

## 2. Requirements and decisions

| # | Decision | Tag | Source / why |
|---|---|---|---|
| B1 | Every post has exactly one **author user**. Admin manages all posts; an editor manages only their own; users and guests manage none. The public sees **published** posts only | [Owner] | `data-model.md` §4 permissions table; owner brief 2026-10-15 |
| B2 | Two states: **draft** and **published** | [Owner] | Owner brief |
| B3 | **Vietnamese only in V1, i18n-ready:** every post stores `language = 'vi'`; slug is unique **per language**; no language input, filter or translation group in the V1 API | [Owner] | Owner answer 2026-10-15 ("Vietnamese only, i18n-ready") |
| B4 | Body is **TipTap/ProseMirror JSON**, stored as validated `jsonb` with a **schema version**; explicit node and mark allow-list; size limits; unsafe links, attributes and embedded content rejected. No custom nodes (before/after, embeds) | [Owner] | Owner answer 2026-10-15 |
| B5 | SEO metadata: **SEO title** and **SEO description** (both optional; the web falls back to title/excerpt) | [Owner] scope, [Proposed] shape | Owner brief lists "SEO metadata"; OG image depends on media (§9) |
| B6 | Module `modules/content/` owns table `content_posts` | [Proposed] | `database.md` §12 already anticipates `content_posts.author_id`; "content" leaves room for later content types without a rename |
| B7 | **C12, first cross-module database relation:** a real foreign key `fk_content_posts_author_id → users(id) ON DELETE RESTRICT` in the migration (D31), but **no TypeORM relation metadata**: the `Post` entity holds a plain `authorId` column. Author profiles are read through a provider exported by `UsersModule` | [Proposed] | Keeps the integrity guarantee in the database while repositories and entities stay private to their modules (C12 wording). Users are never deleted today, so `RESTRICT` changes nothing in practice |
| B8 | `UsersModule` exports a **narrow read provider** for author profiles (`findAuthorProfiles(ids)` → `{ id, displayName, avatarUrl }[]`), not the whole `UsersService` | [Proposed] | Exported providers are the module's public API (architecture §4); a narrow one doesn't expose role changes or sign-in |
| B9 | **Slug supplied by the client** (the editor UI suggests one from the title), validated server-side: lowercase canonical form `^[a-z0-9]+(?:-[a-z0-9]+)*$`, max 160, enforced by a CHECK (D30). Duplicate (same language) → `409 POST_SLUG_TAKEN` | [Proposed] | Vietnamese slugification (diacritics, `đ`) is UI convenience; the API keeps one rule and one error |
| B10 | `published_at` is set the **first** time a post is published and kept on unpublish/republish (original publication date) | [Proposed] | Stable dates for readers and SEO; an explicit "update date" is `updated_at` |
| B11 | **Authoring routes under `/admin/posts`** with `@Roles('editor', 'admin')`; public routes under `/posts` | [Proposed] | The dashboard is one area for editors and admins; `/admin/users` stays admin-only by its own `@Roles('admin')` |
| B12 | **Non-owner editor → `403 FORBIDDEN`** on authoring routes; a draft or unknown slug on the public route → `404 NOT_FOUND` (no existence leak) | [Owner] | `api-contract.md` §11 ("author-owned resources answer 403 to editors who aren't the author") |
| B13 | **Last write wins** on concurrent edits in V1; `updatedAt` is returned so optimistic concurrency can be added without a contract break | [Proposed] | architecture §14 lists admin-edit concurrency as open; one or two authors make conflicts rare |
| B14 | Post write routes get a **larger JSON body limit (512 kB)** than the global 100 kB; every other route keeps 100 kB | [Proposed] | A long article's TipTap JSON exceeds 100 kB. D21 allows a parser change "for the feature that needs it"; the document limits in §4.3 stay the real bound. **Risk to verify in planning:** the global parser runs first, so the larger limit needs a path-scoped parser registered ahead of it (or a limit chosen per path) without weakening the 413 contract elsewhere |

## 3. Data model

### 3.1 Conceptual

```
User (users module) 1 ──< Post (content module)
  author: admin or editor at write time; the FK only guarantees the user exists
```

A post's author is set from the session at creation and **never changes through the API** in V1 (no reassignment endpoint).

### 3.2 Physical: `content_posts` [Proposed shape, B6–B10]

| Column | Type | Null | Default | Constraint |
|---|---|---|---|---|
| `id` | `uuid` | no | `uuidv7()` | `pk_content_posts` (D26) |
| `author_id` | `uuid` | no | — | `fk_content_posts_author_id` → `users(id)` `ON DELETE RESTRICT` (B7) |
| `language` | `varchar(8)` | no | `'vi'` | `ck_content_posts_language`: `language IN ('vi')` (B3; widening it is the i18n change) |
| `slug` | `varchar(160)` | no | — | `ck_content_posts_slug_format` (B9); `uq_content_posts_language_slug (language, slug)` |
| `title` | `varchar(200)` | no | — | `ck_content_posts_title_not_blank`: `btrim(title) <> ''` |
| `excerpt` | `varchar(400)` | yes | — | — |
| `body` | `jsonb` | no | — | `ck_content_posts_body_is_doc`: `body->>'type' = 'doc'` (shape is validated by the API, §4) |
| `body_version` | `smallint` | no | `1` | `ck_content_posts_body_version`: `body_version IN (1)` |
| `status` | `varchar(16)` | no | `'draft'` | `ck_content_posts_status`: `status IN ('draft','published')` |
| `published_at` | `timestamptz` | yes | — | `ck_content_posts_published_has_date`: `status <> 'published' OR published_at IS NOT NULL` |
| `seo_title` | `varchar(200)` | yes | — | — |
| `seo_description` | `varchar(400)` | yes | — | — |
| `created_at` | `timestamptz` | no | `now()` | D27 |
| `updated_at` | `timestamptz` | no | `now()` | Changed by every write (D27: posts change during their lifecycle) |

Indexes: `ix_content_posts_status_published_at (status, published_at DESC, id DESC)` for the public list; `ix_content_posts_author_id (author_id)` for the editor list and the FK.

Lengths follow D29 (`varchar(n)` where a real maximum exists). The migration is generated with `migration:generate`, read, reverted and re-run (`xuan-database-change`); the physical map in `database.md` §12 is updated in the same branch.

## 4. Body document (TipTap/ProseMirror JSON, version 1) [B4]

### 4.1 Allow-list

| Node | Content | Allowed attrs (anything else → 400) |
|---|---|---|
| `doc` | block nodes | — |
| `paragraph` | inline nodes | — |
| `heading` | inline nodes | `level`: 1, 2 or 3 **[Owner]** |
| `bulletList` | `listItem`+ | — |
| `orderedList` | `listItem`+ | `start`: integer ≥ 1; `type`: `null` only, if the adopted TipTap version emits it |
| `listItem` | `paragraph` first, then block nodes | — |
| `blockquote` | block nodes | — |
| `image` | none (block) | `src`: `https:` URL only, ≤ 2048 chars; `alt`: string ≤ 300 or `null`; `title`: string ≤ 300 or `null`; `width`/`height`: positive integer or `null`, only if the adopted TipTap image extension emits them |
| `hardBreak` | none (inline) | — |
| `text` | — | `text`: non-empty string; `marks` from the mark allow-list, each type at most once |

| Mark | Allowed attrs |
|---|---|
| `bold`, `italic` | — |
| `link` | `href`: `https:`, `http:` or `mailto:` URL, ≤ 2048 chars. `target`, `rel`, `class`: accepted only with the values the adopted TipTap link extension emits by default (exact values pinned in planning) and **not stored** |

- **Canonical storage:** the API stores a canonical document (only allowed keys; link marks keep `href` only). The web renderer decides `rel`/`target` (e.g. `noopener noreferrer` on external links). Unknown node/mark types, unknown keys, `javascript:`/`data:`/`vbscript:` or relative URLs are **rejected with 400**, never silently dropped, so the editor and the API stay honest with each other.
- **Images reference URLs only.** Where those URLs may point (an allow-list of hosts) depends on the media decision (§9, M1). Until then only the `https:` scheme is enforced.
- **H1 inside the body** is allowed because the owner listed H1–H3. Flag for the spec review: the page title is normally the only `<h1>`; Quoc Editor restricts the body to H2/H3 for that reason.
- The exact default attributes are checked against the TipTap version `xuan-web` adopts during planning; the version-1 contract above is what the API accepts.

### 4.2 Versioning

`body_version` = 1 for this allow-list. A future change that is additive (a new node) bumps the version and the CHECK; stored version-1 documents stay valid. A breaking change needs a data migration (C10).

### 4.3 Limits

| Limit | Value [Proposed] |
|---|---|
| Serialized body size | ≤ 256 kB (`JSON.stringify` length) |
| Total nodes | ≤ 5 000 |
| Nesting depth | ≤ 12 |
| Text per text node | ≤ 10 000 chars |
| Images per post | ≤ 100 |

Violations are `400 VALIDATION_FAILED` with `details.fields[]` paths into the document (e.g. `body.content.3.content.0.marks.0.attrs.href`).

### 4.4 Implementation shape

A recursive Zod 4 schema in `modules/content/` (`post-body.schema.ts`) plus a small pure function for the counted limits (nodes, depth, images), unit-tested table-driven (D40). The request schema is a named component (`.meta({ id })`, D17). **Risk, partly verified (2026-10-15 throwaway probe):** `z.toJSONSchema(…, { target: 'openapi-3.0' })` emits a self-referencing named definition (`PostBodyNode` → `$ref`) and parses nested documents; `@nestjs/swagger` rewrites `definitions` into `components/schemas`. Planning still proves it end to end with the OpenAPI e2e.

## 5. HTTP contract [Proposed endpoints, B11–B14]

### 5.1 Public (`@Public()`)

| Route | Result | Errors |
|---|---|---|
| `GET /posts?page&pageSize` | `{ data: { items: PostSummaryDto[], pageInfo } }`, published only, newest `published_at` first (tie: `id` desc). `page` ≥ 1 (default 1), `pageSize` 1–50 (default 12) | `400`, `500` |
| `GET /posts/:slug` | `{ data: PostDto }`; language `vi` | `404 NOT_FOUND` (missing **or** draft), `500` |

### 5.2 Authoring (`@Roles('editor', 'admin')`)

| Route | Result | Errors |
|---|---|---|
| `GET /admin/posts?status&page&pageSize` | `{ data: { items: AdminPostSummaryDto[], pageInfo } }`. Editor: own posts only; admin: all. Optional `status` filter. Newest `updated_at` first | `400`, `401`, `403`, `500` |
| `GET /admin/posts/:id` | `{ data: AdminPostDto }` | `400` (bad uuid), `401`, `403` (not the author, editor), `404`, `500` |
| `POST /admin/posts` | `201 { data: AdminPostDto }`: new **draft**, author = current user | `400`, `401`, `403`, `409 POST_SLUG_TAKEN`, `413`, `500` |
| `PUT /admin/posts/:id` | `{ data: AdminPostDto }`: replaces all editable fields | `400`, `401`, `403`, `404`, `409 POST_SLUG_TAKEN`, `413`, `500` |
| `POST /admin/posts/:id/publish` | `{ data: AdminPostDto }`; idempotent for a published post | `401`, `403`, `404`, `500` |
| `POST /admin/posts/:id/unpublish` | `{ data: AdminPostDto }`; back to draft, idempotent | `401`, `403`, `404`, `500` |

All writes go through the existing CSRF guard (`X-Requested-With` + allowed `Origin`).

### 5.3 DTOs and request schema

| Name | Fields |
|---|---|
| `PostAuthorDto` | `displayName`, `avatarUrl: string \| null` (no email, no id on public DTOs) |
| `PostSummaryDto` | `id`, `slug`, `title`, `excerpt: string \| null`, `publishedAt`, `author: PostAuthorDto` |
| `PostDto` | `PostSummaryDto` + `language`, `body` (version-1 document), `bodyVersion`, `seoTitle: string \| null`, `seoDescription: string \| null`, `updatedAt` |
| `AdminPostSummaryDto` | `id`, `slug`, `title`, `status`, `publishedAt: string \| null`, `updatedAt`, `author: AdminPostAuthorDto` |
| `AdminPostAuthorDto` | `id`, `displayName`, `avatarUrl: string \| null` |
| `AdminPostDto` | `AdminPostSummaryDto` + `language`, `excerpt`, `body`, `bodyVersion`, `seoTitle`, `seoDescription`, `createdAt` |
| `PageInfoDto` | `page`, `pageSize`, `totalItems`, `totalPages` (`api-contract.md` §3) |
| `PostInput` (request, `.meta({ id: 'PostInput' })`) | `slug`, `title` (1–200, trimmed), `excerpt?` (≤ 400, blank → null), `body` (§4), `seoTitle?` (≤ 200), `seoDescription?` (≤ 400). `strictObject`: author, status, dates and language are **not** client input (I9) |

New error code: `POST_SLUG_TAKEN` (409, kind `conflict`) in `content.errors.ts`. The unique violation is translated by the content service, never inferred by HTTP (I15). All other errors are baseline codes.

### 5.4 First-time plumbing this outcome brings in (from architecture §15)

- **Pagination:** `PageQuery` schema, `PageInfoDto`, `@ApiPaginatedEnvelopeResponse(Dto)` in `http/openapi/` (D14, D15).
- **First request body:** Zod body via `@Body({ schema })`; OpenAPI request component.
- **Per-route body limit** for post writes (B14).

## 6. Behavior details

- **Create:** status `draft`, `published_at` null, `language` `vi`, author from `@CurrentUser()`.
- **Update:** loads the post, `assertCanManageOwnedResource(actor, post.authorId)`, replaces editable fields, bumps `updated_at`. Works in both states; a published post's changes are live immediately (no separate "pending changes").
- **Publish:** ownership check; sets `status = published`; sets `published_at = now()` only if null (B10).
- **Unpublish:** ownership check; `status = draft`; keeps `published_at`.
- **Slug change** on a published post is allowed and **breaks the old URL** until slug redirects are decided (§9, S1). Flag for the spec review.
- **Author display:** list endpoints batch-load author profiles for the page's distinct `authorId`s through the users read provider (B8): one extra query per page, no N+1.
- **Transactions:** single-row writes don't need one; the slug conflict is caught from the unique constraint by name.

## 7. Security and privacy

- Body validation is the XSS boundary at the API (§4). `xuan-web` must render the document with a React renderer for the version-1 allow-list and never inject HTML.
- No author email in any post DTO; public DTOs omit author ids.
- Drafts never leak through public routes (same 404 as a missing slug).
- Logs never contain post bodies (I17 discipline: request bodies aren't logged).
- Public routes are read-only, so D23 (rate limiting of public **write** endpoints) isn't triggered by this outcome.

## 8. Testing (D39, D40)

- **Unit:** the body validator: table-driven valid and invalid documents (each node/mark, each forbidden scheme, unknown keys, limits, canonicalization of link attrs).
- **E2E (real `xuan_test`):** each endpoint outcome with exact bodies: public list and pagination, published read, draft and missing → 404; authoring as admin, owner editor, other editor (403), user (403), guest (401); create → 409 on duplicate slug; update; publish/unpublish idempotency and `published_at` rules; CSRF on writes; 413 above the post limit and 100 kB elsewhere unchanged.
- **Schema e2e:** constraint behavior (`content-posts-schema.e2e-spec.ts`, like `users-schema`): slug format, language, status/published_at, FK.
- **OpenAPI e2e:** routes, parameters, request and response components, error codes (I18).

## 9. Open owner decisions (excluded from this outcome)

| # | Decision | Why it matters | What stays independent now |
|---|---|---|---|
| M1 | **Image upload & storage** (provider, processing, host allow-list, limits) | Schema for media, new provider, upload endpoint and body parser | Images are `https:` URLs in the body; adding uploads later only adds a host allow-list check |
| M2 | **Cover image + alt**, **OG image** | Columns and DTO fields; depend on M1 | Nothing references them yet |
| T1 | **Categories** (table vs fixed list) and **tags** | Tables, filters, public URLs | No taxonomy columns |
| S1 | **Slug change on published posts** (redirect table vs lock after first publish vs allow) | Broken links / SEO | Current proposal allows edits without redirects (§6) |
| L1 | **Archive** state and **scheduled publishing** (needs background jobs, architecture §15) | Status CHECK and a scheduler | Status CHECK widens additively |
| D1 | **Deletion**: hard vs soft, drafts only vs any | Irreversible behavior; soft delete is deferred architecture | No delete route; unpublish is the V1 way to hide a post |
| P1 | **Preview links** for drafts (shareable tokens) | Security and URLs | Authors read drafts through the authenticated `GET /admin/posts/:id` |
| F1 | **Public filtering** (category/tag/author) and **search** | Query params and indexes | Only pagination |
| O1 | **Optional metadata**: featured flag, reading time | Columns, UI | Not stored |
| I1 | **Multilingual** UI/API (English, translation groups, hreflang) | Already designed for (B3) | `language` column + per-language slug |
| H1 | **H1 inside the body** (keep levels 1–3, or 2–3 only) | SEO / document outline | Allow-list has levels 1–3 per owner |

## 10. Documentation changes on this branch (docs first)

- `data-model.md`: content post row and §5 open decisions updated with this outcome's scope and the open items above.
- `database.md` §12: `content_posts` physical map; note the first cross-module FK (B7).
- `architecture.md`: §3 layout (`modules/content/`), a new AD for the C12 resolution (B7, B8), §10 helper table (paginated decorator becomes real), §15 rows for content, pagination, first request body updated.
- `code-rules.md`: C12 wording updated to point at its resolution; D21 note for the post body limit (B14) if approved.
- `api-contract.md`: endpoints, DTOs, `POST_SLUG_TAKEN`, pagination now implemented, xuan-web mirror deltas (§12).

## 11. Outcome boundaries and next outcomes

This outcome is **one branch, one PR** (`feat/build-blog-posts`): migration, module, endpoints, docs, OpenAPI, tests. Afterwards, each a separate outcome from `dev`, once its decision is made: media uploads (M1, then M2), taxonomy (T1), slug redirects (S1), deletion (D1), and in `xuan-web` the editor and public blog pages against this contract.
