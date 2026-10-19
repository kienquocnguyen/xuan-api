# Post media and body version 2 (blog outcome B3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (Native, owner-chosen) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Editors and admins upload images safely: re-encoded to WebP variants and stored locally in development or on Cloudflare R2.
- Images serve as a post's cover and OG image and inside the article body.
- Body version 2 adds the richer nodes, under a version contract that never lets an old editor drop them.

**Architecture:**
- **Storage:** `modules/content/media/` owns `content_media`, the image pipeline (`sharp`) and the C5 storage gateway (`MediaStorage` with `local`, `r2` and `disabled` adapters, chosen from config).
- **Upload parsing:** a generic single-file upload interceptor in `http/upload/` turns multer errors into the contract.
- **Body:** version 2 is the superset schema behind the existing component names. Version 1 stays as the gate for requests that declare (or default to) version 1. The service checks media URLs against the configured base and `content_media`.

**Tech Stack:** NestJS 12 · TypeORM 1.1 · PostgreSQL 18 · Zod 4 · `sharp` 0.34 · `@aws-sdk/client-s3` 3 · multer (from `@nestjs/platform-express`) · Vitest + supertest.

**Spec:** `docs/superpowers/specs/2026-10-19-blog-completion-design.md`:
- §5 (all), §3.4 (body contract version);
- §10: B3 row;
- §11: spikes S2–S4;
- §12; §16 Q1; §18.

**Execution scope:** the bounded row (workflow §3.5):
- `xuan_test` is autonomous.
- `xuan_dev` is **protected**: B1 and B2 are pending, and B3 replaces `ck_content_posts_body_version` and adds a CHECK and FKs on `content_posts`. It goes into the owner packet as entry 3.
- No R2 account or credential is used. The R2 adapter is unit-tested with a mocked client.

**Spike S3 (done, 2026-10-19):** `sharp` 0.34.5 / libvips 8.17.3 on Node 24 under Windows:
- `rotate()` applies EXIF orientation 6 (400×200 → 200×400);
- WebP output has no EXIF, ICC or XMP;
- `limitInputPixels` rejects a 7000×6000 PNG at the header;
- `sharp(frames, { join: { animated: true } })` builds a 2-page WebP, which `metadata().pages` reports;
- garbage → "unsupported image format".

## Global Constraints

- **Config (`src/config/` only, I4/I5):**

  | Variable | Rule |
  |---|---|
  | `MEDIA_STORAGE` | `local` · `r2` · `disabled`. Default `local` in development and test; **required in production, where `local` is refused** |
  | `MEDIA_PUBLIC_BASE_URL` | No trailing slash. Default `http://localhost:<PORT>/media` with `local`. Required and `https:` with `r2` |
  | `MEDIA_LOCAL_DIR` | Default `storage/media` (development) or `storage/media-test` (test). `storage/` is git-ignored |
  | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Required only with `r2`, never printed |

  `AppConfig.media = { storage, publicBaseUrl, localDir, r2: { accountId, accessKeyId, secretAccessKey, bucket } | null }`.
- **Upload:** `POST /admin/media/images`, `@Roles('editor','admin')`, CSRF, `multipart/form-data` with exactly one part `file`.
  - **Limits:** 12 MiB (`12 * 1024 * 1024`) → `413 PAYLOAD_TOO_LARGE`.
  - **Missing file** → `400` `fields[{ field: 'file', code: 'REQUIRED' }]`.
  - **Any other part** → `400` `UNKNOWN_FIELD` at that part's name.
  - **Magic bytes:** JPEG `FF D8 FF`; PNG `89 50 4E 47 0D 0A 1A 0A`; WebP `RIFF????WEBP`; AVIF `????ftypavif` or `????ftypavis`. Anything else → `400 INVALID` at `file`, message "Upload a JPEG, PNG, WebP or AVIF image.".
  - **Decode:** `sharp(buf, { limitInputPixels: 36_000_000, failOn: 'error' })`. `metadata().pages > 1`, a decode error, or an oriented side over 6 000 → `400 INVALID` at `file`.
  - **Variants:** widths `[640, 1280, 1920]` no larger than the oriented width (else one variant at that width). Each is `rotate()` → `resize({ width, withoutEnlargement: true })` → `webp({ quality: 82 })`.
  - **Key:** `blog/<randomUUID()>`; files `<key>-<width>.webp`.
  - **Disabled:** `409 MEDIA_STORAGE_DISABLED` "Image uploads are switched off on this server.", checked before any processing.
- **`MediaImageDto`** = `{ id, url, width, height, variants: { width, height, url }[] }`. `url` is the 1280 variant, or the largest below it.
- **Media URL:** `MEDIA_PUBLIC_BASE_URL + '/' + storage_key + '-' + width + '.webp'`, with `width` among that media's `variant_widths`.
  - Format failure → `400 INVALID` at the attribute path, message "Images must come from the media library.".
  - Unknown media → `409 POST_MEDIA_NOT_FOUND` "The chosen image doesn't exist.".
- **Posts:**
  - `coverMediaId?: uuid | null`, `coverAlt?: string | null` (trimmed, 1–200, **required with a cover**, not allowed without one), `ogMediaId?: uuid | null`;
  - guard rows `coverMediaId`, `ogMediaId` (§3.4); `coverAlt` follows `coverMediaId`;
  - **`bodyVersion?: 1 | 2`:** omitted means 1. Version 1 requests may only contain version 1 nodes. A version 1 request on a stored version 2 post → `409 POST_BODY_VERSION_UNSUPPORTED` "This post needs an editor that supports body version 2.";
  - **stored version** = 1 if the document passes the version 1 schema, else 2;
  - **incomplete before/after** (`before` or `after` is `""`) → `409 POST_MEDIA_INCOMPLETE` "Finish the before/after images first." on publish, and on `PUT` of a published post.
- **DTOs:**
  - `PostImageDto` = `{ url, width, height, alt, variants }`;
  - `PostSummaryDto` + `coverImage: PostImageDto | null`;
  - `PostDto` + `ogImage: PostImageDto | null` (alt = cover alt, else title);
  - `AdminPostImageDto` = `PostImageDto` + `mediaId`;
  - `AdminPostSummaryDto` + `coverImage`, `ogImage` (`AdminPostImageDto | null`).
- **Local serving:** `/media/*.webp` from `MEDIA_LOCAL_DIR`, only with `local`.
  - Headers: `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: cross-origin`, `Cache-Control: public, max-age=31536000, immutable`.
  - No index and no dotfiles; anything else falls through to the API's 404.

## Review Focus

1. A JPEG with EXIF GPS and orientation 6: the stored variants carry no EXIF and are rotated (Task 3).
2. A renamed text file, an SVG, a GIF, an animated WebP and a 7000×6000 PNG → 400, never 500, and **no file written** (Task 3).
3. The current xuan-web save shape (no `bodyVersion`) on a post whose stored body is version 2 → `409 POST_BODY_VERSION_UNSUPPORTED`, row unchanged (Task 4).
4. A body image `src` with the right host but another path (`/media/../x`), with `http://evil/...-640.webp`, or with a width the media doesn't have → 400 or 409 as specified (Task 4).
5. `/media/` traversal (`/media/..%2f..%2fpackage.json`) and a non-`.webp` path → 404 envelope (Task 3).

---

### Task 1: Schema (`content_media`, cover/OG columns, body version 2 CHECK) [delegate] · `xuan-database-change`

**Files:**
- Create: `src/modules/content/media/media.entity.ts` (`ContentMedia`)
- Modify: `post.entity.ts` (`coverMediaId`, `coverAlt`, `ogMediaId`, FKs, indexes, `ck_content_posts_cover_alt`, `ck_content_posts_body_version` IN (1, 2)), `content.module.ts`
- Create: the migration (generated against `xuan_test`; the `body_version` CHECK replacement hand-added, as B1)
- Modify: `docs/database.md` §12 (`content_media` map; posts columns)
- Test: `test/content-media-schema.e2e-spec.ts`, `test/content-posts-schema.e2e-spec.ts` (`body_version 2` now accepted, `3` rejected; the cover_alt CHECK)

**Names:**
- `pk_content_media`, `fk_content_media_uploader_id` (`RESTRICT`), `ix_content_media_uploader_id`, `uq_content_media_storage_key`;
- `ck_content_media_storage_key_format` (`^blog/[0-9a-f-]{36}$`), `ck_content_media_content_type` (`IN ('image/webp')`), `ck_content_media_dimensions` (1–6000 each), `ck_content_media_variant_widths_not_empty`, `ck_content_media_byte_size_positive`;
- `fk_content_posts_cover_media_id`, `fk_content_posts_og_media_id` (`RESTRICT`), `ix_content_posts_cover_media_id`, `ix_content_posts_og_media_id`, `ck_content_posts_cover_alt`.

Steps: map first, then failing schema tests, entities, generate (`NODE_ENV=test`), hand-add the CHECK replacement, read the SQL, round trip on `xuan_test`, an empty second generate, schema tests green. **Commit:** `feat(content): add post media and cover/OG references`.

### Task 2: Config and the storage gateway [delegate] · `xuan-api-feature`

**Files:**
- Modify: `src/config/env.schema.ts`, `load-config.ts`, `load-config.spec.ts`, `.env.example`, `.gitignore` (`storage/`)
- Create:
  - `src/modules/content/media/media-storage.ts` (`MediaStorage` interface, `MEDIA_STORAGE` token, `mediaStorageFactory(config)`);
  - `local-media-storage.ts`, `r2-media-storage.ts`, `disabled-media-storage.ts` + specs.
- Modify: `test/support/create-test-app.ts` (option `media?: Partial<AppConfig['media']>`)

**Interfaces:**
- Produces:
  - `interface MediaStorage { readonly enabled: boolean; put(key: string, body: Buffer, contentType: 'image/webp'): Promise<void> }`;
  - `mediaUrl(config, key, width): string`.

**Tests:**
- config: production without `MEDIA_STORAGE` → `ConfigError` naming it; production `local` → error; `r2` without `R2_*` → error naming them; the error never contains a value; development defaults.
- local: writes the bytes under `dir/<key>` and creates folders; a key outside `^blog/[0-9a-f-]{36}-\d{1,4}\.webp$` → throws, nothing written.
- r2: sends one `PutObjectCommand` with Bucket, Key, ContentType and CacheControl (mocked `send`).
- disabled: `enabled === false`, and `put` throws.

**Commit:** `feat(content): store media locally or on Cloudflare R2`.

### Task 3: Upload pipeline and local serving [delegate] · `xuan-api-feature`

**Files:**
- Create:
  - `src/http/upload/single-file-upload.interceptor.ts` (`SingleFileUpload(field, maxBytes)`: multer memory storage; `LIMIT_FILE_SIZE` → 413; unexpected or extra part → `400 UNKNOWN_FIELD` at its name; malformed multipart → `400` with `fields: []`; attaches `req.file`);
  - `src/modules/content/media/image-processing.ts` (`sniffImageType(buf)`, `toWebpVariants(buf): Promise<{ width, height, data }[]>`);
  - `media.service.ts`, `admin-media.controller.ts`, `dto/media.dto.ts`.
- Modify: `src/http/configure-app.ts` (`/media` static), `content.errors.ts` (`MEDIA_STORAGE_DISABLED`), `content.module.ts`
- Test: `image-processing.spec.ts` (fixtures generated with `sharp` at test time), `test/admin-media.e2e-spec.ts`, `test/media-static.e2e-spec.ts`

**Tests (e2e):**
- happy JPEG 2400×1600 → 201 exact `MediaImageDto` with 3 variants; the files exist on disk and decode as WebP with no EXIF;
- a 500-pixel-wide PNG → one variant of 500;
- Review Focus 1 and 2; 13 MiB → 413; no file → 400 `REQUIRED`; an extra field → 400 `UNKNOWN_FIELD`;
- editor ok, user 403, guest 401, no CSRF 403;
- `MEDIA_STORAGE=disabled` app → 409, nothing written;
- static: an uploaded variant is served with its three headers; Review Focus 5.

**Commit:** `feat(content): upload images as WebP variants`.

### Task 4: Body version 2 and the version contract [delegate] · `xuan-api-feature`

**Files:**
- Modify: `body/post-body.schema.ts` (version 2 superset carries the component ids; version 1 kept as `postBodyV1DocumentSchema`), `body/post-body-links.ts` (`isSafeLinkHrefV2`: version 1 rule + `/path` + `#id`), `body/post-body-content.ts` (`hasIncompleteMedia`, `collectMediaSources`, `fitsBodyVersion1`), `dto/save-post.dto.ts` (`bodyVersion`; a version 1 request re-checked against the version 1 schema in a `superRefine`, issues at `body.<path>`), `post-compatibility.ts` (body version rule), `posts.service.ts`, `content.errors.ts`
- Create: `media/media-references.ts` (parses a media URL against config; resolves keys in one query)
- Test: `body/post-body-v2.schema.spec.ts`, `post-body-content.spec.ts`, `test/admin-posts.e2e-spec.ts`

**Tests:**
- unit: each new node and mark accepted with exact attrs; unknown attrs rejected; `codeBlock` with marked text rejected; `code` + `link` rejected; links `/path`, `#id` ok, but `//host` and `#bad id` rejected; `videoEmbed` ids per provider; `fitsBodyVersion1` true for text-only.
- e2e:
  - version 2 save with an uploaded image → `bodyVersion: 2`;
  - a text-only save declaring 2 → stored 1;
  - a version 1 request with an image → 400 at `body.content.N`;
  - Review Focus 3 and 4;
  - incomplete before/after: draft ok, publish → 409, `PUT` on published → 409.

**Commit:** `feat(content): accept body version 2 with media from the library`.

### Task 5: Cover and OG images on posts [delegate] · `xuan-api-feature`

**Files:** `save-post.dto.ts`, `post-compatibility.ts`, `posts.service.ts` (media refs loaded per page in one query), `dto/post.dto.ts`, `dto/admin-post.dto.ts`, `dto/media.dto.ts` (`PostImageDto`, `AdminPostImageDto`), `admin-posts.controller.ts`, tests.

**Tests:**
- cover + alt → admin and public `coverImage` exact; `ogImage` falls back to the cover alt;
- cover without alt → 400 at `coverAlt`; alt without cover → 400;
- unknown media → `POST_MEDIA_NOT_FOUND`;
- the current web shape on a post with a cover → 409 `POST_FIELDS_OMITTED` `['coverMediaId']`;
- `null` clears.

**Commit:** `feat(content): give posts a cover and an OG image`.

### Task 6: OpenAPI pins and docs [delegate]

- **Pins:** the upload route (multipart request body with a `file` binary property, exact codes), the components, nullable image refs, and the new codes on post writes.
- **Docs:**
  - `api-contract.md` (routes, DTOs, codes, the version contract, delta row 18);
  - `architecture.md` (§3 layout; ADs for the media gateway and pipeline and for the first multipart route; §11 config; §15; §16 spikes S2–S4);
  - `code-rules.md` D21 note;
  - `development-workflow.md` §4 local media;
  - `data-model.md` (Content media);
  - `database.md` status.

**Commit:** `docs(content): document post media and body version 2`.

### Task 7: Verification, reviews, PR, merge

As B1's Task 6. Owner packet entry 3, plus the **R2 setup checklist** (spec §5.3) in the final report.
