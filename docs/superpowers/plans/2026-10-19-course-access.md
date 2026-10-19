# Course Access Grants and Gated Playback (course platform outcome 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (Native, owner-selected 2026-10-19) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** on branch `feat/grant-course-access`:
- an admin grants and revokes lifetime access to a course for an existing user, with full grant history;
- a signed-in learner with an active grant lists their courses, reads the learner curriculum and retrieves a published lesson's Vimeo reference;
- nobody else can retrieve a reference.

**Architecture:**
- The `courses` module (spec §3) gains `course_access_grants`, one row per grant (OD-1), and two services:
  - `CourseAccessService` handles grant, revoke, list and "has active access?";
  - `LearningService` handles the learner use cases.
- Grants are single statements, not course-locked (spec §5.3):
  - a grant is an `INSERT … ON CONFLICT (user_id, course_id) WHERE <predicate> DO UPDATE … RETURNING *` on a partial unique index;
  - a revoke is one `UPDATE`.
- Learner requests check access with one plain indexed read per request, never cached (§7, §7.1). Every 404 check runs before the 403 check.
- `UsersModule` is imported for `UserProfilesReader` (AD14). The three FKs to `users` are declared by entity name, with no relation.

**Tech Stack:** NestJS 12 ESM, TypeORM 1.1.2, PostgreSQL 18, Zod 4, Vitest + supertest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-17-course-platform-design.md` (approved 2026-10-18, revision 2). Binding for this outcome: §3, §5.2–5.3, §6, §7, §7.1, §8.2, §8.4, §11.2 (outcome-2 rows), §11.4, §11.5 (`COURSE_ACCESS_REQUIRED`), §11.6 (outcome-2 column), §12, §13, §14, §16 row 2, §17 S8, §18 outcome 2, §21.

**Mode:** delegated (`development-workflow.md` §3.5, course platform row). Every task is `[delegate]`. Database operations stay owner-only, each time:
- **Checkpoint A** after Task 1;
- the e2e runs from Task 1 on;
- **Checkpoint D** in Task 7.

**Checkpoint M (map approval, `xuan-database-change` step 3):** the map in Task 1 Step 1 is part of this plan. **Approving this plan approves that map.** Any later change to the map goes back to the owner before Task 1 Step 2.

## Spike S8 result (front-loaded, 2026-10-19, before this plan)

S8 was run from scratch files in the git-ignored ledger folder. It used `migration:generate --dryrun` and `getQueryAndParameters()` over a read-only connection to `xuan_dev`; nothing was written or applied.

1. **The partial unique index generates.** `@Index('uq_…_active_admin', ['userId','courseId'], { unique: true, where })` emits `CREATE UNIQUE INDEX "uq_course_access_grants_user_id_course_id_active_admin" ON "course_access_grants" ("user_id", "course_id") WHERE "source" = 'admin' AND "revoked_at" IS NULL`, and `down()` drops it.
2. **It will round-trip.** `RdbmsSchemaBuilder.shouldDropIndices` (TypeORM 1.1.2) compares uniqueness, type, spatial, fulltext and columns, never `where`. So a second generate stays empty.
   - **Caveat (as S7's):** a later change to the predicate is invisible to generate and needs a hand-written migration.
   - The empirical empty generate is part of Checkpoint A.
3. **The upsert emits the spec's shape.** `orUpdate(['updated_at'], ['user_id','course_id'], { indexPredicate })` + `.returning('*')` emits `ON CONFLICT ( "user_id", "course_id" ) WHERE ( "source" = 'admin' AND "revoked_at" IS NULL ) DO UPDATE SET "updated_at" = EXCLUDED."updated_at" RETURNING *`.
   - **One observed difference from spec §5.3:** TypeORM can't emit `SET updated_at = course_access_grants.updated_at`. Every `orUpdate` sets either `EXCLUDED.<col>` or `DEFAULT` for an `@UpdateDateColumn`.
   - So a repeated grant moves that grant row's `updated_at` to the statement's `now()`. `granted_at`, `id` and every other column stay. `updated_at` isn't on the wire (`CourseAccessGrantDto` has no such field), so nothing observable changes.
   - The fallback (insert / re-read / retry once) is **not needed**.

## Global Constraints

- Only `courses` registers `CourseAccessGrant` (I1).
  - `CoursesModule` imports `UsersModule` and uses only its export `UserProfilesReader`.
  - No `User` import and no relation (AD14, I2). FKs: `@ForeignKey('User', { name, onDelete: 'RESTRICT' })`, and `@ForeignKey(() => Course, …)` inside the module.
- Controllers never touch repositories or `DataSource` (I3). They map with `toXDto` functions next to each DTO (D5). Entities never reach the wire (I10).
- **New module error** (`courses.errors.ts`, D10): `COURSE_ACCESS_REQUIRED`, kind `forbidden` (403), message "You need access to this course.".
  - An unknown course or user is the baseline `NOT_FOUND`.
  - `LESSON_HAS_PROGRESS` is **not** part of this outcome.
- **Contract identifiers** (I19, spec §11.4, §11.6):
  - **Response DTOs:** `CourseAccessGrantDto`, `CourseAccessUserDto`, `LearnerCourseSummaryDto`, `LearnerCourseDto`, `LearnerCourseSectionDto`, `LearnerCourseLessonDto`, `LessonPlaybackDto`, `VimeoVideoDto`.
  - **Request components:** `LessonPathParams` `{ slug, lessonId }` and `CourseAccessParams` `{ courseId, userId }`. `CourseAccessParams` is Claude's name: the spec names no component for that path.
  - `CourseIdParam` is reused for the grant list.
- **DTO fields, exactly (spec §11.4, §11.6 outcome-2 column):**
  - `CourseAccessUserDto` `{ id, displayName, avatarUrl | null }`.
  - `CourseAccessGrantDto` `{ id, user, source: 'admin', grantedAt, grantedBy | null, revokedAt | null, revokedBy | null }`.
  - `LearnerCourseSummaryDto` `{ course: CourseSummaryDto, totalLessons }`. `totalLessons` counts **published** lessons.
  - `LearnerCourseDto` `{ course: CourseSummaryDto, sections: LearnerCourseSectionDto[] }`.
  - `LearnerCourseSectionDto` `{ id, title, lessons }`.
  - `LearnerCourseLessonDto` `{ id, title, durationSeconds | null }`.
  - `LessonPlaybackDto` `{ id, title, sectionTitle, durationSeconds | null, video: VimeoVideoDto, previousLessonId | null, nextLessonId | null }`.
  - `VimeoVideoDto` `{ provider: 'vimeo', videoId, privacyHash | null }`.
  - **`LessonPlaybackDto`/`VimeoVideoDto` are the only classes with a video field.**
- **Routes, exactly spec §11.2 (outcome-2 rows) and §11.4:**
  - `GET /learn/courses`, `GET /learn/courses/:slug` and `GET /learn/courses/:slug/lessons/:lessonId`: session only, no `@Roles`, every role needs a grant (§5.3: admins have no implicit learner access).
  - `GET /admin/courses/:courseId/access-grants`, `PUT /admin/courses/:courseId/access/:userId` (200) and `DELETE /admin/courses/:courseId/access/:userId` (204, `@HttpCode(204)` + `void`, I12): all `@Roles('admin')`.
  - Every `/learn/*` success response sets `Cache-Control: no-store` (spec §7.1), through `@Header('Cache-Control', 'no-store')` on each learner handler.
- **Check order on learner routes (spec §7):**
  1. Session: 401 (guard).
  2. Course exists and is published: 404. An impossible slug gives 404 without a query, through the same `COURSE_SLUG_PATTERN` gate as `getPublishedOutline`.
  3. Lesson is published and in that course: 404.
  4. Active grant: 403 `COURSE_ACCESS_REQUIRED`.

  A malformed `lessonId` is 400 `INVALID_FORMAT` at `lessonId` (D9).
- **Grant semantics (spec §5.3):**
  - **Grant:** the upsert above, with explicit columns `{ userId, courseId, source: 'admin', grantedByUserId: admin.id }` (D32, I9). The course may be a draft. FK violation on `fk_course_access_grants_user_id` or `fk_course_access_grants_course_id` → `404 NOT_FOUND`, translated in the service (D11, I15).
  - **Revoke:** one `UPDATE … SET revoked_at = now(), revoked_by_user_id = :admin WHERE user_id = :u AND course_id = :c AND source = 'admin' AND revoked_at IS NULL`. If it affects 0 rows, check that the course exists: a missing course → 404, otherwise 204. An unknown user → 204. Progress isn't touched (none exists yet).
  - **Restore** = a new row. **Self-grant** is allowed (OD-6).
  - **Access** ⇔ `EXISTS (… WHERE user_id = :u AND course_id = :c AND revoked_at IS NULL)`.
- **No lock rule L1 for grants:** a grant's FK check takes `KEY SHARE` on the course row, which `FOR NO KEY UPDATE` doesn't block (S9). A slug change takes `FOR UPDATE`, so a grant waits behind it (R6). Neither can deadlock with the other.
- Schema only by migration (I7); D25 names; `timestamptz`; `uuidv7()`. No `save` (D36).
- **Pagination:** none on the grant list and `GET /learn/courses` (spec §11.2, §11.4; services precedent). State this DEFAULT deviation in the PR Notes.
- **Owner-only, each time:** `migration:run` / `revert` on any database; `yarn test:e2e`; anything that writes to `xuan_dev`. Allowed under the delegation: `migration:generate` (read-only, ruling C3 of outcome 1), lint, typecheck, unit tests, build.
- Never delete branches; no force-push; the PR targets `dev`.

## Review Focus

1. **A lesson of another published course** requested under a course the learner may access → 404, never that lesson's reference. Test: Task 5.
2. **Unknown or malformed ids on grant routes:**
   - unknown `userId` or `courseId` on `PUT` → 404 (FK translated), never 500;
   - an unknown course on `DELETE` and on the list → 404;
   - a malformed id → 400 `INVALID_FORMAT`.

   Test: Task 4.
3. **Draft lessons are invisible to learners.** A draft lesson between two published ones is skipped by `previousLessonId`/`nextLessonId`, gets 404 when requested directly, and is missing from the learner curriculum. Test: Task 2 (unit), Task 5.
4. **An admin is not a learner.** An admin without a grant gets 403 on every `/learn` course and lesson route, and the empty list on `GET /learn/courses`. Test: Task 5.
5. **A course unpublished after a grant (OD-4)** disappears from `GET /learn/courses`, and its detail and lessons give 404. Re-publishing restores access with the same grant row. Test: Task 5.

## File map

| File | Task | Responsibility |
|---|---|---|
| `src/modules/courses/course-access-grant.entity.ts` | 1 | `course_access_grants` mapping |
| `src/database/migrations/<ts>-CreateCourseAccessGrants.ts` | 1 | Generated, read against the map |
| `src/modules/courses/courses.module.ts` | 1, 4, 5 | `forFeature` + `UsersModule`; new controllers and services |
| `src/database/postgres-errors.ts` (+ `.spec.ts`) | 2 | `isForeignKeyViolation(error, constraint)` |
| `src/modules/courses/courses.errors.ts` | 2 | `COURSE_ACCESS_REQUIRED` |
| `src/modules/courses/playback.ts` (+ `.spec.ts`) | 2 | Pure: locate a lesson and its neighbours in a published tree |
| `src/modules/courses/dto/course-access.dto.ts` | 2 | Grant DTOs, mapper, `CourseAccessParams` |
| `src/modules/courses/dto/learning.dto.ts` | 2 | Learner DTOs, mappers, `LessonPathParams` |
| `src/modules/courses/course-access.service.ts` | 4 | Grant, revoke, list, `hasActiveAccess` |
| `src/modules/courses/admin-course-access.controller.ts` | 4 | §11.4 routes |
| `src/modules/courses/courses.service.ts` | 5 | Expose the published-course lookup and the tree loader to `LearningService` |
| `src/modules/courses/learning.service.ts` | 5 | Learner list, curriculum, playback |
| `src/modules/courses/learning.controller.ts` | 5 | §11.2 outcome-2 routes |
| `test/admin-course-access.e2e-spec.ts` | 4 | Grant/revoke/list outcomes, authz, R5, R5b, R6 |
| `test/learning.e2e-spec.ts` | 5 | Learner outcomes, privacy, revocation |
| `test/courses-schema.e2e-spec.ts` | 3 | Grant constraints at the database |
| `test/openapi.e2e-spec.ts` | 6 | Components, fields, codes |
| `docs/database.md`, `docs/data-model.md`, `docs/architecture.md`, `docs/api-contract.md` | 1, 6 | Map, concepts, AD16 + S8, contract |

---

### Task 1: Map, entity and migration (S8 round trip) → Checkpoint A

**Files:** create `course-access-grant.entity.ts`, migration; modify `courses.module.ts`, `docs/database.md` §12, `docs/data-model.md`, `docs/architecture.md`.

**Interfaces:**
- Produces: `class CourseAccessGrant { id; userId; courseId; source: GrantSource; grantedByUserId: string | null; grantedAt: Date; revokedAt: Date | null; revokedByUserId: string | null; createdAt; updatedAt }`, `GRANT_SOURCES = ['admin'] as const`, `type GrantSource`.

- [ ] **Step 1: Write the map into `database.md` §12, status *decided***. Use the Mermaid block and a table map, exactly:

| Column | Type | Required | Default | Keys / constraints | Why |
|---|---|---|---|---|---|
| `id` | `uuid` | yes | `uuidv7()` | **PK** `pk_course_access_grants` | One row per grant (OD-1) |
| `user_id` | `uuid` | yes | — | **FK** `fk_course_access_grants_user_id` → `users(id)` `RESTRICT` (by entity name, AD14) | The learner |
| `course_id` | `uuid` | yes | — | **FK** `fk_course_access_grants_course_id` → `courses(id)` `RESTRICT` | — |
| `source` | `varchar(16)` | yes | — | **CK** `ck_course_access_grants_source`: `source IN ('admin')` | Only value in V1; orders widens it to `'purchase'` (§5.4). No default: every writer names its source |
| `granted_by_user_id` | `uuid` | no | — | **FK** `fk_course_access_grants_granted_by_user_id` → `users(id)` `RESTRICT`; **CK** `ck_course_access_grants_admin_has_granter`: `source <> 'admin' OR granted_by_user_id IS NOT NULL` | Who granted; a future purchase grant has none |
| `granted_at` | `timestamptz` | yes | `now()` | — | Shown in the grant history |
| `revoked_at` | `timestamptz` | no | — | **CK** `ck_course_access_grants_revocation_pair`: `(revoked_at IS NULL) = (revoked_by_user_id IS NULL)` | `NULL` = active |
| `revoked_by_user_id` | `uuid` | no | — | **FK** `fk_course_access_grants_revoked_by_user_id` → `users(id)` `RESTRICT` | Who revoked |
| `created_at`, `updated_at` | `timestamptz` | yes | `now()` | — | D27; a repeated grant moves `updated_at` (S8) |

  - **Indexes:**
    - `uq_course_access_grants_user_id_course_id_active_admin`: UNIQUE `(user_id, course_id) WHERE source = 'admin' AND revoked_at IS NULL`. CP5; the upsert target. Plus the S8 caveat.
    - `ix_course_access_grants_user_id_course_id` `(user_id, course_id)`: the access check, `GET /learn/courses` and the user FK.
  - **No other index:** the admin grant list (`WHERE course_id ORDER BY granted_at DESC, id DESC`) runs over a handful of rows, and neither courses nor users are ever deleted in V1. Add an index when `EXPLAIN` on real data says so.
  - **Status row:** *decided*, Checkpoint M with this plan.
  - **Other docs:**
    - `data-model.md`: the "enrollment vs entitlement" question is resolved by OD-1 (one access grant per grant; access = an active one; history kept).
    - `architecture.md`: §3 layout gains the two services and controllers; §17 "References to `users.id`" gains the three FKs; new decision **AD16** (grant model OD-1, partial unique index plus `ON CONFLICT` upsert, no course lock for grants); the S8 row with the result above.
- [ ] **Step 2: Entity**, names and types exactly as the map, using `@Index(name, cols, { unique: true, where: `"source" = 'admin' AND "revoked_at" IS NULL` })`, `@Check` names, `@ForeignKey`. Register it in `forFeature` and add `UsersModule` to `imports`.
- [ ] **Step 3: `yarn migration:generate src/database/migrations/CreateCourseAccessGrants`**, then read the SQL against the map (D33). It must equal the S8 dry run in the ledger: 1 table, 3 CHECKs, 2 indexes, 4 FKs, a reversing `down()`, and **no other table touched**.
- [ ] **Step 4:** `yarn lint && yarn typecheck && yarn test` → green. Commit `docs(database): add the course access grants map` and `feat(course): add the course access grant entity and its migration`.
- [ ] **Step 5: Checkpoint A (owner approval):**
  - A1 `NODE_ENV=test yarn test:db-guard && NODE_ENV=test yarn migration:run` on `xuan_test`, then `\d+ course_access_grants`;
  - A2 revert → `\d` shows only that table gone → re-run → second generate on `xuan_test` is empty (the S8 round trip);
  - A3 the repeated `yarn test:e2e` runs of Tasks 3–6.

### Task 2: Pure pieces: errors, FK helper, playback lookup, DTOs and request schemas

**Files:** `postgres-errors.ts` (+ spec), `courses.errors.ts`, `playback.ts` (+ spec), `dto/course-access.dto.ts`, `dto/learning.dto.ts`.

**Interfaces:**
- Produces:
  - `isForeignKeyViolation(error: unknown, constraint: string): boolean`: code `23503` plus the constraint name, as `isUniqueViolation`.
  - `locatePlayback(tree: CourseTree, lessonId: string): { lesson: CourseLesson; section: CourseSection; previousLessonId: string | null; nextLessonId: string | null } | null`. The tree is the **published** tree, so neighbours run across sections in curriculum order. Returns `null` when the lesson isn't in it.
  - `courseAccessParamsSchema` (`strictObject({ courseId: uuid, userId: uuid })`, `.meta({ id: 'CourseAccessParams' })`).
  - `lessonPathParamsSchema` (`strictObject({ slug: string, lessonId: uuid })`, `.meta({ id: 'LessonPathParams' })`).
  - `type GrantView = { grant: CourseAccessGrant; profiles: ReadonlyMap<string, PublicProfile> }`, `toCourseAccessGrantDto(view)`.
  - `type LearnerCourseListItem = { course: Course; totalLessons: number }`, `toLearnerCourseSummaryDto(item)`, `toLearnerCourseDto(tree)`, `toLessonPlaybackDto(located)`.

- [ ] **Step 1: Failing unit tests:**
  - `playback.spec.ts`, table-driven over one tree (section A: l1, l2; section B: l3). Expected: l1 → prev `null`, next `l2`; l2 → `l1`/`l3` (across sections); l3 → `l2`/`null`; an unknown id → `null`; a one-lesson tree → `null`/`null`.
  - `postgres-errors.spec.ts`:
    - `isForeignKeyViolation` is true for a `QueryFailedError` with `{ code: '23503', constraint: 'fk_x' }` and `'fk_x'`;
    - false for another name, for `23505`, and for a plain `Error`.
- [ ] **Step 2:** Run `yarn test` and watch both fail. Then implement, run `yarn test` and see them pass.
- [ ] **Step 3:** Add the error and the DTO classes, with `@ApiProperty` exactly as the field list:
  - `source` is `enum: ['admin']`; `provider` is `enum: ['vimeo']`;
  - nullable fields use `nullable: true`;
  - `user`, `grantedBy` and `revokedBy` are `CourseAccessUserDto`.
  
  Mappers set `video` only in `toLessonPlaybackDto`.
- [ ] **Step 4:** `yarn lint && yarn typecheck && yarn test` → green. Commit `feat(course): add the access error, playback lookup and learner DTOs`.

### Task 3: Grant constraints at the database (`test/courses-schema.e2e-spec.ts`)

- [ ] **Step 1:** Add a `describe('course_access_grants')` that writes rows with direct SQL and asserts the Postgres error code and constraint name:
  - a second **active** admin grant for the same (user, course) → `23505` `uq_course_access_grants_user_id_course_id_active_admin`;
  - after revoking the first, a second insert **succeeds**: the partial predicate proves history;
  - `source = 'purchase'` → `23514` `ck_course_access_grants_source`;
  - an admin grant without `granted_by_user_id` → `23514` `ck_course_access_grants_admin_has_granter`;
  - `revoked_at` without `revoked_by_user_id` → `23514` `ck_course_access_grants_revocation_pair`;
  - an unknown `user_id` and an unknown `course_id` → `23503` with their FK names;
  - defaults: a `uuidv7` id, `granted_at`/`created_at` filled, `revoked_at` null.
- [ ] **Step 2:** `yarn test:e2e test/courses-schema.e2e-spec.ts` (under A3) → green. Commit `test(course): prove the access grant constraints`.

### Task 4: Admin access (`CourseAccessService`, `AdminCourseAccessController`)

**Interfaces:**
- Consumes: Task 2's DTOs, schemas, `isForeignKeyViolation`, and `UserProfilesReader.findPublicProfiles`.
- Produces:
  - `CourseAccessService.grant(courseId: string, userId: string, adminId: string): Promise<GrantView>`;
  - `revoke(courseId: string, userId: string, adminId: string): Promise<void>`;
  - `listForCourse(courseId: string): Promise<GrantView[]>`;
  - `hasActiveAccess(userId: string, courseId: string): Promise<boolean>`.
  
  The grant maps the `RETURNING *` row (`InsertResult.raw[0]`, snake_case) to a `CourseAccessGrant`. **It never re-reads**, so the response is the row as of its own statement. One `findPublicProfiles` call per response gathers every id involved: `userId`, `grantedByUserId`, `revokedByUserId`.

- [ ] **Step 1: Failing e2e** in `test/admin-course-access.e2e-spec.ts`, with exact bodies (`toEqual`):
  - **Grant:** `PUT` → 200 with the full `CourseAccessGrantDto`: `grantedBy` = the admin's profile; `revokedAt`/`revokedBy` null; `source: 'admin'`. A second `PUT` → 200 with **the same id and `grantedAt`**.
  - **Draft course:** the grant works (the course is a draft).
  - **Self-grant:** works (OD-6).
  - **Revoke:** `DELETE` → 204 with an empty body; a second `DELETE` → 204. A `DELETE` for a user who was never granted → 204.
  - **Restore:** `PUT` after a revoke → a **new** id. The list shows both rows, newest first: the new one active, the old one with `revokedAt` and `revokedBy` = the admin.
  - **404:** an unknown user on `PUT` (FK translated); an unknown course on `PUT`, on `DELETE` and on the list. A malformed `courseId` or `userId` → 400 `INVALID_FORMAT` at that field.
  - **Privacy:** no `email` anywhere in the list body.
  - **Authz:** editor and user → 403 on all three routes; no session → 401; a write without `X-Requested-With` → 403.
  - **R5:** two concurrent `PUT`s, 15 trials → both 200 with the same id, and exactly one active row.
  - **R5b:** start each trial from an active grant G, then fire `PUT` ∥ `DELETE`, 15 trials → 200 and 204, never 500. The `PUT`'s returned id tells the serial order:
    - **= G** (the grant ran first): G ends revoked by the admin, and no row is active;
    - **a new id** (the revoke ran first): G is revoked and the new row is the only active one.
    
    Check this with SQL on `revoked_at IS NULL`.
  - **R6:** `PUT` grant ∥ a slug change on a never-published course ∥ a lesson publish on the same course, 15 trials → all complete with their success status, and no 500 (no `40P01`).
- [ ] **Step 2:** Run the file (A3) and watch it fail. Implement the service and controller. Each route documents `@ApiErrorResponses` from the same definitions:
  - list: `VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND`;
  - `PUT`: the same;
  - `DELETE`: the same, plus `@ApiNoContentResponse`.
  
  Register both in `courses.module.ts`.
- [ ] **Step 3:** The file is green; `yarn lint && yarn typecheck && yarn test` → green. Commit `feat(course): grant, revoke and list course access`.

### Task 5: Learner routes (`LearningService`, `LearningController`)

**Interfaces:**
- Consumes:
  - `CourseAccessService.hasActiveAccess`;
  - `CoursesService.findPublishedBySlug(slug): Promise<Course>` (new public method; 404 rules of today's `getPublishedOutline`, which now calls it);
  - `CoursesService.loadPublishedTree(course: Course): Promise<CourseTree>` (new public method; `loadTree(…, 'published')`);
  - `locatePlayback`.
- Produces:
  - `LearningService.listCourses(userId): Promise<LearnerCourseListItem[]>`: published courses with an active grant, newest `publishedAt` first, tie `id DESC`. One query for the courses and one grouped count of published lessons;
  - `getCourse(userId, slug): Promise<CourseTree>`;
  - `getPlayback(userId, slug, lessonId): Promise<NonNullable<ReturnType<typeof locatePlayback>>>`.

- [ ] **Step 1: Failing e2e** in `test/learning.e2e-spec.ts` (exact bodies). Fixture: published course C with section A (published l1, **draft** d, published l2) and section B (published l3, with `privacyHash`); a second published course C2 with lesson x.
  - **Playback:** with a grant, l2 → `{ id, title, sectionTitle: 'A', durationSeconds, video: { provider: 'vimeo', videoId, privacyHash: null }, previousLessonId: l1, nextLessonId: l3 }`; l3 carries its `privacyHash` and `nextLessonId: null`.
  - **Learner curriculum:** `GET /learn/courses/<C>` has every published lesson, no `d`, **no video field anywhere** (exact body, plus a recursive key scan for `videoId`, `privacyHash` and `vimeo`).
  - **List:** `GET /learn/courses` → `[{ course: <CourseSummaryDto of C>, totalLessons: 3 }]`. C2 isn't listed (no grant). A user with no grants gets `[]`.
  - **404, even with a grant:** lesson `d`; lesson `x` under C (Review Focus 1); a draft course (OD-2); an unknown slug; an impossible slug (`'UPPER'`, NUL). A malformed `lessonId` → 400.
  - **403:** without a grant, `COURSE_ACCESS_REQUIRED` on the course and its lessons. An admin with no grant → 403 (Review Focus 4). No session → 401.
  - **Revocation:** grant → 200; revoke → the **next** playback request is 403 (CP6); re-grant → 200 again.
  - **Unpublish after a grant (OD-4):** the course isn't listed; detail and lesson → 404; re-publish → listed again (Review Focus 5).
  - **Headers:** every 200 response on the three routes has `cache-control: no-store`.
- [ ] **Step 2:** Run it (A3) and watch it fail. Implement the two `CoursesService` methods, then the service and the controller. Errors:
  - list: `UNAUTHENTICATED`;
  - course: `UNAUTHENTICATED, NOT_FOUND, COURSE_ACCESS_REQUIRED`;
  - lesson: `VALIDATION_FAILED`, plus the course route's codes.
  
  Register them in the module.
- [ ] **Step 3:** The learner file, `test/courses.e2e-spec.ts` (the `getPublishedOutline` refactor) and `yarn test` → green. Commit `feat(course): serve the learner curriculum and gated playback`.

### Task 6: Contract docs and OpenAPI tests

- [ ] **Step 1:** In `test/openapi.e2e-spec.ts`, add a `describe('course access contract (course spec §11.2, §11.4)')`:
  - every new component is named;
  - `propsOf` per DTO equals the field list exactly;
  - `VimeoVideoDto.provider` and `CourseAccessGrantDto.source` are single-value enums;
  - **only** `LessonPlaybackDto` and `VimeoVideoDto` have video fields;
  - error codes per route are as Task 4 and Task 5 list them, with `COURSE_ACCESS_REQUIRED` under 403;
  - the new routes join the "401 on non-public, 403 on state-changing" test.
- [ ] **Step 2:** Run the full `yarn test:e2e` (A3) → green.
- [ ] **Step 3:** Update the contract docs:
  - `api-contract.md` §11: the routes, DTOs, components, `COURSE_ACCESS_REQUIRED` and the `no-store` note;
  - `api-contract.md` §12: a delta row 14 ("Course access (outcome 2): …, playback can be built now; progress fields arrive additively in outcome 3");
  - `architecture.md`: the S8 row is final once A2 is observed.
  
  Commit `docs(course): document course access and learner routes`.

### Task 7: Verify, review, PR → Checkpoint D → merge

- [ ] **Step 1:** Run `yarn lint`, `yarn typecheck`, `yarn test`, `yarn test:e2e` (A3), `yarn build` and `yarn format:check`. Then the race files 6× (A3): R5, R5b and R6 must be stable.
- [ ] **Step 2:** Run `xuan-api-architecture-review`, then a fresh independent whole-branch review. Fix Critical and Important findings, then re-verify.
- [ ] **Step 3:** Push and open the PR `feat: grant course access and gate lesson playback` with the §9.3 body (Database, API Contract and Security sections). The Notes carry:
  - the unpaginated lists;
  - S8's `updated_at` difference;
  - `CourseAccessParams` as Claude's name;
  - the revocation window (§7.1).
- [ ] **Step 4: Checkpoint D (owner approval):** a read-only preflight first:
  - identity;
  - only `CreateCourseAccessGrants` pending;
  - checksum;
  - the other tables' fingerprint, row counts and content hashes.
  
  Then `yarn migration:run` on `xuan_dev`, then `\d+ course_access_grants`, then the second generate is empty. After that, the map → *implemented*, and the PR's Database boxes are ticked for what was observed.
- [ ] **Step 5:** Merge into `dev` with a merge commit under the §3.5 Git row; **keep the branch**. Outcome 3 starts only after this merge.
