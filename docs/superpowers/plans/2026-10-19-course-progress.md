# Course Progress and Resume (course platform outcome 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (Native, owner-selected 2026-10-19) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** on branch `feat/track-course-progress`:
- a learner with an active grant saves their playback position and completion per lesson, and resumes where they stopped, on any device;
- the learner responses gain progress and resume fields **additively**;
- a lesson that has progress can't be deleted.

**Architecture:**
- The `courses` module gains `lesson_progress`: one row per (user, lesson), FK to `course_lessons`, FK to `users` by entity name (AD14).
- **The write** is `PUT /learn/courses/:slug/lessons/:lessonId/progress`. It runs the same §7 checks as playback (404s first, then 403), clamps the position to the lesson's duration, then does **one statement**: `INSERT … ON CONFLICT ON CONSTRAINT uq_lesson_progress_user_id_lesson_id DO UPDATE` with sticky completion (D32). No course lock.
- **The read side:**
  - the learner list, curriculum and playback load the caller's progress rows in **one query per request**;
  - they clamp positions on read (§9.6) and compute `resumeLessonId` with a pure rule (§9.4).
- Lesson deletion translates `fk_lesson_progress_lesson_id` (RESTRICT) to `409 LESSON_HAS_PROGRESS` (§10.4, D11).

**Tech Stack:** NestJS 12 ESM, TypeORM 1.1.2, PostgreSQL 18, Zod 4, Vitest + supertest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-17-course-platform-design.md` (approved 2026-10-18, revision 2). Binding for this outcome: §9.1–9.6, §10.2, §10.4, §10.6 (progress upsert lock analysis), §11.2 (progress row), §11.3 (`LESSON_HAS_PROGRESS`), §11.5, §11.6 (outcome-3 column and compatibility), §12, §13, §14, §16 row 3, §18 outcome 3 (R7).

**Mode:** delegated (`development-workflow.md` §3.5, course platform row). Every task is `[delegate]`. Database operations stay owner-only, each time:
- **Checkpoint A** after Task 1;
- the e2e runs from Task 1 on;
- **Checkpoint D** in Task 7, its own packet.

**Checkpoint M (map approval):** the map in Task 1 Step 1 is part of this plan; **approving this plan approves that map**.

## Calls made in this plan (for the owner to check)

1. **Table name `lesson_progress`** (spec §9.1 default), not `course_lesson_progress`. The spec's approved constraint names (§13: `uq_lesson_progress_user_id_lesson_id`, `fk_lesson_progress_lesson_id`) use it. "Progress" is a mass noun, so the plural rule (`database.md` §2) is met in spirit.
2. **An extra index `ix_lesson_progress_lesson_id`.** The lesson FK's `RESTRICT` check on a lesson delete looks rows up by `lesson_id`, and without it that's a full scan of a table that grows with users × lessons. Same reason as `ix_sessions_user_id`. The unique `(user_id, lesson_id)` already serves the user FK and every learner read.
3. **The upsert is one parameterized `manager.query` statement**, not TypeORM's `orUpdate`. `orUpdate` can only emit `col = EXCLUDED.col`, and sticky completion needs `completed_at = COALESCE(lesson_progress.completed_at, EXCLUDED.completed_at)`. The SQL is spec §9.2's own, with a named target (D32); the codebase already uses parameterized `manager.query` (`nextPosition`, `closeGap`).
4. **Resume tie-break:** if two published lessons share the latest `last_watched_at` (only possible within one transaction instant), the one **later in curriculum order** wins.
5. **`resumeLessonId` is non-null** (`string`, uuid) in both learner DTOs. A published course always has a published lesson (P1), and rule 3 then gives the first one.
6. **The learner list loads all listed courses' published trees in two queries** (a batched `loadPublishedTrees`) and derives `totalLessons`, `completedLessons` and `resumeLessonId` from them. This replaces outcome 2's separate grouped count (D38: no N+1).

## Global Constraints

- **Tables:** only `courses` registers `LessonProgress` (I1). No `User` import (AD14, I2).
- **Contract (I19, spec §11.6, additive only):**
  - new `LessonProgressDto` `{ positionSeconds, completed }`;
  - new `SaveLessonProgressDto` `{ positionSeconds: integer 0–86 400, completed?: true }` (strict; `completed: false` → 400 `INVALID` at `completed`);
  - `LearnerCourseSummaryDto` **+** `completedLessons` (number), `resumeLessonId` (uuid);
  - `LearnerCourseDto` **+** `resumeLessonId`;
  - `LearnerCourseLessonDto` **+** `progress`;
  - `LessonPlaybackDto` **+** `progress`.
  
  No field renamed or removed; outcome 2's exact-body tests change **only by added fields**.
- **Progress values:**
  - With no row: `{ positionSeconds: 0, completed: false }`.
  - On read: `positionSeconds = min(stored, durationSeconds)` when the duration is known, never written back.
  - `completed` is `completed_at IS NOT NULL`.
- **Write route** `PUT /learn/courses/:slug/lessons/:lessonId/progress` → **204** (`@HttpCode(204)` + `void`, I12). Path `LessonPathParams` (reused), body `SaveLessonProgressDto`, CSRF header required.
  - **Errors:** `400`, `401`, `403 COURSE_ACCESS_REQUIRED`, `404`, `413`.
  - **Check order** as playback (§7): course published → lesson published in it → active grant.
  - **The session user only** (I9): there's no user in the path or body.
- **Write SQL** (spec §9.2):

```sql
INSERT INTO "lesson_progress" ("user_id", "lesson_id", "position_seconds", "completed_at", "last_watched_at")
VALUES ($1, $2, $3, CASE WHEN $4::boolean THEN now() END, now())
ON CONFLICT ON CONSTRAINT "uq_lesson_progress_user_id_lesson_id" DO UPDATE SET
  "position_seconds" = EXCLUDED."position_seconds",
  "last_watched_at" = now(),
  "completed_at" = COALESCE("lesson_progress"."completed_at", EXCLUDED."completed_at"),
  "updated_at" = now()
```

  - `$3` is already clamped: `clampPosition(input.positionSeconds, lesson.durationSeconds)`.
  - An FK violation on `fk_lesson_progress_lesson_id` (the lesson was deleted after the check) → `404 NOT_FOUND`.
- **Resume (§9.4):**
  1. Among **published** lessons, take the one with the latest `last_watched_at`.
  2. If it's completed, take the next published lesson in curriculum order, or stay on it if none is left.
  3. With no progress, take the first published lesson.
  
  Progress on unpublished lessons is kept but ignored (§10.2). `completedLessons` counts **published** lessons only.
- **Lesson delete:** the existing draft-only rule stays first (`409 LESSON_IS_PUBLISHED`). Then a `fk_lesson_progress_lesson_id` violation → **`409 LESSON_HAS_PROGRESS`**, "This lesson has learner progress; unpublish it instead." (kind `conflict`).
- **No course lock for progress writes** (spec §10.6). A write may wait behind a reorder that moves its lesson (S9: a position update takes `FOR UPDATE`), and that's a wait, not a deadlock (R7).
- **Owner-only, each time:** `migration:run` / `revert`; `yarn test:e2e`; anything that writes to `xuan_dev`. Allowed under the delegation: `migration:generate`, lint, typecheck, unit tests, build.
- Never delete branches; no force-push; the PR targets `dev`.

## Review Focus

1. **Positions above the duration:**
   - a write of 900 on a 600 s lesson stores 600;
   - after the admin lowers the duration to 300, every read shows 300, the row still holds 600 (no write on read), and a lesson without a duration stores and shows the raw value.
   
   Test: Task 2 (unit), Task 4.
2. **Invalid progress bodies** → 400 with the right field codes, and no row:
   - `completed: false` → `INVALID`;
   - `-1` → `TOO_SMALL`; `86401` → `TOO_LARGE`; `1.5` → `INVALID_TYPE`;
   - a missing `positionSeconds` → `REQUIRED`; the unknown key `userId` → `UNKNOWN_FIELD`.
   
   Test: Task 2 (schema unit), Task 4.
3. **No access, no write:**
   - a never-granted or revoked learner → 403 and no row change;
   - a draft lesson or another course's lesson → 404 and no row;
   - an admin without a grant → 403.
   
   Test: Task 4.
4. **Unpublished lessons and resume:** progress on a lesson later unpublished is kept but excluded from `resumeLessonId` and `completedLessons`, and re-publishing brings it back. Test: Task 2 (unit), Task 5.
5. **Isolation:** one learner's write never changes another learner's row or another lesson's row; completion survives a later write without `completed`. Test: Task 4.

## File map

| File | Task | Responsibility |
|---|---|---|
| `src/modules/courses/lesson-progress.entity.ts` | 1 | `lesson_progress` mapping |
| `src/database/migrations/<ts>-CreateLessonProgress.ts` | 1 | Generated, read against the map |
| `src/modules/courses/courses.module.ts` | 1 | `forFeature` |
| `src/modules/courses/progress.ts` (+ `.spec.ts`) | 2 | Pure: `clampPosition`, `resolveResumeLessonId` |
| `src/modules/courses/dto/learning.dto.ts` (+ new `save-progress.dto.ts` + spec) | 2, 5 | `LessonProgressDto`, `SaveLessonProgressDto`, the added fields and mappers |
| `src/modules/courses/courses.errors.ts` | 2 | `LESSON_HAS_PROGRESS` |
| `test/courses-schema.e2e-spec.ts` | 3 | Progress constraints at the database |
| `src/modules/courses/learning.service.ts`, `learning.controller.ts` | 4, 5 | Write route; progress on reads |
| `src/modules/courses/courses.service.ts`, `admin-courses.controller.ts` | 5 | `loadPublishedTrees`; `LESSON_HAS_PROGRESS` translation and docs |
| `test/learning-progress.e2e-spec.ts` | 4 | Write outcomes, R7 |
| `test/learning.e2e-spec.ts`, `test/admin-courses.e2e-spec.ts` | 5 | Added fields; delete with progress |
| `test/openapi.e2e-spec.ts` | 6 | Components, fields, codes |
| `docs/database.md`, `docs/data-model.md`, `docs/architecture.md`, `docs/api-contract.md` | 1, 6 | Map, concept, layout and S9/R7, contract |

---

### Task 1: Map, entity and migration → Checkpoint A

**Interfaces:**
- Produces: `class LessonProgress { id; userId; lessonId; positionSeconds: number; completedAt: Date | null; lastWatchedAt: Date; createdAt; updatedAt }`.

- [ ] **Step 1: Map in `database.md` §12** (Mermaid block + table), status *decided*:

| Column | Type | Required | Default | Keys / constraints | Why |
|---|---|---|---|---|---|
| `id` | `uuid` | yes | `uuidv7()` | **PK** `pk_lesson_progress` | D26 |
| `user_id` | `uuid` | yes | — | **FK** `fk_lesson_progress_user_id` → `users(id)` `RESTRICT` (by entity name, AD14); leads `uq_lesson_progress_user_id_lesson_id` | The learner; always the session user |
| `lesson_id` | `uuid` | yes | — | **FK** `fk_lesson_progress_lesson_id` → `course_lessons(id)` `RESTRICT` | Survives reorders and moves (the lesson id never changes). `RESTRICT` makes a lesson with progress undeletable → `409 LESSON_HAS_PROGRESS` (P5) |
| `position_seconds` | `integer` | yes | — | **CK** `ck_lesson_progress_position_not_negative`: `position_seconds >= 0` | Clamped on write to the lesson's duration; the API caps it at 86 400 |
| `completed_at` | `timestamptz` | no | — | — | Sticky: set once, never cleared (`COALESCE`) |
| `last_watched_at` | `timestamptz` | yes | `now()` | — | Server time of the last write; picks the resume lesson |
| `created_at`, `updated_at` | `timestamptz` | yes | `now()` | — | D27; every write sets `updated_at` |

  - **Constraints:**
    - `uq_lesson_progress_user_id_lesson_id`: UNIQUE `(user_id, lesson_id)`. One row per (user, lesson); the upsert target (D32). Its leading `user_id` is the user FK index and serves every learner read.
    - `ix_lesson_progress_lesson_id` `(lesson_id)`: the lesson FK's `RESTRICT` check on delete (call 2).
  - **Not in this table:** a course id (derived through the lesson's section), watch-time totals, a reset flag (OD-11 deferred).
  - **Other docs:**
    - `data-model.md`: a "Lesson progress" row, CONFIRMED (self-reported learning state; kept on revocation and unpublish).
    - `architecture.md` §3 layout: progress. §17 "References to `users.id`": `lesson_progress.user_id`.
- [ ] **Step 2: Entity** exactly as the map (`@Unique`, `@Index`, `@Check`, `@ForeignKey('User', …)`, `@ForeignKey(() => CourseLesson, …)`); register it in `forFeature`.
- [ ] **Step 3: `yarn migration:generate src/database/migrations/CreateLessonProgress`**, then read the SQL against the map: 1 table, 1 CHECK, 1 UNIQUE, 1 index, 2 FKs `RESTRICT`, a reversing `down()`, no other table touched.
- [ ] **Step 4:** `yarn lint && yarn typecheck && yarn test` → green. Commit `docs(database): add the lesson progress map` and `feat(course): add the lesson progress entity and its migration`.
- [ ] **Step 5: Checkpoint A (owner approval), with the same preconditions as outcome 2:**
  - the target is `xuan_test`;
  - the guard passes;
  - this migration is the sole pending one;
  - its SQL equals the map;
  - record the file, checksum and before-fingerprint.
  
  Then:
  - **A1:** run, then `\d+ lesson_progress`.
  - **A2:** revert → re-run → the second generate is empty.
  - **A3:** the repeated `yarn test:e2e` runs of Tasks 3–7.

### Task 2: Pure rules, request schema, DTO classes, error

**Interfaces:**
- Produces:
  - `clampPosition(positionSeconds: number, durationSeconds: number | null): number`;
  - `type ProgressState = { completedAt: Date | null; lastWatchedAt: Date }`;
  - `resolveResumeLessonId(publishedLessonIds: readonly string[], progress: ReadonlyMap<string, ProgressState>): string | null`: `null` only for an empty list; ids are in curriculum order;
  - `saveLessonProgressSchema` (`.meta({ id: 'SaveLessonProgressDto' })`) and `type SaveLessonProgressInput`;
  - `class LessonProgressDto`, and `toLessonProgressDto(row: ProgressState & { positionSeconds: number } | undefined, durationSeconds: number | null): LessonProgressDto`;
  - `coursesErrors.LESSON_HAS_PROGRESS`.

- [ ] **Step 1: Failing unit tests (table-driven):**
  - **`progress.spec.ts`, clamp:**
    - `(900, 600)` → 600; `(30, 600)` → 30; `(900, null)` → 900; `(0, 600)` → 0.
  - **`progress.spec.ts`, resume** (lessons `[a, b, c]`):
    - no progress → `a`;
    - latest on `b`, not completed → `b`;
    - latest on `b`, completed → `c`;
    - latest on `c`, completed → `c`;
    - progress only on an id not in the list (unpublished) → `a`;
    - a tie at the latest instant on `a` and `b` → `b`;
    - an empty list → `null`.
  - **`save-progress.dto.spec.ts`:** the Review Focus 2 cases with their field codes; `{ positionSeconds: 0 }` and `{ positionSeconds: 86400, completed: true }` accepted.
- [ ] **Step 2:** watch them fail; implement; `yarn test` → green.
- [ ] **Step 3:** Add the DTO class `LessonProgressDto` (`positionSeconds: integer`, `completed: boolean`) and `LESSON_HAS_PROGRESS`. Commit `feat(course): add the progress rules, request schema and DTO`.

### Task 3: Progress constraints at the database

- [ ] **Step 1:** In `test/courses-schema.e2e-spec.ts`, add `describe('lesson_progress (outcome 3)')`, with direct SQL:
  - defaults: a `uuidv7` id, `last_watched_at`/`created_at` filled, `completed_at` null;
  - a second row for the same (user, lesson) → `uq_lesson_progress_user_id_lesson_id`;
  - `position_seconds = -1` → `ck_lesson_progress_position_not_negative`;
  - an unknown user or lesson → the two FK names;
  - deleting a lesson with progress → `fk_lesson_progress_lesson_id`.
- [ ] **Step 2:** the file is green (A3). Commit `test(course): prove the lesson progress constraints`.

### Task 4: The progress write (`PUT …/progress`)

**Interfaces:**
- Produces: `LearningService.saveProgress(userId: string, slug: string, lessonId: string, input: SaveLessonProgressInput): Promise<void>`. It reuses `getPlayback`'s checks: `findPublishedBySlug` → `locatePlayback` (404) → `requireAccess` (403). Then the one statement.

- [ ] **Step 1: Failing e2e** `test/learning-progress.e2e-spec.ts`. Fixture: published C with l1 (600 s), l2 (no duration), l3; a draft lesson d; another course's lesson x; grants by SQL. Check rows with SQL.
  - **Upsert:** the first `PUT {positionSeconds: 30}` → 204 and empty body; one row (30, `completed_at` null). `PUT {positionSeconds: 45}` → the same row id, 45, and `last_watched_at` moved.
  - **Sticky completion:** `{positionSeconds: 590, completed: true}` sets `completed_at`. A later `{positionSeconds: 10}` keeps it (Review Focus 5) and stores 10.
  - **Clamping on write:** 900 on l1 → 600; 900 on l2 → 900 (Review Focus 1).
  - **Invalid bodies:** each Review Focus 2 body → its exact 400 body, and no row.
  - **No access, no write:** never granted → 403, no row. Grant → write → revoke via the admin API → 403, and the row is unchanged (CP2, CP6). An admin without a grant → 403. `d` and `x` → 404, no row. A draft course → 404 (Review Focus 3).
  - **Isolation:** learner B's write leaves A's row untouched; a write on l1 leaves l3's row untouched (Review Focus 5).
  - **Authz:** no session → 401; no `X-Requested-With` → 403.
  - **R7:** progress `PUT` on l1 ∥ a `curriculum-order` moving l1 to another section, 15 trials → 204 and 200, never 500 (no `40P01`). The row still points to l1, and l1 sits in its new section.
- [ ] **Step 2:** watch it fail (A3). Implement the service method and the controller route:
  - `@HttpCode(204)`;
  - `@ApiNoContentResponse`;
  - `@ApiSchemaParameters('path', lessonPathParamsSchema)`;
  - `@Body({ schema: saveLessonProgressSchema })`;
  - `@ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, NOT_FOUND, COURSE_ACCESS_REQUIRED)`.
- [ ] **Step 3:** green, plus `yarn test`. Commit `feat(course): save lesson progress`.

### Task 5: Progress and resume on the learner reads; `LESSON_HAS_PROGRESS`

**Interfaces:**
- Consumes: Task 2's functions.
- Produces:
  - `CoursesService.loadPublishedTrees(courses: readonly Course[]): Promise<CourseTree[]>` (two queries for all of them);
  - `LearningService` private `progressFor(userId, lessonIds): Promise<Map<string, LessonProgress>>` (one query);
  - the learner item type gains `completedLessons`, `resumeLessonId` and progress;
  - the mappers gain the added fields.

- [ ] **Step 1: Failing e2e:**
  - **`test/learning.e2e-spec.ts`:**
    - update every expected body **by adding fields only**: `progress: { positionSeconds: 0, completed: false }` on lessons and playback, `resumeLessonId: <first published>`, `completedLessons: 0`;
    - add: after writes (l1 completed, l2 at 120), the list shows `completedLessons: 1`, `resumeLessonId: l3`, and the curriculum shows each lesson's progress;
    - add: lowering l1's duration through the admin API reads l1 clamped while its SQL row keeps the value (Review Focus 1);
    - add: unpublish l3 → resume moves back per the rule, `completedLessons` ignores it, and its row stays; re-publish restores it (Review Focus 4).
  - **`test/admin-courses.e2e-spec.ts`:** unpublish a lesson that has progress (inserted by SQL), then `DELETE` → `409 LESSON_HAS_PROGRESS` (exact body), and the lesson still exists. A draft lesson without progress is still 204.
- [ ] **Step 2:** watch them fail (A3). Implement:
  - `loadPublishedTrees`;
  - progress on the list, curriculum and playback;
  - the `deleteLesson` translation (catch outside the transaction, `isForeignKeyViolation(…, 'fk_lesson_progress_lesson_id')`);
  - `LESSON_HAS_PROGRESS` added to that route's `@ApiErrorResponses`.
- [ ] **Step 3:** green across the learning, admin-courses and courses files, plus `yarn test`. Commit `feat(course): show progress and resume to learners and keep progressed lessons`.

### Task 6: Contract docs and OpenAPI tests

- [ ] **Step 1: `test/openapi.e2e-spec.ts`:**
  - the new components (`LessonProgressDto`, `SaveLessonProgressDto`);
  - exact field lists of the four extended DTOs;
  - the progress route's codes (`VALIDATION_FAILED`, `PAYLOAD_TOO_LARGE`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `COURSE_ACCESS_REQUIRED`, `INTERNAL_ERROR`), its 204, and its body `$ref`;
  - `LESSON_HAS_PROGRESS` now on `DELETE /admin/course-lessons/{lessonId}`, flipping outcome 1's `not.toContain`, as spec §11.6 announces.
  
  Then run the full `yarn test:e2e` (A3).
- [ ] **Step 2: Docs:**
  - `api-contract.md` §11: the progress route, the added fields, `LESSON_HAS_PROGRESS`, the 15 s cadence note (§9.5: web concern, `fetch keepalive`, no `sendBeacon`);
  - `api-contract.md` §12: delta row 15, including the §11.6 compile-time caveat (the 409 union widens on lesson delete);
  - `architecture.md`: the S9 row gains R7's result.
  
  Commit `docs(course): document lesson progress and resume`.

### Task 7: Verify, review, PR → Checkpoint D → merge

- [ ] **Step 1: Checks:**
  - lint, typecheck, unit, full e2e (A3), build, `format:check`;
  - the R7 file 6× (A3).
- [ ] **Step 2: Reviews:** `xuan-api-architecture-review`, then a fresh independent whole-branch review. Fix Critical and Important findings, then re-verify.
- [ ] **Step 3: PR** `feat: track lesson progress and resume`, with the §9.3 body. The Notes carry:
  - the six calls above;
  - the self-reported nature of progress (§9.5);
  - OD-11 deferred.
- [ ] **Step 4: Checkpoint D** (a separate owner packet):
  - a read-only preflight: identity, sole pending migration, full checksum, SQL comparison, before-state;
  - after approval: run → `\d+` → empty generate → the map *implemented*.
- [ ] **Step 5:** Merge with a merge commit; **keep the branch**. Course Platform V1 backend is then complete: write the consolidated completion report (owner prompt §6), then start the Blog workstream.
