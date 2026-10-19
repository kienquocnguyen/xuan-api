# Post lifecycle and tags (blog outcome B1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (Native, owner-chosen) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authors can archive, restore and delete never-published drafts, and tag posts. Old clients can never silently erase tags.

**Architecture:**
- Everything stays in `modules/content/`. `content_posts` gains `archived` in its status CHECK and a `tags varchar(40)[]` column.
- Transitions lock the post row inside one transaction (I8), as publish already does.
- The Q3 omitted-field guard is a pure function, `omittedFieldsWithData()`, that later outcomes extend.

**Tech Stack:** NestJS 12 · TypeORM 1.1 · PostgreSQL 18 · Zod 4 · Vitest + supertest on `xuan_test`.

**Spec:** `docs/superpowers/specs/2026-10-19-blog-completion-design.md`:
- §3: lifecycle, tags, `updatedAt`, Q3 guards, enum widening;
- §10: B1 row;
- §11: spike S1;
- §12: tests;
- §18: consistency review.

**Execution scope:** the bounded autonomous execution row in `development-workflow.md` §3.5 (PR #17):
- `xuan_test` operations are autonomous and guarded.
- **B1's `xuan_dev` migration is protected**: it replaces `ck_content_posts_status` and adds a column with a default. It goes into the consolidated owner packet. The PR merges on full `xuan_test` evidence.

## Global Constraints

- Statuses: `draft`, `published`, `archived`. Restore → `draft`. Delete only when `status = 'draft' AND published_at IS NULL`.
- **Errors:**
  - `POST_ARCHIVED` (409), message "An archived post must be restored first.";
  - `POST_WAS_PUBLISHED` (409), message "A post that was ever published can't be deleted; archive it instead.";
  - `POST_FIELDS_OMITTED` (409), message "Send every field: the request leaves out fields that hold data.", with `details: { fields: string[] }`.
- **Tags:**
  - 0–10 per post;
  - each tag trimmed, 1–40 characters, storable text, no `,`;
  - duplicates compared after NFC normalization plus `toLowerCase()` → `400` with code `INVALID` at `tags.<i>`;
  - order and case kept;
  - input `tags?: string[] | null`. On create, omitted or `null` → `[]`. On update, `null` or `[]` clears, and omitted → the guard.
- **Column and constraint names:** `tags varchar(40)[] NOT NULL DEFAULT '{}'`, `ck_content_posts_tags_count` (`cardinality("tags") <= 10`), `ck_content_posts_status` (`status IN ('draft','published','archived')`).
- **Public routes** see `published` only. An archived post is `404` (B13).
- Idempotent transitions write nothing, so `updatedAt` is unchanged.
- Every write needs the CSRF header. Editors act on their own posts, admins on any (B11, B12).
- **Additive contract:**
  - `PostSummaryDto` + `updatedAt`;
  - `PostDto` + `tags`;
  - `AdminPostSummaryDto` + `tags` (and so `AdminPostDto`); its `status` enum gains `archived`;
  - `SavePostDto` + `tags`;
  - `AdminPostsQuery.status` + `archived`.

## Review Focus

1. The real xuan-web PUT shape (`{ slug, title, excerpt, seoTitle, seoDescription, body }`) on a post **with** tags → 409 `POST_FIELDS_OMITTED`, `fields: ['tags']`, and the row is unchanged. On a post **without** tags → 200, exactly as before (Task 4).
2. Vietnamese and Unicode duplicates: `'Đà Lạt'` and `'đà lạt'` are duplicates; NFC `'é'` and NFD `'é'` are duplicates (Task 2).
3. An ever-published post that's archived never appears in `GET /posts` and gives `404` on `GET /posts/:slug` (Task 3).
4. Delete ∥ publish on the same draft, over 15 trials: the end state is always consistent. Either `204` + publish `404`, or publish `200` + delete `409 POST_WAS_PUBLISHED`. Never a 500 (Task 3).
5. A `PUT` with `tags: null` and one with `tags: []` both clear the stored tags (Task 4).

---

### Task 1: Schema: archived status and tags column [delegate] · `xuan-database-change`

**Files:**
- Modify: `src/modules/content/post.entity.ts` (`POST_STATUSES`, status CHECK, `tags` column, tags CHECK)
- Create: `src/database/migrations/<ts>-AddPostLifecycleAndTags.ts` (generated)
- Modify: `docs/database.md` §12 (`content_posts` map: mermaid, column table, constraint table; the status row in "current schema")
- Test: `test/content-posts-schema.e2e-spec.ts`

**Interfaces:**
- Produces: `POST_STATUSES = ['draft','published','archived'] as const`; `Post.tags: string[]`.

- [ ] **Step 1: The map first (Checkpoint M, recorded self-review).**
  - Update the `database.md` §12 `content_posts` map with the status CHECK, the `tags` row ("0–10 short labels; no tag index, since V1 has no tag filter") and `ck_content_posts_tags_count`. Status: *decided*.
  - Record the data-safety review in the ledger: existing rows all satisfy the wider CHECK; the column default is constant, so no rewrite; `down()` fails while archived rows exist, which is documented as a roll-forward (C9).
- [ ] **Step 2: Write the failing schema tests** in `content-posts-schema.e2e-spec.ts`:
  - `'accepts archived and rejects other statuses'`: an insert with `status: 'archived'` succeeds; `status: 'deleted'` → `ck_content_posts_status`;
  - `'defaults tags to an empty array'`: after an insert, `tags` deep-equals `[]`;
  - `'allows at most 10 tags'`: 10 succeeds; 11 → `ck_content_posts_tags_count`;
  - `'limits each tag to 40 characters'` (spike S1): a 41-character element. Expected: an error with SQLSTATE `22001`. If S1 shows PostgreSQL doesn't enforce element length, replace this test with one asserting the application limit (Task 2), and record the D31 deviation in the map.
- [ ] **Step 3: Entity.** Add `'archived'` to `POST_STATUSES` and the CHECK. Add `@Column({ type: 'varchar', length: 40, array: true, default: () => "'{}'" }) tags!: string[]` and `@Check('ck_content_posts_tags_count', 'cardinality("tags") <= 10')`.
- [ ] **Step 4: Generate and read.** Run `yarn migration:generate src/database/migrations/AddPostLifecycleAndTags`. Expected SQL: drop and add `ck_content_posts_status`; `ADD "tags" character varying(40) array NOT NULL DEFAULT '{}'`; add `ck_content_posts_tags_count`; and a `down()` that reverses them. Save the sha256 and the statement list in the ledger.
- [ ] **Step 5: `xuan_test`.**
  - Run `NODE_ENV=test` target identity → `xuan_test`, then `yarn test:db-guard` → OK, then `NODE_ENV=test yarn migration:run`.
  - Check `\d+ content_posts` against the map.
  - Revert (after confirming it's the latest), then re-run. `\d+` must be identical.
  - The second generate must report "No changes".
- [ ] **Step 6: Run the schema tests.** Run `yarn test:e2e test/content-posts-schema.e2e-spec.ts`. Expected: PASS.
- [ ] **Step 7: Commit:** `feat(content): add the archived status and post tags to content_posts`.

### Task 2: Tags input and the omitted-field guard [delegate] · `xuan-api-feature`

**Files:**
- Modify: `src/modules/content/dto/save-post.dto.ts`
- Create: `src/modules/content/post-compatibility.ts`
- Test: `src/modules/content/dto/save-post.dto.spec.ts`, `src/modules/content/post-compatibility.spec.ts`

**Interfaces:**
- Produces:
  - `savePostSchema` gains `tags: z.array(tag).max(10).nullable().optional()`, so `SavePostInput.tags: string[] | null | undefined`;
  - `omittedFieldsWithData(input: Readonly<Record<string, unknown>>, post: Post): string[]`, which returns, in a fixed order, every guarded field whose key is absent from `input` while the stored value isn't empty. B1 guards `tags` (`post.tags.length > 0`). B2 and B3 add rows to its table.

- [ ] **Step 1: Write the failing unit tests:**
  - `save-post.dto.spec.ts`:
    - `'trims tags and keeps their order and case'`;
    - `'rejects an 11th tag'` (`TOO_BIG` at `tags`);
    - `'rejects a blank, a 41-character, a comma or a NUL tag'` (`tags.<i>`);
    - `'rejects case-insensitive and Unicode-equivalent duplicates'`: `['Đà Lạt','đà lạt']` → `INVALID` at `tags.1`; NFC/NFD `é` too;
    - `'accepts null and omitted tags'`.
  - `post-compatibility.spec.ts`:
    - `'reports tags omitted while stored'` → `['tags']`;
    - `'ignores tags omitted while stored empty'` → `[]`;
    - `'ignores tags sent as null or []'` → `[]`.
- [ ] **Step 2: Run them.** Run `yarn test src/modules/content`. Expected: FAIL (the export is missing and `tags` is unknown).
- [ ] **Step 3: Implement.**
  - The tag schema: `z.string().trim().min(1).max(40).refine(isStorableText).refine(no comma)`.
  - Duplicates: a `superRefine` on the array, adding an issue at `[i]` for the second occurrence of a key `normalize('NFC').toLowerCase()`.
  - `omittedFieldsWithData`: a `const GUARDED = [{ field: 'tags', hasData: (p) => p.tags.length > 0 }]` table.
- [ ] **Step 4: Run them again.** Same command. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(content): validate post tags and detect omitted fields that hold data`.

### Task 3: Lifecycle transitions and routes [delegate] · `xuan-api-feature`

**Files:**
- Modify: `src/modules/content/content.errors.ts` (`POST_ARCHIVED`, `POST_WAS_PUBLISHED`, `POST_FIELDS_OMITTED`)
- Modify: `src/modules/content/posts.service.ts` (`archive`, `restore`, `remove`; `publish`/`unpublish` guards; `unpublish` moves to `lockManageable`)
- Modify: `src/modules/content/admin-posts.controller.ts`
- Test: `test/admin-posts.e2e-spec.ts`, `test/posts.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `PostsService.archive(actor, id): Promise<AuthoredPost>`;
  - `restore(actor, id): Promise<AuthoredPost>`;
  - `remove(actor, id): Promise<void>`;
  - routes `POST /admin/posts/:id/archive` (200), `POST /admin/posts/:id/restore` (200), `DELETE /admin/posts/:id` (`@HttpCode(204)`, `void`, I12).

- [ ] **Step 1: Write the failing e2e tests** (new `describe('lifecycle')` in `admin-posts.e2e-spec.ts`, with exact envelopes):
  - **archive:**
    - a draft → `status: 'archived'`;
    - a published post → `archived` with `publishedAt` kept;
    - already archived → 200 with `updatedAt` unchanged;
  - **restore:**
    - an archived post → `draft` with `publishedAt` kept (the slug stays locked: a `PUT` with a new slug → `POST_SLUG_LOCKED`);
    - restore of a draft or a published post → 200 unchanged;
  - **publish or unpublish of an archived post** → `409 POST_ARCHIVED`;
  - **delete:**
    - a never-published draft → 204, after which `GET` → 404;
    - a published post, an unpublished-once draft or an archived ever-published post → `409 POST_WAS_PUBLISHED`;
    - an archived never-published post → `409 POST_ARCHIVED`;
    - an unknown id → 404; a malformed id → 400 `INVALID_FORMAT`;
  - **ownership:** another editor gets 403 on archive, restore and delete; admin succeeds; user gets 403; guest gets 401; no CSRF header → 403;
  - **list:** `?status=archived` returns only archived posts; no filter returns every status;
  - **race (Review Focus 4):** 15 trials of `DELETE` ∥ `POST …/publish` on a fresh draft. Assert the pair is either (204, 404) or (409 `POST_WAS_PUBLISHED`, 200), and the final row state matches.
  - In `posts.e2e-spec.ts`, `'hides archived posts, including ever-published ones'`: the archived post is missing from `GET /posts` and `GET /posts/:slug` → 404.
- [ ] **Step 2: Run them.** Run `yarn test:e2e test/admin-posts.e2e-spec.ts test/posts.e2e-spec.ts`. Expected: FAIL (the routes 404 and the codes are missing).
- [ ] **Step 3: Implement.**
  - Each transition runs `dataSource.transaction` + `lockManageable`, then decides from the locked row (spec §3.1 table).
  - `remove`: check `publishedAt !== null` → `POST_WAS_PUBLISHED`, then `status === 'archived'` → `POST_ARCHIVED`, then `manager.delete(Post, { id })`.
  - `publish` and `unpublish` check `archived` first.
  - Controller decorators list exactly:
    - archive: `VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND`;
    - restore: the same;
    - delete: the same + `POST_WAS_PUBLISHED, POST_ARCHIVED`;
    - publish and unpublish: + `POST_ARCHIVED`.
- [ ] **Step 4: Run them again.** Same command. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(content): archive, restore and delete never-published drafts`.

### Task 4: Tags on writes and reads, plus the old-client guard [delegate] · `xuan-api-feature`

**Files:**
- Modify: `src/modules/content/posts.service.ts` (`create`/`update` tags; guard before any check that could write)
- Modify: `src/modules/content/dto/post.dto.ts` (`PostSummaryDto.updatedAt` moved up from `PostDto`; `PostDto.tags`)
- Modify: `src/modules/content/dto/admin-post.dto.ts` (`AdminPostSummaryDto.tags`)
- Modify: `src/modules/content/admin-posts.controller.ts` (`PUT` documents `POST_FIELDS_OMITTED`)
- Test: `test/admin-posts.e2e-spec.ts`, `test/posts.e2e-spec.ts`

**Interfaces:**
- Consumes: `omittedFieldsWithData` (Task 2) and `contentErrors.POST_FIELDS_OMITTED` (Task 3).

- [ ] **Step 1: Write the failing e2e tests:**
  - create with tags → `AdminPostDto.tags` in order; create without them → `[]`;
  - `PUT` with new tags replaces them; `tags: null` clears; `tags: []` clears (Review Focus 5);
  - **`'refuses the current xuan-web save shape on a tagged post'`:** a body of exactly `{ slug, title, excerpt: '', seoTitle: '', seoDescription: '', body }` → `409 POST_FIELDS_OMITTED`, `details: { fields: ['tags'] }`. The DB row is unchanged (title and `updated_at` compared);
  - **`'keeps the current xuan-web save shape working on an untagged post'`:** the same shape → 200;
  - public `PostSummaryDto` exact keys now include `updatedAt` (equal to `PostDto.updatedAt`); `PostDto` includes `tags`; `AdminPostSummaryDto` includes `tags`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - create: `tags: input.tags ?? []`.
  - update: inside the locked transaction, **first** `omittedFieldsWithData(input, post)` on the parsed body. Zod 4 leaves an absent optional key absent, so `'tags' in input` tells omitted from `null`. The unit test in Task 2 pins that with a parsed object. A non-empty result throws `new AppError(contentErrors.POST_FIELDS_OMITTED, { fields })`. Then the existing B17/B18 checks, then `tags: input.tags ?? []`.
  - Add the fields to the mappers (whitelists, I10).
- [ ] **Step 4: Run them again.** Run `yarn test:e2e test/admin-posts.e2e-spec.ts test/posts.e2e-spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(content): read and write post tags without silent loss`.

### Task 5: OpenAPI pins and living docs [delegate] · `xuan-api-feature`

**Files:**
- Test: `test/openapi.e2e-spec.ts`
- Modify:
  - `docs/api-contract.md` (blog routes, DTO fields, codes, the Q3 rule, delta row);
  - `docs/data-model.md` §3/§5 (lifecycle and tags; OD-6 archive part and OD-7 resolved);
  - `docs/architecture.md` §15 (the content row: archive, deletion and tags done);
  - `docs/database.md` §12 status (implemented on `xuan_test`, `xuan_dev` pending in the owner packet).

- [ ] **Step 1: Write the failing OpenAPI pins:**
  - the paths `/admin/posts/{id}/archive` (post), `/admin/posts/{id}/restore` (post), `/admin/posts/{id}` (delete, 204 with no body);
  - the exact code sets from Task 3 Step 3 and the `PUT` + `POST_FIELDS_OMITTED`;
  - `AdminPostSummaryDto.status.enum` = `['draft','published','archived']`;
  - `AdminPostsQuery` status enum likewise;
  - the property sets of `PostSummaryDto`, `PostDto`, `AdminPostSummaryDto` and `SavePostDto` (+ `tags`, which is nullable).
- [ ] **Step 2: Run them.** Run `yarn test:e2e test/openapi.e2e-spec.ts`. Expected: FAIL only where a pin catches a real gap. Fix the decorators, not the pins.
- [ ] **Step 3: Docs.** Make the four doc changes listed above. The api-contract delta row warns about the `status` enum widening at compile time and the Q3 rollout order (spec §3.4).
- [ ] **Step 4: Run them again.** Same command. Expected: PASS.
- [ ] **Step 5: Commit:** `docs(content): document the post lifecycle, tags and the omitted-field guard`.

### Task 6: Verification, reviews, PR, merge [delegate] · `xuan-api-architecture-review`, `xuan-git-branch-cohesion`

- [ ] **Step 1: Run the full checks.**
  - `yarn lint` → 0 errors;
  - `yarn typecheck`;
  - `yarn test`;
  - `yarn test:e2e` (guarded) → all pass;
  - `yarn build`;
  - `yarn format:check` → only the inherited `test/http-contract.e2e-spec.ts`.
- [ ] **Step 2: Reviews.** Run `xuan-api-architecture-review` on `dev...HEAD`, then a fresh independent review (opus) of the whole branch. Fix every Critical or Important finding test-first.
- [ ] **Step 3: Open the PR → `dev`** with Summary, Changes, Verification, Database and API Contract sections (workflow §9.3). The Database section says `xuan_dev` is **pending in the consolidated owner packet** (protected: a CHECK replacement and a column default).
- [ ] **Step 4: Merge** with a merge commit once the Git row's conditions hold. Keep the branch. Add B1's entry to the owner packet in the master ledger (migration name, sha256, SQL, `xuan_test` evidence).
