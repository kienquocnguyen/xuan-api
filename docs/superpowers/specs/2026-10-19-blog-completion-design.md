# Blog completion (B1–B4): design

**Status:** **APPROVED by the owner (2026-10-19)**. The approval covers the design's direction, the four outcomes, BD-1…BD-13, and the answers to Q1–Q3 (§16), with Q3 extended by its additional safeguards (§3.4). §18 records the consistency review that followed the approval.
- **Execution:** under the bounded autonomous execution row in `development-workflow.md` §3.5 (PR #17, `c2d5419`).
- **Extends** the frozen Blog V1 design (`2026-10-15-blog-posts-design.md`, decisions B1–B19). Every V1 decision stands unless a row below names it and says how it changes.
- **Inputs:**
  - the owner's product decisions BD-1…BD-13 (2026-10-19), recorded in §15;
  - the local-only audit `discovery/2026-10-19-blog-completion-audit.md`;
  - the owner's local reference flow (`local-docs/BLOG-FLOW.md`, never committed).
- Committed with outcome B1 on `feat/complete-post-lifecycle`. Frozen once merged; the living docs carry the result.

**Decision tags:**

| Tag | Meaning |
|---|---|
| **[Owner]** | An owner decision: BD-n (2026-10-19) or a Blog V1 B-row |
| **[Docs]** | Settled in canonical docs (`docs/*.md`, rule IDs) |
| **[Impl]** | Verified in the current code (`dev` @ `6db8a8a`) |
| **[Proposed]** | Claude's call within the owner's decisions. Approved with this spec unless the owner changes it |
| **[Owner Q1–Q3]** | The owner's answers to this spec's questions (§16), 2026-10-19 |

## 1. Outcome and scope

The blog becomes complete for launch:
- **Authors** (editors for their own posts, admins for all) can:
  - archive, restore and delete drafts that were never published;
  - tag posts and put each post in one category;
  - upload images and use them as cover, OG image and in the article body;
  - use the richer editor nodes.
- **Readers** filter by category, see related articles, rate posts and comment on them.
- **Admins** manage categories and moderate the discussion.

**In scope:**
- the post lifecycle;
- tags;
- categories (admin CRUD, public list, filter, related posts);
- media upload behind a storage gateway (local disk in development, Cloudflare R2 in production);
- cover, OG and alt text;
- body version 2;
- ratings, comments and moderation;
- a per-user rate limit on discussion writes.

Migrations, docs, OpenAPI and tests come with each outcome.

**Out of scope:**
- English and translations (BD-9);
- slug redirects (BD-2);
- a global user ban (BD-7);
- scheduled publishing, preview links, search, featured flags, reading time;
- a media library or orphan cleanup (BD-5);
- tag pages or a tag filter (BD-3);
- comment threads (BD-6);
- any R2 account, purchase or credential (BD-4);
- the xuan-web pages and editor (its own outcomes, §13).

**Anti-goals:**
- A published URL must never break: no slug change and no hard delete of anything ever published.
- An old client must never break: changes are additive only (BD-12).
- No HTML anywhere in stored content.
- No image from a host we don't control.
- Production must never write uploads to a local disk.

## 2. Module boundaries

Everything stays in `modules/content/`, which owns every new table. There is no new business module [Proposed]:
- `content_media` is blog media, since only posts use images today.
- Categories exist only for posts.

| Piece | Where | Why |
|---|---|---|
| Lifecycle, tags, categories, related posts | `content/` services and controllers | Same aggregate as posts |
| Media upload, `content_media` | `content/media/` | One cohesive subfolder (D1 "folders on demand") |
| Storage gateway: interface plus `local` and `r2` adapters | `content/media/storage/` | First external-provider gateway on the blog side (C5). It sits beside its only consumer, like `users/google/` |
| Discussion (ratings, comments, moderation) | `content/discussion/` | Belongs to published posts. Only the content module reads post state |
| Author profiles | `UsersModule`'s exported `UserProfilesReader` (AD14) | Already exported. No new export is needed |
| The rate-limit guard | `content/discussion/` (B4) | Discussion is its only consumer (BD-8). D23's global launch gate stays separate |
| The `RATE_LIMITED` baseline definition | `src/errors/baseline-errors.ts` | The kind and the 429 mapping already exist [Impl]. The code is already documented in `api-contract.md` §4 |
| Serving local media in development | `http/configure-app.ts` (static files) | Bootstrap concern. Only when the storage driver is `local` |

New FKs reach `users(id)` by entity name, like `content_posts.author_id` (AD14, I2).

## 3. Post lifecycle (outcome B1)

### 3.1 States and transitions [Owner BD-1]

```
            publish                  archive
  draft ────────────▶ published ────────────▶ archived
    ▲  ◀────────────      │                      │
    │     unpublish        └────── archive ───────┘
    │                                            │
    └─────────────────── restore ────────────────┘   (restore → draft, never straight to published)

  draft that was never published ── delete ──▶ gone   (anything ever published → 409 POST_WAS_PUBLISHED)
```

| Action | Allowed from | Result | Otherwise |
|---|---|---|---|
| `publish` | draft | published. `published_at` stays the first publication (B16) | archived → `409 POST_ARCHIVED`. Already published → unchanged, no write |
| `unpublish` | published | draft | archived → `409 POST_ARCHIVED`. Already a draft → unchanged, no write |
| `archive` | draft, published | archived. `published_at` is kept, so the slug stays locked (B17) | Already archived → unchanged, no write |
| `restore` | archived | draft | Not archived → unchanged, no write [Proposed: restore means "ensure not archived"] |
| `delete` | draft with `published_at IS NULL` | the row is removed, `204` | Ever published (any status with `published_at` set) → `409 POST_WAS_PUBLISHED`. An archived never-published post → `409 POST_ARCHIVED` (restore it first) [Proposed] |
| `PUT` (edit) | every state | Full replacement, as in V1 | The existing V1 rules, plus §4.4 and §5.4 |

- **Permissions:** editors act on their own posts only, and admins on any (B1, B11, B12; `data-model.md` §4 already grants editors deleting their own).
- Every write needs the CSRF header.
- **Public reads** see `published` only, so an archived post is `404` everywhere public, as drafts are (B13).
- **The admin list's `status` filter** gains `archived`. With no filter, it shows every status.
- **Concurrency:**
  - Each transition locks the post row (the existing `lockManageable`, I8) and checks the state inside the transaction.
  - Delete runs `DELETE … WHERE id = $1 AND status = 'draft' AND published_at IS NULL`. Zero rows after a successful locked read can't happen; if it ever does, that's a 500, not a guess.
  - The FKs from comments and ratings (B4) also block deleting a post that has discussion. The state rule makes that unreachable; an untranslated violation would be a 500 (I15).

### 3.2 Tags [Owner BD-3]

- **Storage:** `content_posts.tags varchar(40)[] NOT NULL DEFAULT '{}'`, with CHECK `ck_content_posts_tags_count`: `cardinality(tags) <= 10`.
- **Input:** `SavePostDto.tags?: string[]` (0–10). Each tag is trimmed, 1–40 characters, storable text (no NUL, no lone surrogates), and has no comma [Proposed: the web's comma-list input can't round-trip one].
- **Duplicates:** compared case-insensitively after trimming; a duplicate → `400 INVALID` at `tags.<i>` [Proposed: reject, don't silently drop, B4's principle].
- **Order and case:** the input order is stored and returned, and the case is kept.
- **Omitted on a `PUT`:** stored as `[]`, because full replacement applies (§3.4).
- **Responses:** `tags: string[]` on `PostDto`, `AdminPostSummaryDto` and `AdminPostDto` (BD-12).
- No tag pages, filter or index in V1.
- Whether PostgreSQL enforces the 40-character limit on array elements is spike **S1** (§11). If it doesn't, a CHECK over `array_to_string` isn't exact, so the limit becomes application-only with the reason recorded (D31 deviation).

### 3.3 `updatedAt` on summaries [Owner BD-12]

`PostSummaryDto` gains `updatedAt`, which the sitemap needs (audit gap). It's the same value as `PostDto.updatedAt`.

### 3.4 Full replacement without silent loss [Owner Q3]

`PUT /admin/posts/:id` stays **full replacement** (V1 §5.3). Q3 adds a requirement: an outdated client must never silently erase data it doesn't know about. It must either stay safe or fail explicitly.

**What an existing client omits** (verified against xuan-web `toSavePostInput`, read-only, 2026-10-19). It sends exactly `{ slug, title, excerpt, seoTitle, seoDescription, body }`. So it omits:
- every new field: `tags` (B1), `categoryId` (B2), `coverMediaId`, `coverAlt`, `ogMediaId` (B3);
- a body format declaration.

Its TipTap editor is text-only, so it would silently **drop version 2 nodes** (images, embeds…) when it loads such a post and saves it.

**The mechanism** has two explicit guards. Both are documented in OpenAPI and proven by regression tests that replay the real xuan-web request shape:

1. **Omitted-field guard.**
   - Each new field is optional in `SavePostDto` and **nullable**: an explicit `null` (or `[]` for `tags`) means "clear it".
   - On `POST` (create), an omitted new field means empty, since nothing is stored yet.
   - On `PUT`, an omitted new field is accepted **only if the stored value is already empty**. Then full replacement loses nothing, so old clients keep working on every post that has no new data.
   - If an omitted field's stored value isn't empty, the whole request is rejected with `409 POST_FIELDS_OMITTED`, `details: { fields: ['tags', 'categoryId', …] }` (the omitted fields that hold data), and **nothing is written**.
   - This is not a partial update: a request is either a complete replacement or refused.
   - `coverAlt` follows `coverMediaId` (§5.4).
2. **Body contract version.**
   - `SavePostDto.bodyVersion?: 1 | 2` declares the body format the client's editor speaks. Omitted means `1`, today's client.
   - A request with version 1 may only contain version 1 nodes; version 2 constructs → `400 INVALID` at their path.
   - A version 1 request on a post whose **stored** body is version 2 → `409 POST_BODY_VERSION_UNSUPPORTED`, with no write. The old editor can't have kept nodes it never loaded.
   - The stored version is still the lowest one the document fits (§5.5).

**Creating and publishing with an old client:**
- creating works;
- publishing a post without a category gets the explicit `409 POST_CATEGORY_REQUIRED` (§4.4, BD-3). No data is touched.

Old published posts without a category stay published, readable and editable by an old client (BD-3).

**What "additive" means here:**
- the wire shape: nothing renamed or removed (I19);
- every request body valid today still parses;
- an old client's request either behaves exactly as before or fails explicitly with no data loss.

**Rejected alternatives:**
- "Omitted → unchanged": a silent partial update, which Q3 forbids.
- Switching to `PATCH`: Q3 forbids it.
- An `If-Match`/`updatedAt` precondition: it doesn't detect field loss, because the old client reads a fresh `updatedAt` too.

**Rollout order:**
1. Each backend outcome may deploy before its web change. Old clients stay safe through these guards.
2. The web then upgrades its post form to send every field (explicit `null`/`[]`) and `bodyVersion: 2` once its editor supports version 2.
3. Only then do authors create data an old client would refuse to overwrite.

The frontend handoff (§13) spells this out per outcome.

### 3.5 Response enum widening

`AdminPostSummaryDto.status` gains `'archived'`. That's additive on the wire, but a TypeScript client with an exhaustive `switch` sees a new case at compile time. It's recorded as a delta caveat, like `LESSON_HAS_PROGRESS`.

## 4. Categories (outcome B2) [Owner BD-3, BD-11]

### 4.1 Model

A category has a stable **key** (lowercase kebab-case, immutable, internal) and, per language, a **slug** (for `?category=`) and a **label**. In V1 only `vi` rows exist; English adds rows, not columns.

**`content_categories`:**

| Column | Type | Null | Default | Constraint / why |
|---|---|---|---|---|
| `id` | `uuid` | no | `uuidv7()` | `pk_content_categories` (D26) |
| `key` | `varchar(60)` | no | — | `uq_content_categories_key`; `ck_content_categories_key_format` kebab-case (D30). Immutable after creation (service rule) |
| `status` | `varchar(16)` | no | `'active'` | `ck_content_categories_status`: `IN ('active','archived')` |
| `created_at`, `updated_at` | `timestamptz` | no | `now()` | D27 |

**`content_category_translations`:**

| Column | Type | Null | Default | Constraint / why |
|---|---|---|---|---|
| `id` | `uuid` | no | `uuidv7()` | `pk_content_category_translations` |
| `category_id` | `uuid` | no | — | `fk_content_category_translations_category_id` → `content_categories(id)` `ON DELETE CASCADE`. A translation has no life of its own; deleting a category is already restricted to unused ones |
| `language` | `varchar(16)` | no | `'vi'` | `ck_content_category_translations_language`: `IN ('vi')`, widened with i18n, like posts (B3b) |
| `slug` | `varchar(80)` | no | — | `ck_…_slug_format` (same kebab pattern); `uq_content_category_translations_language_slug (language, slug)` |
| `label` | `varchar(60)` | no | — | `ck_…_label_not_blank` |
| `created_at`, `updated_at` | `timestamptz` | no | `now()` | |

There's also `uq_content_category_translations_category_id_language (category_id, language)`, one row per language.

**`content_posts.category_id`:**
- `uuid NULL`, FK `fk_content_posts_category_id` → `content_categories(id)` `ON DELETE RESTRICT`;
- index `ix_content_posts_category_id_status_published_at_id (category_id, status, published_at, id)` for the public filter and the related query. It also covers the FK's `RESTRICT` check.

Nullable on purpose: existing posts have no category, and drafts may lack one. No data migration is needed (1 post in `xuan_dev`).

### 4.2 Admin API (`@Roles('admin')`; editors → 403) [Owner BD-11]

| Route | Result | Errors |
|---|---|---|
| `GET /admin/post-categories` | `{ data: AdminPostCategoryDto[] }`, every status, ordered by label (Vietnamese collation, §4.6) | `401`, `403` |
| `POST /admin/post-categories` | `201 AdminPostCategoryDto`. Body `CreatePostCategoryDto { key, slug, label }`. Category and `vi` row in one transaction | `400`, `409 CATEGORY_KEY_TAKEN`, `409 CATEGORY_SLUG_TAKEN` |
| `PUT /admin/post-categories/:categoryId` | `AdminPostCategoryDto`. Body `UpdatePostCategoryDto { slug, label }` (full replacement; the key isn't input) | `400`, `404`, `409 CATEGORY_SLUG_TAKEN` |
| `POST /admin/post-categories/:categoryId/archive` · `…/restore` | `AdminPostCategoryDto`. Idempotent, no write when already in that state | `404` |
| `DELETE /admin/post-categories/:categoryId` | `204`, only when no post (any status) references it | `404`, `409 CATEGORY_IN_USE` (checked first, with `RESTRICT` as the backstop: SQLSTATE 23503/23001 on `fk_content_posts_category_id` → the same code) |

`AdminPostCategoryDto = { id, key, slug, label, status, postCount, createdAt, updatedAt }`. `postCount` counts posts of every status, so the admin can see why a delete fails.

A category's slug may change [Proposed]. Category URLs are filter parameters, not content URLs, so BD-2's lock doesn't apply. There's no redirect.

### 4.3 Public API (`@Public()`)

| Route | Result |
|---|---|
| `GET /post-categories` | `{ data: PostCategoryDto[] }`: **active** categories, ordered by label, each `{ slug, label, publishedPostCount }`. Zero counts are included [Proposed: the web may hide them]. One `GROUP BY` |
| `GET /posts?category=<slug>&page&pageSize` | `PostsPageQuery` gains `category?` (kebab, ≤ 80). An unknown or archived slug → **`404 NOT_FOUND`** [Proposed: a precise signal the web can render as not found, instead of a silently unfiltered list] |
| `GET /posts/:slug/related` | `{ data: PostSummaryDto[] }`, at most 3, never the post itself, published only: same category first (newest first), padded with the newest others. A post without a category gets the newest others. The post must be published, otherwise `404` |

`PostSummaryDto` (and so `PostDto`) gains `category: PostCategoryRefDto | null`, which is `{ slug, label }`. It's **`null` when the category is archived** [Proposed]. A retired category's chip would otherwise link to a filter that answers 404. Admin DTOs always show it, with its status.

### 4.4 Category on posts [Owner BD-3]

- **Input:** `SavePostDto.categoryId?: uuid`. Omitted → `null` (§3.4).
- **Assignment rules:**
  - Unknown → `409 CATEGORY_NOT_FOUND`.
  - Archived, and different from the post's current category → `409 CATEGORY_ARCHIVED`. Keeping an archived category that's already assigned is allowed, so editing such a post never fails.
- **Publish gate:**
  - `POST …/publish` on a post without a category → `409 POST_CATEGORY_REQUIRED`.
  - A post whose category is archived → `409 CATEGORY_ARCHIVED` [Proposed]. Archiving a category retires it for new publications; posts already published in it stay published.
  - The check is on the transition only.
- **Legacy published posts** with no category stay published and readable. A `PUT` on them may keep `categoryId` absent [Owner BD-3].
- **Can't lose one:** a `PUT` on a **published** post that **has** a category and would clear it → `409 POST_CATEGORY_REQUIRED` [Proposed: mirrors B18, "a published post can't become invalid"].
- **Admin DTOs** gain `category: AdminPostCategoryRefDto | null`, which is `{ id, key, slug, label, status }`.

### 4.5 Error codes (`content.errors.ts`, 409)

| Code | When |
|---|---|
| `CATEGORY_KEY_TAKEN` | The key already exists |
| `CATEGORY_SLUG_TAKEN` | The slug already exists in the language |
| `CATEGORY_IN_USE` | Deleting a category some post references |
| `CATEGORY_NOT_FOUND` | A post names a category id that doesn't exist |
| `CATEGORY_ARCHIVED` | A post is moved into an archived category |
| `POST_CATEGORY_REQUIRED` | Publishing without a category, or clearing the category of a published post |

### 4.6 Ordering [Proposed]

Labels are sorted in the service with `Intl.Collator('vi')`, because the lists are small. This avoids depending on an ICU collation in the database image. The tie-breaker is `key`.

## 5. Media, cover/OG and body version 2 (outcome B3) [Owner BD-4, BD-5, BD-10, BD-11]

### 5.1 Upload: `POST /admin/media/images` (`@Roles('editor','admin')`)

- **Request:**
  - `multipart/form-data` with exactly one field, `file`;
  - the first non-JSON body (AD9's "revisit when", recorded as a D21 note);
  - parsed by Nest's `FileInterceptor` (multer, already in `@nestjs/platform-express`);
  - limits: `fileSize` 12 MiB, `files` 1, `fields` 0, `parts` 1.
  - CSRF applies, and `X-Requested-With` works with `FormData`.
- **Pipeline, in order:**
  1. Size over the limit → `413 PAYLOAD_TOO_LARGE`. A missing `file` → `400` with `fields[{ field: 'file', code: 'REQUIRED' }]`. Any other part → `400 UNKNOWN_FIELD`.
  2. **Magic-byte sniff:** JPEG, PNG, WebP or AVIF only. The client's MIME type and filename are ignored. GIF, SVG, HEIC and everything else → `400 INVALID` at `file`.
  3. **Decode guard:** `sharp(input, { limitInputPixels: 36_000_000, failOn: 'error' })`. Each side ≤ 6 000 px; more than one page or frame (animation) → `400 INVALID`; decode errors → `400 INVALID`.
  4. **Process:** `rotate()` (EXIF orientation), then for each width in **640, 1280 and 1920** that's no larger than the oriented width, `resize({ width, withoutEnlargement: true })` and WebP at quality 82. An image narrower than 640 gets one variant at its own width. Re-encoding drops every metadata block (EXIF, GPS, XMP, ICC).
  5. **Key:** `blog/<random uuid>`. Variants are stored as `<key>-<width>.webp`. The filename never appears.
  6. **Store** the variants through the storage gateway, then **insert** the `content_media` row. If the insert fails after the upload, the files stay as orphans (accepted by BD-5).
- **Response:** `201 { data: MediaImageDto }`. `MediaImageDto = { id, url, width, height, variants: MediaImageVariantDto[] }`, where `url` is the 1280 variant (or the largest one below it) and `variants` are `{ width, height, url }`, ascending.
- **Errors:** `400`, `401`, `403`, `413`.
- **Ownership:** the uploader is recorded. Any editor or admin may *reference* any existing media id [Proposed]. Media isn't secret once published, V1 has no media management, and restricting references would break an editor editing a post where an admin added an image. A later media library would apply the ownership rule to management actions.

### 5.2 `content_media`

| Column | Type | Null | Default | Constraint / why |
|---|---|---|---|---|
| `id` | `uuid` | no | `uuidv7()` | `pk_content_media` |
| `uploader_id` | `uuid` | no | — | `fk_content_media_uploader_id` → `users(id)` `ON DELETE RESTRICT` (by entity name, AD14); `ix_content_media_uploader_id` |
| `storage_key` | `varchar(80)` | no | — | `uq_content_media_storage_key`; `ck_content_media_storage_key_format` `^blog/[0-9a-f-]{36}$` |
| `content_type` | `varchar(32)` | no | `'image/webp'` | `ck_…_content_type`: `IN ('image/webp')` |
| `width`, `height` | `integer` | no | — | Of the largest variant. `ck_…_dimensions` 1–6 000 |
| `variant_widths` | `smallint[]` | no | — | `ck_…_variant_widths_not_empty` `cardinality >= 1` |
| `byte_size` | `integer` | no | — | Total over the variants, ≥ 1 |
| `created_at` | `timestamptz` | no | `now()` | No `updated_at`: the row never changes (D27) |

**`content_posts` gains:**

| Column | Type | Null | Constraint |
|---|---|---|---|
| `cover_media_id` | `uuid` | yes | `fk_content_posts_cover_media_id` → `content_media(id)` `RESTRICT`; `ix_content_posts_cover_media_id` |
| `cover_alt` | `varchar(200)` | yes | `ck_content_posts_cover_alt`: `(cover_media_id IS NULL AND cover_alt IS NULL) OR (cover_media_id IS NOT NULL AND btrim(cover_alt) <> '')` |
| `og_media_id` | `uuid` | yes | `fk_content_posts_og_media_id` → `content_media(id)` `RESTRICT`; `ix_content_posts_og_media_id` |

The `body_version` CHECK widens to `IN (1, 2)`.

### 5.3 Storage gateway [Owner BD-4; C5]

- **Interface:** `MediaStorage.put(key, bytes, contentType): Promise<void>` and `publicUrl(key): string`. There's no delete in V1 (orphans are kept).
- **Adapters:**
  - `LocalMediaStorage` writes under `MEDIA_LOCAL_DIR`, which is git-ignored. Keys are validated against the key pattern, so there's no traversal.
  - `R2MediaStorage` uses `@aws-sdk/client-s3` against `https://<account>.r2.cloudflarestorage.com`, with `Cache-Control: public, max-age=31536000, immutable` and `Content-Type: image/webp`.
- **Selection by config, validated before listening (I5):**

| Variable | Rule |
|---|---|
| `MEDIA_STORAGE` | `local` · `r2` · `disabled`. **Required in production and never `local` there**. Development and test default to `local` |
| `MEDIA_PUBLIC_BASE_URL` | URL with no trailing slash. With `r2`, an `https:` origin (the bucket's custom domain). With `local`, defaults to `http://localhost:<PORT>/media` |
| `MEDIA_LOCAL_DIR` | Default `./storage/media`. The test env uses its own folder |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Required only with `r2`. Values never printed (I5) |

- **`disabled`:** `POST /admin/media/images` → `409 MEDIA_STORAGE_DISABLED`, and no file is written. It's for a production API that launches before R2 exists. It's an explicit setting, never a silent fallback [Owner Q1]. Auth, courses and text-only blog endpoints work unchanged in that mode, and no R2 variable is needed to boot.
- **Development serving:** with `local`, `configureApp()` serves `MEDIA_LOCAL_DIR` at `/media` (`express.static`):
  - `.webp` only;
  - no directory index, no dotfiles;
  - `X-Content-Type-Options: nosniff`;
  - `Cross-Origin-Resource-Policy: cross-origin` on `/media` only [Proposed]: helmet's global `same-origin` would block xuan-web on another localhost port. Everything else keeps helmet's defaults;
  - a missing file is the static 404.

  It's not an API route, so there's no envelope and no OpenAPI.
- **The owner's R2 setup checklist** (no purchase now; needed before production uploads):
  1. A bucket.
  2. A public custom domain on the bucket. Use that as `MEDIA_PUBLIC_BASE_URL`.
  3. An API token with Object Read & Write **scoped to that bucket**.
  4. The `R2_*` variables in the production secret store.
  5. Optionally, CORS isn't needed: uploads go through the API.

### 5.4 Cover and OG [Owner BD-12]

- **Input:** `SavePostDto` gains `coverMediaId?`, `coverAlt?` (trimmed, 1–200, **required with a cover**, otherwise `400 REQUIRED`/`INVALID`) and `ogMediaId?`.
- **Unknown ids** → `409 POST_MEDIA_NOT_FOUND`. A non-existent media id isn't a format error.
- **Responses:**
  - `PostSummaryDto` and `PostDto` gain `coverImage: PostImageDto | null`, where `PostImageDto = { url, width, height, alt, variants: MediaImageVariantDto[] }`.
  - `PostDto` gains `ogImage: PostImageDto | null` (its `alt` is the cover alt or the title [Proposed]). The web falls back to the cover.
  - Admin DTOs gain `coverImage` and `ogImage` with `mediaId`.
- **Not required to publish** [Proposed]: the owner made a category required, not a cover.

### 5.5 Body version 2 [Owner BD-10]

**What's new:** version 2 = the version 1 allow-list (V1 spec §4.1, unchanged) **plus:**

| Node / mark | Attributes (anything else → 400) |
|---|---|
| `image` (block) | `src`: a **media URL** (below); `alt`: 1–300 characters, trimmed, required; `title`: `string \| null`, ≤ 300; `width`, `height`: integers 1–6 000 |
| `beforeAfter` (block) | `before`, `after`: a media URL or `""` (not uploaded yet); `beforeAlt`, `afterAlt`: 1–300 characters; `caption`: ≤ 300, `""` allowed; `initial`: integer 0–100; `width`, `height`: integers 1–6 000 |
| `horizontalRule` (block) | none |
| `codeBlock` (block) | `language`: `null` or one of `bash, css, html, javascript, json, jsx, plaintext, python, sql, tsx, typescript, yaml` [Proposed list]. Content: `text` nodes **without marks** only |
| `videoEmbed` (block) | `provider`: `'youtube' \| 'vimeo'`; `videoId`: YouTube `^[A-Za-z0-9_-]{11}$`, Vimeo `^[0-9]{1,20}$`. **Ids, never URLs or iframes**: the web builds the embed |
| Marks `underline`, `strike`, `code` | none. `code` can't be combined with `link` [Proposed: TipTap's default excludes it] |
| `link.href` | Version 1 rules **plus** a site-relative `/path` (starts with exactly one `/`, no `\`, no whitespace or control characters, ≤ 2 048) and a fragment `#id` (`^#[A-Za-z0-9_-]{1,200}$`) |

**Media URL:**
- It must equal `MEDIA_PUBLIC_BASE_URL + '/' + <storage_key> + '-' + <width> + '.webp'`, where `<width>` is one of that media's `variant_widths`. External hosts, other paths and other widths → `400 INVALID` at the attribute path.
- After the format check, the service resolves every referenced key in one query. Unknown → `409 POST_MEDIA_NOT_FOUND`.
- A change of `MEDIA_PUBLIC_BASE_URL` after content exists needs a data migration that rewrites the prefix (roll-forward, C9). It's recorded in `database.md`.

**Version selection** [Proposed]:
- The server stores the **lowest version whose allow-list accepts the document**: a text-only document stays `bodyVersion: 1`, and anything using a version 2 construct is stored as 2.
- The client declares the format its editor speaks with `bodyVersion?: 1 | 2` (omitted = 1, §3.4). The server never trusts that as the stored version: it stores the lowest version that fits.
- An unchanged web renderer therefore keeps rendering every text-only post. Stored version 1 documents stay valid forever (V1 §4.2).
- OpenAPI documents the version 2 schema (`PostBodyDocument`, `PostBodyNode` and `PostBodyMark` widen additively). Versions are distinguished by `bodyVersion`.

**Limits:** V1 §4.3 is unchanged (256 KiB, 5 000 nodes, depth 12, 10 000 characters per text node). The 512 kB post-write parser is unchanged.

**Publish gate** (extends B18):
- A `beforeAfter` with `before` or `after` equal to `""` makes the post **incomplete**.
- `publish` → `409 POST_MEDIA_INCOMPLETE`.
- A `PUT` on a published post with an incomplete block → `409 POST_MEDIA_INCOMPLETE`.
- Drafts may be incomplete.
- B18's meaningful-text rule is unchanged.

**Alt text** belongs to the placement (a node attribute), not to the file (BD-10 notes).

### 5.6 Error codes (409)

| Code | When |
|---|---|
| `POST_MEDIA_NOT_FOUND` | A cover, OG or body image references media that doesn't exist |
| `POST_MEDIA_INCOMPLETE` | Publishing, or keeping published, a post with an unfinished before/after block |
| `MEDIA_STORAGE_DISABLED` | An upload while `MEDIA_STORAGE=disabled` [Owner Q1] |
| `POST_BODY_VERSION_UNSUPPORTED` | A `PUT` declaring body version 1 on a post stored as version 2 (§3.4) |

## 6. Discussion and moderation (outcome B4) [Owner BD-6, BD-7, BD-8]

### 6.1 Tables

**`content_post_ratings`:**

| Column | Type | Null | Default | Constraint / why |
|---|---|---|---|---|
| `id` | `uuid` | no | `uuidv7()` | `pk_content_post_ratings` |
| `post_id` | `uuid` | no | — | `fk_content_post_ratings_post_id` → `content_posts(id)` `RESTRICT` |
| `user_id` | `uuid` | no | — | `fk_content_post_ratings_user_id` → `users(id)` `RESTRICT` (by name); `ix_content_post_ratings_user_id` |
| `value` | `smallint` | no | — | `ck_content_post_ratings_value`: 1–5 |
| `status` | `varchar(16)` | no | `'visible'` | `ck_…_status`: `IN ('visible','hidden')` [Owner Q2] |
| `moderated_by` | `uuid` | yes | — | `fk_content_post_ratings_moderated_by` → `users(id)` `RESTRICT` |
| `moderated_at` | `timestamptz` | yes | — | `ck_…_moderation_pair`: both set or both null |
| `created_at`, `updated_at` | `timestamptz` | no | `now()` | |

There's also `uq_content_post_ratings_post_id_user_id`, one per user per post **regardless of status** (BD-6). It's the upsert target (D32), and it leads `(post_id, …)`, which serves the summary and the post FK.

**`content_post_comments`:**

| Column | Type | Null | Default | Constraint / why |
|---|---|---|---|---|
| `id` | `uuid` | no | `uuidv7()` | `pk_content_post_comments` |
| `post_id` | `uuid` | no | — | `fk_content_post_comments_post_id` → `content_posts(id)` `RESTRICT` |
| `user_id` | `uuid` | no | — | `fk_content_post_comments_user_id` → `users(id)` `RESTRICT`; `ix_content_post_comments_user_id` |
| `body` | `varchar(2000)` | no | — | `ck_content_post_comments_body_not_blank`. Plain text; the length is counted in characters by the API |
| `status` | `varchar(16)` | no | `'visible'` | `ck_…_status`: `IN ('visible','hidden','deleted')` |
| `edited_at` | `timestamptz` | yes | — | Set by the owner's edit only |
| `moderated_by`, `moderated_at` | | yes | — | As for ratings, plus a pair CHECK |
| `created_at`, `updated_at` | `timestamptz` | no | `now()` | |

There's also `ix_content_post_comments_post_id_status_created_at_id` for the public list (oldest first).

`RESTRICT` everywhere [Proposed]:
- Posts with discussion are never deleted (§3.1).
- Users are never deleted in V1.

So a violation is a bug, which gives a 500 (I15).

### 6.2 Reader API

Every route needs the post to be **published**; otherwise (missing, draft, archived) → `404`.

| Route | Auth | Result | Errors |
|---|---|---|---|
| `GET /posts/:slug/comments?page&pageSize` | public | `{ data: { items: PostCommentDto[], pageInfo } }`: **visible** only, oldest first (`created_at, id`), `pageSize` 1–50, default 10. Query `PostCommentsQuery` | `400`, `404` |
| `GET /posts/:slug/discussion/me` | signed in | `{ data: MyPostDiscussionDto }` = `{ rating: number \| null, ownCommentIds: string[] }`. The caller's rating (in any status) and the ids of their **visible** comments on this post (≤ 500, newest first), so the web can show edit and delete [Proposed: public DTOs stay free of author ids] | `401`, `404` |
| `PUT /posts/:slug/rating` | signed in | `204`. Body `SavePostRatingDto { value: 1–5 }`. One `INSERT … ON CONFLICT ON CONSTRAINT uq_content_post_ratings_post_id_user_id DO UPDATE SET value, updated_at` that **keeps `status`**: a hidden rating stays hidden | `400`, `401`, `403` (CSRF), `404`, `429` |
| `POST /posts/:slug/comments` | signed in | `201 PostCommentDto`. Body `SavePostCommentDto { body }` | `400`, `401`, `403`, `404`, `429` |
| `PUT /post-comments/:commentId` | signed in, owner | `PostCommentDto`, which sets `edited_at`. Only a **visible** comment on a published post | `400`, `401`, `403` (not the owner, or CSRF), `404` (missing, or the post isn't published), `409 COMMENT_NOT_EDITABLE` (hidden or deleted), `429` |
| `DELETE /post-comments/:commentId` | signed in, owner | `204`. Status becomes `deleted`; already deleted → `204`, no write. A hidden comment may be deleted by its owner | `401`, `403`, `404`, `429` |

- **Comment body:** trimmed, `\r\n` → `\n`, 1–2 000 characters (code points), storable text.
- **Rendering:** plain text only, escaped by the web, newlines kept.
- **Ownership** is always the session user (I9). Editors and admins have no special power here as readers. An admin who wants a comment gone uses moderation.

`PostCommentDto = { id, body, createdAt, editedAt: string | null, author: PostAuthorDto }`. There's no author id, no email and no status. `PostSummaryDto` and `PostDto` gain `ratingSummary: { average: number | null, count: number }`:
- visible ratings only;
- `average` is rounded to 2 decimals and `null` when the count is 0;
- one grouped query per page.

**Independence** [Owner BD-6]: a rating needs no comment, and a comment needs no rating.

### 6.3 Moderation (`@Roles('admin')`) [Owner BD-7]

| Route | Result |
|---|---|
| `GET /admin/post-comments?status&postId&page&pageSize` | `AdminPostCommentDto` page, newest first, every status by default |
| `GET /admin/post-ratings?status&postId&page&pageSize` | `AdminPostRatingDto` page, newest first |
| `POST /admin/post-comments/:commentId/hide` · `…/restore` · `…/delete` | `AdminPostCommentDto` |
| `POST /admin/post-ratings/:ratingId/hide` · `…/restore` | `AdminPostRatingDto` |

**Transitions** [Owner Q2]:
- `hide`: visible → hidden.
- `restore`: hidden → visible.
- `delete` (comments): visible or hidden → deleted.
- **`deleted` is terminal for everyone.** Restoring a comment that its author deleted would republish words the author withdrew, so an admin who wants reversibility hides instead. `hide` or `restore` on a deleted comment → `409 COMMENT_DELETED`.
- A transition to the current state returns unchanged, with no write.
- Each real transition sets `moderated_by` (the session admin) and `moderated_at`.
- **Ratings** have `visible` and `hidden` only: a 1–5 value has no content to remove, and hiding already removes it from the summary.

Admin DTOs:
- `AdminPostCommentDto = { id, post: { id, slug, title }, author: AdminPostAuthorDto, body, status, editedAt, moderatedAt, moderatedBy: AdminPostAuthorDto | null, createdAt, updatedAt }`;
- `AdminPostRatingDto` is the same shape with `value` in place of the body fields.

There are no emails [Proposed: consistent with `CourseAccessUserDto`; `UserProfilesReader` exposes none]. There's no global ban (BD-7).

### 6.4 Rate limit [Owner BD-8; spike S5]

- **Dependency:** `@nestjs/throttler`, with the in-memory store (one instance today, recorded).
- **Which routes:** the guard applies to the **discussion write** routes only, keyed by the **session user id**, so no IP or `trust proxy` is involved.
- **Limits** [Proposed]: **5 writes per minute and 60 per hour** per user, across all discussion writes.
- **Over the limit:** `429 RATE_LIMITED` with a `Retry-After` header. `RATE_LIMITED` joins `baselineErrors`. Every throttled route documents it (I18).
- **Order:** the global `AccessGuard` (401) and `CsrfGuard` run first, so anonymous requests aren't counted.

D23's site-wide launch gate (public writes, `trust proxy`) stays open for the launch work.

### 6.5 Error codes (409)

`COMMENT_NOT_EDITABLE`, `COMMENT_DELETED`.

## 7. Role and access matrix

| Action | guest | user | editor | admin |
|---|---|---|---|---|
| Read published posts, categories, related posts, comments | ✓ | ✓ | ✓ | ✓ |
| Rate, comment, edit or delete own comments | 401 | ✓ | ✓ | ✓ |
| Author posts: lifecycle, tags, category, cover, upload | 401 | 403 | own posts (upload: ✓) | ✓ |
| Manage categories | 401 | 403 | 403 | ✓ |
| Moderate | 401 | 403 | 403 | ✓ |

## 8. Security and privacy

- **XSS boundary:** the body allow-list (V1 §4 and §5.5) still is it. There are no iframes, only provider ids. Images come only from our media base. Links get only the schemes listed plus `/path` and `#id`.
- **Uploads:**
  - The content type comes from magic bytes, and everything is re-encoded.
  - Metadata is stripped; there's a pixel bomb guard and a size limit.
  - Keys are random, so filenames are never stored or served.
  - The local server sends `nosniff`, and SVG is never accepted.
- **Discussion:**
  - Plain text, with escaping as the web's duty (documented).
  - No emails on any discussion DTO.
  - The author is always the session user.
  - There's a rate limit.
  - Moderation is admin-only.
- **Logs:** no request bodies or files are logged (I17).
- **Secrets:** R2 secrets are config-only, never printed (I5). The owner's `.env` isn't touched by agents.

## 9. Data and migrations

| Outcome | Migration (one logical change each, D33) | Existing rows |
|---|---|---|
| B1 | Widen `ck_content_posts_status` to `('draft','published','archived')`; add `tags varchar(40)[] NOT NULL DEFAULT '{}'` + `ck_content_posts_tags_count` | Safe: constant default, no rewrite needed (PostgreSQL 11+) |
| B2 | `content_categories`, `content_category_translations`, `content_posts.category_id` + FK + index | Nullable column, so no backfill |
| B3 | `content_media`; `content_posts.cover_media_id`, `cover_alt`, `og_media_id` + FKs + indexes + `ck_content_posts_cover_alt`; `ck_content_posts_body_version` → `IN (1, 2)` | Nullable, so no backfill |
| B4 | `content_post_ratings`, `content_post_comments` | New tables |

Each outcome follows `xuan-database-change`:
1. The map goes into `database.md` §12 first, with owner approval (Checkpoint M, with the plan).
2. Generate, then read the SQL.
3. On `xuan_test` (Checkpoint A): run, revert, re-run and an empty second generate.
4. e2e.
5. On `xuan_dev`: its own packet (Checkpoint D).

Every `down()` is meaningful. B1's `down()` fails if an archived post exists; that's documented as a roll-forward (C9).

## 10. Contract summary (all additive, BD-12)

| Outcome | New routes | Changed DTOs (fields added) | New codes |
|---|---|---|---|
| B1 | `POST /admin/posts/:id/archive` · `…/restore`, `DELETE /admin/posts/:id` | `PostSummaryDto` + `updatedAt`; `PostDto` + `tags`; admin DTOs + `tags`, status `+'archived'`; `SavePostDto` + `tags?` (nullable, §3.4); `AdminPostsQuery.status` + `archived` | `POST_ARCHIVED`, `POST_WAS_PUBLISHED`, `POST_FIELDS_OMITTED` (§3.4) |
| B2 | `GET /post-categories`, `GET /posts/:slug/related`, 6 admin category routes | + `category` on post and admin DTOs; `SavePostDto` + `categoryId?`; `PostsPageQuery` + `category?` | §4.5 |
| B3 | `POST /admin/media/images` | + `coverImage`, `ogImage`; `SavePostDto` + `coverMediaId?`, `coverAlt?`, `ogMediaId?`, `bodyVersion?`; body schema widened; `bodyVersion` may be 2 | §5.6, `POST_BODY_VERSION_UNSUPPORTED` (§3.4) |
| B4 | 6 reader routes, 7 admin moderation routes | `PostSummaryDto` + `ratingSummary` | §6.5 + baseline `RATE_LIMITED` |

New request components and DTO names are I19 identifiers once merged. Every route documents every code it can return (I18). Each outcome adds rows to the `api-contract.md` §12 xuan-web delta table.

## 11. Spikes (run first in their outcome's plan)

| # | Question | Outcome | If it fails |
|---|---|---|---|
| S1 | Does `varchar(40)[]` enforce element length on insert and update, and does a second generate stay empty with the array column and `cardinality` CHECK? | B1 | The limit becomes application-only, with the reason recorded |
| S2 | Multer under the contract: `LIMIT_FILE_SIZE` → `413 PAYLOAD_TOO_LARGE` envelope; a missing file or an extra part → `400` with `fields[]`; CSRF; OpenAPI shows a `multipart/form-data` body | B3 | Map multer errors in a small translator in `http/` |
| S3 | sharp 0.34+ on Node 24 Windows/Linux: `limitInputPixels`, multi-page detection, the output has no EXIF or GPS, orientation applied | B3 | Stop. An image library choice goes back to the owner |
| S4 | `express.static` at `/media` with only the local driver: no envelope, `nosniff`, CORP `cross-origin` on `/media` only, traversal blocked | B3 | A tiny controller-free handler |
| S5 | `@nestjs/throttler` v6+ with a user-id tracker after the global guards; `ThrottlerException` → `429 RATE_LIMITED` envelope + `Retry-After` | B4 | A small in-memory sliding-window guard in `content/discussion/` |

The R2 adapter is unit-tested against a mocked S3 client. A real R2 smoke test is a launch step once the owner's bucket exists.

## 12. Testing (D39, D40) and acceptance

Each outcome is done when, **with output observed**:
- **Unit tests:**
  - body version 2 validation, table-driven per node, mark, attribute and URL form, including version selection;
  - the media URL parser;
  - tag normalization;
  - the transition tables;
  - the rating average.
- **e2e on `xuan_test`:**
  - every route outcome, with exact bodies;
  - role and ownership (guest 401, user 403, other editor 403);
  - the public 404 for draft, archived and unknown posts;
  - every 409 in §3–§6;
  - idempotent transitions without writes (`updatedAt` unchanged);
  - legacy-post compatibility: a published post without a category stays readable and editable;
  - an old-shape `SavePostDto` (no new fields) still accepted;
  - upload: JPEG/PNG/WebP/AVIF accepted; GIF, SVG, a renamed text file, an animation and an over-size image rejected; the output has no metadata; variants exist;
  - `MEDIA_STORAGE=disabled` → 409;
  - throttle → 429;
  - moderation transitions, including the terminal `deleted`;
  - visible-only public reads, with no email anywhere.
- **Schema e2e:** every new CHECK, unique and FK, by name.
- **OpenAPI e2e:** pins every new component, field and route's exact codes. Additive diff only.
- **Checks:** lint, typecheck, unit, e2e, build. `xuan-api-architecture-review` passes, and a fresh independent review has no open Critical or Important finding.
- **Docs:** the §14 changes, in the same branch.

## 13. Frontend integration (xuan-web, its own outcomes)

- Admin list tabs for archived posts; row actions for archive, restore and delete.
- A tags input.
- A category select; the category admin page.
- Cover and OG pickers.
- The upload helper (XHR progress, `X-Requested-With`).
- Editor nodes for version 2: image, before/after, horizontal rule, code block, embed by id, underline/strike/code, internal and anchor links.
- A renderer for version 2: image `srcset` from `variants`; the before/after island; YouTube/Vimeo URLs built from the ids; escaped plain-text comments.
- Category filter chips; related articles.
- Discussion UI, including 429 handling; the moderation page.
- Regenerated OpenAPI types (`status` gains `archived`).
- **Q3 compatibility:** the post form must send **every** `SavePostDto` field (explicit `null`/`[]` to clear). It sends `bodyVersion: 2` only once its editor loads and keeps every version 2 node. Handle `409 POST_FIELDS_OMITTED` (`details.fields`) and `409 POST_BODY_VERSION_UNSUPPORTED` with a "reload in an updated editor" message.
- **Slugs:** no backend change. The web already slugifies Vietnamese titles and handles `409 POST_SLUG_TAKEN` by asking for another slug. A server-side availability endpoint would race with the insert anyway, so the unique constraint stays the single source of truth. Published slugs stay locked (B17).
- **Caching:** the web caches public blog reads for about 5 minutes (`revalidate`). After a successful admin mutation (publish, unpublish, archive, restore, delete, a `PUT` of a published post, category changes), the admin screen calls a **Next.js server action in xuan-web** that runs `revalidatePath`/`revalidateTag` for `/blog`, the article and the category pages. That needs no backend webhook or shared secret. Discussion reads should stay uncached, or use a short client fetch.
- **CSRF (reviewed 2026-10-19, no change):** the session cookie is `SameSite=Lax`. Every non-GET needs `X-Requested-With: XMLHttpRequest`, which forces a CORS preflight against the exact origin list, and a present `Origin` must be allowed. The upload's `FormData` keeps the same header. OAuth callbacks are `GET` and unaffected.

## 14. Documentation changes (each in its outcome's branch)

| Doc | Changes |
|---|---|
| `data-model.md` | §3 content rows (lifecycle, tags, categories, media, discussion); §5: OD-5, OD-6 (archive part), OD-7 resolved; scheduling, preview and search stay deferred |
| `database.md` | §12 maps per outcome; the base-URL roll-forward note |
| `architecture.md` | §3 layout (`content/media/`, `content/discussion/`); §13 ADs for the storage gateway and media pipeline, the first multipart body (AD9/D21), and the discussion throttle; §15 rows resolved or updated; §16 spike results |
| `code-rules.md` | D21 notes the multipart upload route |
| `api-contract.md` | Routes, DTOs, components, codes, `RATE_LIMITED` implemented, delta rows |
| `development-workflow.md` | Local media folder and env variables (§4) |
| `.env.example` | `MEDIA_*` (no secrets) |
| `CLAUDE.md` | Status line when the slice completes |

## 15. Owner decisions recorded (BD-1…BD-13, 2026-10-19)

| # | Decision | Where |
|---|---|---|
| BD-1 | States draft, published and archived; hard delete only for never-published drafts; restore → draft | §3.1 |
| BD-2 | Published slugs stay locked; no redirect table | V1 B17, unchanged |
| BD-3 | Categories in `content_categories` + `content_category_translations`, Vietnamese first; one per post, admin-only; delete only when unused, else archive; required to publish, with legacy published posts allowed without one; simple tags on the post | §3.2, §4 |
| BD-4 | Cloudflare R2 behind a provider boundary, local storage in development; no silent production fallback; no purchase or credential; a setup checklist | §5.3 |
| BD-5 | A `content_media` table; orphaned uploads kept | §5.2 |
| BD-6 | Ratings and comments independent; one changeable rating per user per post; plain-text comments of 1–2 000 characters, editable and soft-deletable by their owner; only on published posts | §6 |
| BD-7 | Admin-only moderation (hide, restore, soft-delete); no global ban; whether a deleted item can be restored is clarified here | §6.3, Q2 |
| BD-8 | A per-user rate limit on discussion writes | §6.4 |
| BD-9 | English and translations deferred | §1 |
| BD-10 | Body version 2: images, before/after, horizontal rule, code blocks, underline/strike/inline code, YouTube/Vimeo ids, anchor and site-relative links | §5.5 |
| BD-11 | Editors and admins upload; categories and moderation are admin-only | §5.1, §7 |
| BD-12 | Additive-only API changes | §3.4, §10 |
| BD-13 | Blog delegation recorded in §3.5 | PR #16 (`6db8a8a`) |

## 16. Owner answers (2026-10-19)

| # | Question | Answer |
|---|---|---|
| Q1 | Can production run with uploads switched off? | **Approved.** `MEDIA_STORAGE=disabled` → uploads get `409 MEDIA_STORAGE_DISABLED` (the stable envelope). Auth, course and text-only blog endpoints keep working. Production never falls back to local disk. No R2 credential is needed to start unrelated APIs. Local development uses the local adapter; a configured R2 uses R2. No purchases, accounts or exposed credentials |
| Q2 | Moderation and deletion | **Approved.** A comment deleted by its author is permanently non-restorable, and admins can't restore it. Admins hide and restore comments that aren't deleted. **Admin soft-delete is final as well.** Ratings support hide and restore only and can't be deleted in V1. Hidden ratings don't count in public summaries. Deleted comments never appear publicly |
| Q3 | Full-replacement `PUT` and frontend compatibility | **Approved with safeguards:** keep full replacement, but an outdated client must never silently erase new data. It must stay safe or fail explicitly, with a documented and tested mechanism, no `PATCH` switch, and a documented rollout order. Realized in §3.4 (omitted-field guard + body contract version) |

**My calls, for checking while reading** (all marked [Proposed]):
- restore of a non-archived post is a no-op;
- an archived never-published post must be restored before it can be deleted;
- tags can't contain commas, and duplicates are rejected, not dropped;
- unknown or archived category filter → 404;
- public `category` is `null` for archived categories;
- publishing into an archived category → 409;
- category slugs stay editable;
- any editor or admin may reference any media;
- the server picks the lowest body version that fits;
- `codeBlock` language allow-list;
- comment ownership surfaced through `GET /posts/:slug/discussion/me`, not public author ids;
- no emails in moderation DTOs;
- throttle 5 per minute and 60 per hour per user;
- CORP `cross-origin` on local `/media`;
- labels sorted in the service.

## 17. Implementation sequence

B1 → B2 → B3 → B4, each from the latest `dev` after the previous one merged, with its own plan, Checkpoint M, A and D, and its own PR. Dependencies:
- `@aws-sdk/client-s3` and `sharp` arrive in B3;
- `@nestjs/throttler` arrives in B4.

Each arrives with its outcome (workflow §6). The existing `test/http-contract.e2e-spec.ts` format failure on `dev` is unrelated to the blog work. It gets its own `fix/*` branch from `dev`, between outcomes (`xuan-git-branch-cohesion`).

## 18. Consistency review after approval (2026-10-19)

A focused review of this spec against the owner's directive, BD-1…BD-13 and Blog V1's B1–B19:

| Area | Finding | Resolution |
|---|---|---|
| §16 calls | Every [Proposed] call stays within BD-1…BD-13 and Q1–Q3. None reopens a product decision. "Unknown or archived category filter → 404" and "public `category` null when archived" are presentation calls, consistent with BD-3's "archive instead of delete" | Kept |
| Compatibility | The proposed "omitted → cleared" would silently erase data under Q3. The old editor would also drop version 2 nodes | Replaced by §3.4's two guards (two new 409 codes, documented and tested) |
| Destructive operations | Only `DELETE /admin/posts/:id` hard-deletes, and only never-published drafts (BD-1). Everything else is a state change. Migrations add, or widen a CHECK; none drops data | Kept. B1's `down()` documents its roll-forward (C9) |
| `xuan_dev` scope (§3.5 bounded row) | B1 and B3 change existing CHECKs, and B2/B3 add FKs or CHECKs to `content_posts`, so those are owner-approved per the row. B4 adds only new tables, but would wait behind an earlier pending migration | Every `xuan_dev` run goes into one consolidated owner packet. The PRs merge on full `xuan_test` evidence (§3.5 row). No design was weakened to avoid approval |
| Security | Upload pipeline, no iframes, media-only image hosts, plain-text comments, no emails, per-user throttle; CSRF reviewed without change | Kept |
| V1 invariants | B16 (`publishedAt`), B17 (slug lock), B18 (meaningful text), B14 (last write wins) and B13 (no draft leaks) are unchanged. Archived posts join B13's 404 | Kept |
