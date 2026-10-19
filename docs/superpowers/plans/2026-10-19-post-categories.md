# Post categories and public queries (blog outcome B2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (Native, owner-chosen) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Admins manage dynamic, Vietnamese-first categories.
- Each post has at most one, and publishing needs one.
- The public reads active categories with counts, filters posts by category and gets related articles.

**Architecture:**
- **Tables:** `content_categories` (stable key and status) + `content_category_translations` (per-language slug and label, `vi` only) and a nullable `content_posts.category_id` (FK `RESTRICT`), all owned by `modules/content/`.
- **Services:**
  - `CategoriesService` owns category CRUD and the reads posts need.
  - `PostsService` resolves every page's category refs in one query (no N+1) and applies the assignment and publish rules under the existing row lock.

**Tech Stack:** NestJS 12 · TypeORM 1.1 · PostgreSQL 18 · Zod 4 · Vitest + supertest on `xuan_test`.

**Spec:** `docs/superpowers/specs/2026-10-19-blog-completion-design.md`:
- §4 (the whole section);
- §3.4 (omitted-field guard);
- §10: B2 row;
- §12;
- §18.

**Execution scope:** the bounded autonomous execution row (`development-workflow.md` §3.5):
- `xuan_test` is autonomous.
- `xuan_dev` is **protected**: B1 is still pending, and B2 adds an FK to an existing table. It joins the consolidated owner packet.

## Global Constraints

- **Names (D25):**
  - `pk_content_categories`, `uq_content_categories_key`, `ck_content_categories_key_format`, `ck_content_categories_status` (`IN ('active','archived')`);
  - `pk_content_category_translations`, `fk_content_category_translations_category_id` (`ON DELETE CASCADE`), `ck_content_category_translations_language` (`IN ('vi')`), `ck_content_category_translations_slug_format`, `ck_content_category_translations_label_not_blank`, `uq_content_category_translations_language_slug`, `uq_content_category_translations_category_id_language`;
  - on posts: `fk_content_posts_category_id` (`ON DELETE RESTRICT`) and `ix_content_posts_category_id_status_published_at_id`.
- **Lengths:** `key` `varchar(60)`, `slug` `varchar(80)` (both kebab `^[a-z0-9]+(-[a-z0-9]+)*$`), `label` `varchar(60)` (trimmed, 1–60, storable).
- **Codes (409, `content.errors.ts`), with exact messages:**

  | Code | Message |
  |---|---|
  | `CATEGORY_KEY_TAKEN` | "Another category already uses this key." |
  | `CATEGORY_SLUG_TAKEN` | "Another category already uses this slug." |
  | `CATEGORY_IN_USE` | "Posts still use this category; archive it instead." |
  | `CATEGORY_NOT_FOUND` | "The chosen category doesn't exist." |
  | `CATEGORY_ARCHIVED` | "The chosen category is archived." |
  | `POST_CATEGORY_REQUIRED` | "A published post needs a category." |
- **Admin category routes** are `@Roles('admin')` (editors → 403) and need CSRF on writes.
- **Public routes** need `@Public()`.
- **Public `category`:** `{ slug, label } | null`, which is **`null` when archived**.
- **Admin `category`:** `{ id, key, slug, label, status } | null`.
- **Lists:** ordered by label with `Intl.Collator('vi')`, ties by key. `GET /posts?category=<slug>`: unknown or archived → `404 NOT_FOUND`.
- **Related posts:** ≤ 3, never the post itself, published only. Same category first (newest `publishedAt` first), then the newest others. A post without a category gets the newest others.
- **`SavePostDto.categoryId?: uuid | null`:**
  - an omission is guarded (§3.4);
  - unknown → `CATEGORY_NOT_FOUND`;
  - archived and different from the current one → `CATEGORY_ARCHIVED`.
- **Publish:** no category → `POST_CATEGORY_REQUIRED`; its category archived → `CATEGORY_ARCHIVED`.
- **`PUT` on a published post** that has a category, clearing it → `POST_CATEGORY_REQUIRED`. A legacy published post without a category may stay without one.

## Review Focus

1. Delete category ∥ assign it to a post (15 trials). The end state is always consistent: either the delete wins (`204`, then the post update → `409 CATEGORY_NOT_FOUND`), or the assignment wins (delete → `409 CATEGORY_IN_USE`). Never a 500 (Task 2).
2. A legacy published post with no category stays readable, is listed under no filter, and accepts a `PUT` with the current xuan-web shape (Task 3).
3. `GET /posts?category=` combined with `page` and `pageSize` counts only that category's published posts in `totalItems` (Task 4).
4. Related posts for a post whose category has more than 3 other posts never pads with other categories, and a post with no category gets the newest others (Task 4).
5. A label with a NUL or lone surrogate gives 400, never 500. A slug in another case gives 400 (Task 2).

---

### Task 1: Schema (two tables, `category_id`) [delegate] · `xuan-database-change`

**Files:**
- Create: `src/modules/content/category.entity.ts` (`ContentCategory`, `ContentCategoryTranslation`, `CATEGORY_STATUSES`, `CATEGORY_LANGUAGE = 'vi'`)
- Modify: `src/modules/content/post.entity.ts` (`categoryId: string | null`, its FK, the index), `src/modules/content/content.module.ts` (`forFeature`)
- Create: `src/database/migrations/<ts>-CreatePostCategories.ts` (generated)
- Modify: `docs/database.md` §12 (two new maps; `content_posts.category_id`; current-schema rows)
- Test: `test/content-categories-schema.e2e-spec.ts`

- [ ] **Step 1:** Write the map first (Checkpoint M, a recorded self-review; data safety: no existing row changes).
- [ ] **Step 2:** Write the failing schema tests:
  - each CHECK by name (key or slug in upper case, double dash; language `en`; blank label; status `deleted`);
  - both uniques; the cascade from category to translation;
  - `fk_content_posts_category_id` on an unknown id, and `RESTRICT` when deleting a used category (expect `fk_content_posts_category_id`);
  - defaults: uuid v7, `active`, `vi`.
- [ ] **Step 3:** Entities. Generate, read the SQL, run on `xuan_test` (guarded), inspect `\d+`, revert, re-run, check that the second generate is empty. Run the schema tests → PASS. **Commit:** `feat(content): add post categories with Vietnamese translations`.

### Task 2: Admin category CRUD [delegate] · `xuan-api-feature`

**Files:**
- Create:
  - `src/modules/content/categories.service.ts`;
  - `src/modules/content/admin-post-categories.controller.ts`;
  - `src/modules/content/dto/category.dto.ts`: `AdminPostCategoryDto { id, key, slug, label, status, postCount, createdAt, updatedAt }`, `PostCategoryDto { slug, label, publishedPostCount }`, `PostCategoryRefDto { slug, label }`, `AdminPostCategoryRefDto { id, key, slug, label, status }`, and the request schemas `CreatePostCategoryDto { key, slug, label }`, `UpdatePostCategoryDto { slug, label }`, `PostCategoryIdParam { categoryId }`.
- Modify: `content.errors.ts`, `content.module.ts`
- Test: `test/admin-post-categories.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `CategoriesService.listAdmin(): Promise<AdminCategory[]>`;
  - `create(input)`, `update(id, input)`, `archive(id)`, `restore(id)`, `remove(id): Promise<void>`;
  - `findRefs(manager | null, ids: string[]): Promise<Map<string, CategoryRef>>`, where `CategoryRef = { id, key, slug, label, status }`;
  - `findActiveBySlug(slug): Promise<CategoryRef | null>`;
  - `listPublic(): Promise<{ slug, label, publishedPostCount }[]>`.

- [ ] **Step 1:** Write the failing e2e tests:
  - create → 201 exact body, `postCount: 0`;
  - list ordered by Vietnamese label (`'Ảnh'` < `'Bếp'` < `'Đà Lạt'`);
  - duplicate key → `CATEGORY_KEY_TAKEN`; duplicate slug → `CATEGORY_SLUG_TAKEN`;
  - update changes slug and label (and a `key` in the body → 400 `UNKNOWN_FIELD`);
  - archive and restore are idempotent with no write;
  - delete unused → 204; used → `CATEGORY_IN_USE`; unknown → 404;
  - editor → 403, guest → 401, no CSRF → 403;
  - validation: label NUL → 400, slug upper case → 400 `INVALID_FORMAT`;
  - Review Focus 1: the race, which needs Task 3's `categoryId` input. Write that race in Task 3.
- [ ] **Step 2:** Run → FAIL (404 routes).
- [ ] **Step 3:** Implement:
  - create: category + translation in one `dataSource.transaction`;
  - unique violations translated by constraint name;
  - delete: count posts first → `CATEGORY_IN_USE`, then delete, with FK 23503/23001 on `fk_content_posts_category_id` → `CATEGORY_IN_USE`;
  - sort in the service with `Intl.Collator('vi')`.
- [ ] **Step 4:** Run → PASS. **Commit:** `feat(content): manage post categories`.

### Task 3: Category on posts: input, rules, DTOs [delegate] · `xuan-api-feature`

**Files:**
- Modify: `save-post.dto.ts` (`categoryId: z.uuid().nullable().optional()`), `post-compatibility.ts` (guard row `categoryId`: `post.categoryId !== null`), `posts.service.ts`, `dto/post.dto.ts`, `dto/admin-post.dto.ts`, `admin-posts.controller.ts`
- Test: `test/admin-posts.e2e-spec.ts`, `test/posts.e2e-spec.ts`, `src/modules/content/post-compatibility.spec.ts`

**Interfaces:**
- Consumes: `CategoriesService.findRefs` (Task 2).
- Produces: `AuthoredPost = { post, author, category: CategoryRef | null }`. Mappers: `toPostSummaryDto(post, author, category)` (public ref, `null` when archived) and `toAdminPostSummaryDto(post, author, category)`.

- [ ] **Step 1:** Write the failing tests:
  - unit: the guard reports `categoryId` when omitted while set;
  - e2e:
    - create and update with a category → admin `category` exact;
    - unknown → `CATEGORY_NOT_FOUND`;
    - moving into an archived category → `CATEGORY_ARCHIVED`, while keeping it when already assigned → 200;
    - publish without a category → `POST_CATEGORY_REQUIRED`; publish in an archived category → `CATEGORY_ARCHIVED`;
    - clearing it on a published post → `POST_CATEGORY_REQUIRED`;
    - a legacy published post without one (made through SQL `UPDATE`) accepts the current xuan-web `PUT` shape (Review Focus 2);
    - the current xuan-web shape on a post with a category → 409 `POST_FIELDS_OMITTED` `['categoryId']`;
    - public `category` is `{ slug, label }`, and `null` after the category is archived;
    - the Review Focus 1 race.
  - Update the existing publish tests to give their posts a category first: the owner's rule makes publishing require one.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement:
  - the guard, then the category checks inside the locked update transaction;
  - the publish checks;
  - insert or update `categoryId`;
  - translate `fk_content_posts_category_id` 23503 → `CATEGORY_NOT_FOUND`;
  - `withAuthors` → `withRelations` loads profiles and category refs with one query each per page.
- [ ] **Step 4:** Run → PASS. **Commit:** `feat(content): put each post in one category`.

### Task 4: Public category list, filter, related posts [delegate] · `xuan-api-feature`

**Files:**
- Create: `src/modules/content/post-categories.controller.ts` (`GET /post-categories`)
- Modify: `dto/post-queries.dto.ts` (`PostsPageQuery.category?`), `posts.controller.ts` (`GET /posts/:slug/related`), `posts.service.ts`
- Test: `test/posts.e2e-spec.ts`, `test/post-categories.e2e-spec.ts`

- [ ] **Step 1:** Write the failing e2e tests:
  - `GET /post-categories` returns only active categories, ordered, with published-only counts (drafts and archived posts not counted), including zero;
  - `?category=` filters, with exact `pageInfo` (Review Focus 3); unknown slug → 404; archived slug → 404; a malformed slug → 400;
  - related posts (Review Focus 4): self excluded, same-category first, padded; drafts excluded; unpublished slug → 404.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement:
  - one `GROUP BY` for the counts;
  - the filter resolves the active slug, then `where categoryId`;
  - related: query 1 (same category, `LIMIT 3`) + query 2 (others not in the set, `LIMIT 3 - n`).
- [ ] **Step 4:** Run → PASS. **Commit:** `feat(content): filter posts by category and suggest related posts`.

### Task 5: OpenAPI pins and docs [delegate] · `xuan-api-feature`

- [ ] **Step 1:** Write the exact-code pins for every new or changed route, the component names (I19) and the DTO property sets. Expected: FAIL only on a real gap.
- [ ] **Step 2:** Docs:
  - `api-contract.md` (routes, DTOs, codes, delta row 17);
  - `data-model.md` (the category concept);
  - `architecture.md` §3 layout;
  - `database.md` §12 status.
- [ ] **Step 3:** Run → PASS. **Commit:** `docs(content): document post categories`.

### Task 6: Verification, reviews, PR, merge [delegate] · `xuan-api-architecture-review`, `xuan-git-branch-cohesion`

The same steps as B1's plan, Task 6. `xuan_dev` goes into the consolidated owner packet as entry 2.
