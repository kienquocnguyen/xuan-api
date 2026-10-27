# Post discussion and moderation (blog outcome B4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (Native, owner-chosen for B1–B3 and kept) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-in readers rate published posts (1–5) and write, edit and delete their own plain-text comments; the public reads visible comments and rating summaries; admins hide, restore and (for comments) finally delete; writes are throttled per user.

**Architecture:**
- `modules/content/discussion/` owns `content_post_ratings` and `content_post_comments` (spec §2), a reader controller, an admin moderation controller, the services and the throttle guard. The posts service stays the only reader of post state (`findPublishedId`).
- Authors come from `UsersModule`'s exported `UserProfilesReader` (AD14); FKs to `users(id)` by entity name.
- `@nestjs/throttler` (in-memory store) behind a content-owned guard keyed by the session user, applied per route after the global CSRF and access guards.

**Tech Stack:** NestJS 12 · TypeORM 1.1 · PostgreSQL 18 · Zod 4 · `@nestjs/throttler` 6 · Vitest + supertest.

**Spec:** `docs/superpowers/specs/2026-10-19-blog-completion-design.md` §2, §6 (all), §7, §8 (discussion), §9 B4 row, §11 S5, §12, §16 Q2.

**Execution scope:** bounded row (workflow §3.5). `xuan_test` autonomous. `xuan_dev` **protected**: the migration only adds tables (FKs to existing tables included), but B1–B3 are still pending there ("any migration while an earlier one is still pending"), so it joins the owner packet as entry 4.

## Global Constraints

- **Tables (spec §6.1, verbatim names):**
  - `content_post_ratings`: `id` uuid `uuidv7()` `pk_content_post_ratings`; `post_id` → `content_posts(id)` RESTRICT `fk_content_post_ratings_post_id`; `user_id` → `users(id)` RESTRICT `fk_content_post_ratings_user_id`, `ix_content_post_ratings_user_id`; `value smallint` `ck_content_post_ratings_value` 1–5; `status varchar(16)` default `'visible'` `ck_content_post_ratings_status` IN (`visible`,`hidden`); `moderated_by` → `users(id)` RESTRICT `fk_content_post_ratings_moderated_by` (+ `ix_content_post_ratings_moderated_by`); `moderated_at timestamptz`; `ck_content_post_ratings_moderation_pair` (both null or both set); `created_at`, `updated_at` `now()`; `uq_content_post_ratings_post_id_user_id` (any status).
  - `content_post_comments`: same `id`/`post_id`/`user_id` shape with `content_post_comments` names; `body varchar(2000)` `ck_content_post_comments_body_not_blank` (`btrim(body) <> ''`); `status` IN (`visible`,`hidden`,`deleted`) `ck_content_post_comments_status`; `edited_at timestamptz` null; `moderated_by`/`moderated_at` + `ck_content_post_comments_moderation_pair`, `fk_content_post_comments_moderated_by`, `ix_content_post_comments_moderated_by`; `created_at`, `updated_at`; `ix_content_post_comments_post_id_status_created_at_id`.
- **Every reader route needs a published post**; missing, draft or archived → `404 NOT_FOUND`.
- **Comment body:** trimmed, `\r\n` → `\n`, 1–2 000 **code points** (`[...s].length`), storable text (`isStorableText`).
- **Throttle (BD-8):** 5 per 60 s and 60 per 3 600 s per **session user id**, **shared across all discussion writes** (rating PUT, comment POST/PUT/DELETE); over → `429 RATE_LIMITED` "Too many requests. Try again in a moment." with `Retry-After` (seconds). Moderation routes are not throttled. 401/403 (auth, CSRF, roles) answer before counting.
- **Codes (409, `content.errors.ts`):** `COMMENT_NOT_EDITABLE` "Only a visible comment can be edited.", `COMMENT_DELETED` "A deleted comment can't be changed.". `RATE_LIMITED` (kind `rate_limited`) joins `baselineErrors`.
- **DTOs:** `PostCommentDto { id, body, createdAt, editedAt: string | null, author: PostAuthorDto }` (no author id, no status, no email); `MyPostDiscussionDto { rating: number | null, ownCommentIds: string[] }` (≤ 500, newest first, visible only); `RatingSummaryDto { average: number | null, count: number }` on `PostSummaryDto` and `PostDto` as `ratingSummary` (visible only, 2 decimals, `null` at 0); `AdminPostCommentDto { id, post: { id, slug, title }, author: AdminPostAuthorDto, body, status, editedAt, moderatedAt, moderatedBy: AdminPostAuthorDto | null, createdAt, updatedAt }`; `AdminPostRatingDto` = same with `value` instead of `body`/`editedAt`.
- **Request components:** `SavePostRatingDto { value: int 1–5 }`, `SavePostCommentDto { body }`, `PostCommentsQuery` (`page`, `pageSize` 1–50 default **10**), `AdminPostCommentsQuery { status?, postId?: uuid, page, pageSize }`, `AdminPostRatingsQuery` (same, rating statuses), `PostCommentIdParam { commentId: uuid }`, `PostRatingIdParam { ratingId: uuid }`.
- **Transitions (Q2):** hide visible→hidden; restore hidden→visible; delete (comments) visible|hidden→deleted; `deleted` terminal: hide/restore → `409 COMMENT_DELETED`, delete → unchanged; same state → unchanged with **no write**; real transitions set `moderated_by`, `moderated_at`. Ratings: hide/restore only.

## Review Focus

1. A user whose rating an admin hid rates again: the value changes, the status stays `hidden`, and the summary still excludes it (Task 2).
2. Comment bodies at the edges: CRLF normalized; whitespace/newlines only → 400; 2 000 emoji (surrogate pairs) accepted, 2 001 → 400 (Task 3).
3. The throttle counts the same user across rating and comment routes, never counts a 401/403, and a second user is unaffected (Task 2, Task 3).
4. A post unpublished or archived after comments exist: every reader route, including editing and deleting an own comment, → 404 (Task 3).
5. Two concurrent first ratings by the same user → both 204, one row, never a 500 (Task 2).

---

### Task 1: Schema (`content_post_ratings`, `content_post_comments`) [delegate] · `xuan-database-change`

**Files:** `docs/database.md` §12 (map + status row first: Checkpoint M as a recorded self-review), `src/modules/content/discussion/post-rating.entity.ts` (`PostRating`), `post-comment.entity.ts` (`PostComment`), `content.module.ts` (`forFeature`), the generated migration, `test/content-discussion-schema.e2e-spec.ts`.

- [ ] Map and Checkpoint M ledger line (data safety: new tables only; protected for xuan_dev because B1–B3 pend).
- [ ] RED: schema e2e asserting by name every CHECK (value 0/6, status, moderation pair, body blank), the unique (second rating same user/post → `23505` on `uq_content_post_ratings_post_id_user_id`), every FK (unknown post/user/moderator → `23503` by name).
- [ ] Entities (statuses as `const` tuples `RATING_STATUSES`, `COMMENT_STATUSES`; FKs by entity name, AD14), then `NODE_ENV=test yarn migration:generate` against `xuan_test`; read the SQL; Prettier before any patch.
- [ ] Checkpoint A on `xuan_test`: guard, run, `\d+` = map, revert, re-run identical, empty second generate. GREEN.
- [ ] Commit `feat(content): add post ratings and comments tables`.

### Task 2: Ratings and the discussion throttle (spike S5) [delegate] · `xuan-api-feature`

**Files:** `package.json` (`@nestjs/throttler`), `src/errors/baseline-errors.ts` (`RATE_LIMITED`), `discussion/discussion-throttle.guard.ts`, `discussion/discussion.service.ts`, `discussion/discussion.controller.ts`, `dto/discussion.dto.ts`, `dto/save-discussion.dto.ts`, `posts.service.ts` (`findPublishedId`), `content.module.ts`, `test/post-ratings.e2e-spec.ts`.

**Interfaces:**
- Produces: `PostsService.findPublishedId(slug: string, manager?: EntityManager): Promise<string>` (404 otherwise); `DiscussionService.saveRating(actor, slug, value): Promise<void>`; `DiscussionThrottle` (a guard class used with `@UseGuards`); `DISCUSSION_LIMITS = [{ name: 'minute', ttl: 60_000, limit: 5 }, { name: 'hour', ttl: 3_600_000, limit: 60 }]`.

- [ ] RED e2e: `PUT /posts/:slug/rating` `{ value: 4 }` → 204, empty body, row `value 4 visible`; repeat with 5 → one row, value 5; hidden row (set directly) re-rated keeps `hidden` (Review Focus 1); value 0/6/2.5/"4" → 400; guest 401, no XHR 403; draft/archived/unknown slug → 404; two concurrent first PUTs → 204, 204, one row (Review Focus 5); 6th write within the minute by one user → 429 `RATE_LIMITED` exact envelope + numeric `Retry-After`; a second user still 204; a guest and a no-CSRF request don't consume the user's budget.
- [ ] Spike S5 while implementing: `ThrottlerModule.forRoot({ throttlers: DISCUSSION_LIMITS })` in `ContentModule`; the guard extends `ThrottlerGuard`, `getTracker` = session user id, `generateKey` ignores the route (one budget across writes), `throwThrottlingException` throws `AppError(RATE_LIMITED)` after `Retry-After` is set. Ledger the result in the form of architecture §16 rows.
- [ ] Rating upsert: one `INSERT … ON CONFLICT ON CONSTRAINT uq_content_post_ratings_post_id_user_id DO UPDATE SET value, updated_at` (`orUpdate(['value', 'updated_at'], 'uq_content_post_ratings_post_id_user_id')`, D32), `status` untouched.
- [ ] GREEN; commit `feat(content): let readers rate posts, throttled per user`.

### Task 3: Comments: create, edit, delete [delegate] · `xuan-api-feature`

**Files:** `discussion/discussion.service.ts`, `discussion/discussion.controller.ts` (+ `PostCommentsController` for `/post-comments/:commentId`), `dto/*`, `content.errors.ts`, `test/post-comments.e2e-spec.ts`, `dto/save-discussion.dto.spec.ts`.

**Interfaces:** Produces `createComment(actor, slug, body): Promise<PostCommentView>`, `editComment(actor, commentId, body)`, `deleteComment(actor, commentId): Promise<void>`; `toPostCommentDto(comment, author)`.

- [ ] RED unit (body schema, table-driven): `'  a\r\nb  '` → `'a\nb'`; `' \n\t '` → 400; 2 000 × `'😀'` ok; 2 001 → 400; NUL → 400 (Review Focus 2).
- [ ] RED e2e: POST → 201 exact `PostCommentDto` (author `{ displayName, avatarUrl }`, `editedAt: null`, no id/email); PUT by owner → 200 with `editedAt` set; PUT by another user → 403; PUT hidden/deleted → 409 `COMMENT_NOT_EDITABLE`; DELETE by owner → 204, then again → 204 with `updated_at` unchanged; owner may delete a hidden one; unknown comment → 404; post unpublished or archived after commenting → POST/PUT/DELETE 404 (Review Focus 4); guest 401; no XHR 403; throttle shared with ratings: 3 ratings + 3 comment writes → the 6th is 429 (Review Focus 3).
- [ ] Order of checks: comment missing → 404; its post not published → 404; not the owner → 403; status → 409.
- [ ] GREEN; commit `feat(content): let readers write, edit and delete their comments`.

### Task 4: Public reads and rating summaries [delegate] · `xuan-api-feature`

**Files:** `discussion/discussion.service.ts` (`listVisible`, `mine`, `summaries`), `discussion.controller.ts`, `posts.service.ts` (`withAuthors` adds summaries), `dto/post.dto.ts` (`ratingSummary`), `posts.controller.ts`, tests: `test/post-comments.e2e-spec.ts`, `test/posts.e2e-spec.ts` (exact bodies gain `ratingSummary`), `discussion/rating-summary.spec.ts`.

**Interfaces:** Produces `DiscussionService.summaries(postIds: readonly string[]): Promise<Map<string, RatingSummary>>` (one grouped query), `toRatingSummary(count: number, sum: number): RatingSummary` (pure).

- [ ] RED unit `toRatingSummary`: `(0, 0)` → `{ average: null, count: 0 }`; `(3, 13)` → `4.33`; `(2, 9)` → `4.5`; `(3, 14)` → `4.67`.
- [ ] RED e2e: `GET /posts/:slug/comments` visible only, oldest first, default pageSize 10, `pageSize=51` → 400, exact `pageInfo`; no email or user id anywhere in the JSON; `GET /posts/:slug/discussion/me` → `{ rating, ownCommentIds }` (hidden rating still returned, hidden/deleted comments omitted), guest 401; `GET /posts` and `GET /posts/:slug` carry `ratingSummary` excluding hidden ratings; draft/archived → 404.
- [ ] Summaries load per page in one query beside authors, categories and images.
- [ ] GREEN; commit `feat(content): show visible comments and rating summaries`.

### Task 5: Moderation [delegate] · `xuan-api-feature`

**Files:** `discussion/moderation.ts` (pure transitions), `discussion/moderation.service.ts`, `discussion/admin-discussion.controller.ts`, `dto/admin-discussion.dto.ts`, `discussion/moderation.spec.ts`, `test/admin-discussion.e2e-spec.ts`.

**Interfaces:** Produces `nextCommentStatus(current: CommentStatus, action: 'hide' | 'restore' | 'delete'): CommentStatus` (throws `AppError(COMMENT_DELETED)` for hide/restore of deleted) and `nextRatingStatus(current, 'hide' | 'restore')`.

- [ ] RED unit: the full table from Global Constraints (3 statuses × 3 actions; 2 × 2 for ratings).
- [ ] RED e2e: lists newest first with `status` and `postId` filters and exact DTOs (no emails; `moderatedBy` null until moderated); hide → hidden with `moderatedBy` the admin; same action again → unchanged, `updated_at` unchanged; delete hidden → deleted; hide/restore deleted → 409 `COMMENT_DELETED`; rating hide → excluded from the public summary, restore → included; user and editor → 403, guest 401; unknown id → 404; no throttle on moderation (7 actions in a row succeed).
- [ ] GREEN; commit `feat(content): let admins moderate comments and ratings`.

### Task 6: OpenAPI pins and docs [delegate]

- **Pins:** every new route's exact codes (`RATE_LIMITED` on the four reader writes only), every new component's exact properties, `ratingSummary` on post DTOs, the 204s with no content.
- **Docs:** `api-contract.md` (routes, DTOs, codes, `RATE_LIMITED` implemented, rendering duty: plain text escaped by the web, delta row 20); `architecture.md` (§3 `content/discussion/`, AD19 discussion throttle, §15 content row, §16 spike S5); `data-model.md` (Content rating, Content comment); `database.md` status.
- **Commit:** `docs(content): document post discussion and moderation`.

### Task 7: Verification, reviews, PR, merge

As B3's Task 7: full checks, `xuan-api-architecture-review`, a fresh opus review, fixes test-first, PR → `dev`, merge (branch kept), owner packet entry 4, delete this plan's ledger folder.
