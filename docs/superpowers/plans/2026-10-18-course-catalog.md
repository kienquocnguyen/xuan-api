# Course Catalog and Curriculum (course platform outcome 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The execution method is chosen by the owner when approving this plan.

**Goal:** on branch `feat/build-course-catalog`:
- a `courses` module where an admin authors a course as sections and ordered lessons (each lesson holding a Vimeo reference) and publishes it;
- a public catalog and outline that never exposes a video reference.

**Architecture:**
- A new business module `src/modules/courses/` owns `courses`, `course_sections` and `course_lessons` (I1). There are no cross-module FKs in this outcome.
- Every admin curriculum mutation runs in one transaction that first locks the course row `FOR NO KEY UPDATE` (spec §10.6, lock rule L1). That lock protects the invariant "a published course has ≥ 1 published lesson" (P1).
- Positions are unique per parent through `DEFERRABLE INITIALLY DEFERRED` constraints (S7), so a whole-curriculum reorder is a sequence of plain updates in one transaction.

**Tech Stack:** NestJS 12 ESM, TypeORM 1.1.2, PostgreSQL 18, Zod 4, Vitest + supertest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-17-course-platform-design.md` (approved 2026-10-18, revision 2). Binding for this outcome:
- §4.1–4.4, §8.2–8.3, §10 (incl. §10.6), §11.1, §11.3, §11.5 (outcome-1 codes), §11.6 (outcome-1 column), §12, §13, §14, §16 row 1, §17 (S7, S9), §18 outcome 1.

**Mode:** delegated (`development-workflow.md` §3.5, PR #12). Every task is `[delegate]`. Database mutations stay owner-only (Task 11 and the checkpoint after Task 3).

**Checkpoint M (map approval, `xuan-database-change` step 3, spec §16):** the physical map in Task 2 Step 1 is part of this plan. **Approving this plan approves that map** (column sizes, constraint names, DEFERRABLE uniques), as the services map was approved with its plan. Any change to the map after approval needs the owner again before Task 3.

## Global Constraints

- Module `src/modules/courses/`. Only it registers `Course`, `CourseSection`, `CourseLesson` with `forFeature` (I1). It imports no other business module in this outcome.
- Controllers never touch repositories or `DataSource` (I3). Controllers map with `toXDto` functions next to each DTO (D5). Entities never reach the wire (I10).
- Business failures throw `AppError` (I14). Module codes (all kind `conflict`, 409) live in `src/modules/courses/courses.errors.ts` with these exact messages:
  - `COURSE_SLUG_TAKEN`: "Another course already uses this slug."
  - `COURSE_SLUG_LOCKED`: "A published course keeps its slug."
  - `COURSE_NEEDS_PUBLISHED_LESSON`: "A published course needs at least one published lesson."
  - `LESSON_VIDEO_MISSING`: "A published lesson needs a Vimeo video."
  - `LESSON_IS_PUBLISHED`: "Unpublish the lesson before deleting it."
  - `SECTION_NOT_EMPTY`: "Move or delete the lessons in this section first."
  - `CURRICULUM_ORDER_MISMATCH`: "The order must list every section and lesson of the course exactly once."

  `COURSE_ACCESS_REQUIRED` and `LESSON_HAS_PROGRESS` are **not** part of this outcome.
- **Contract identifiers (I19, spec §11):**
  - Response DTOs: `CourseSummaryDto`, `CourseDto`, `CourseOutlineSectionDto`, `CourseOutlineLessonDto`, `AdminCourseSummaryDto`, `AdminCourseDto`, `AdminCourseSectionDto`, `AdminCourseLessonDto`.
  - Request components: `SaveCourseDto`, `SaveCourseSectionDto`, `SaveCourseLessonDto`, `CurriculumOrderDto`, `CourseIdParam`, `CourseSectionIdParam`, `CourseLessonIdParam`.
- **Routes exactly as spec §11.1 and §11.3.**
  - Admin routes are `@Roles('admin')`; public routes are `@Public()`.
  - Action routes (`publish`, `unpublish`) use `@HttpCode(200)`; deletes use `@HttpCode(204)` + `void` (I12); creates return 201.
- **No video field** (`videoId`, `privacyHash`, `vimeo*`) in any public DTO (spec §7, §14).
- Every admin curriculum mutation follows lock rule **L1** (spec §10.6):
  - one `dataSource.transaction`;
  - the first statement locks the course row with TypeORM lock mode `for_no_key_update`;
  - after it, only the transaction's `manager` (I8).
- Schema only by migration (I7); constraint names per D25; `timestamptz` (D28); `uuidv7()` PKs (D26). Writes use explicit `insert`/`update`/QueryBuilder, never `save` (D36); persisted fields are assigned one by one (I9).
- **Validation and normalization:**
  - Slugs: `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 160, never lowercased for the client (D30: reject, don't normalize).
  - Titles (course, section, lesson): `.trim().min(1).max(200)`; summary `.trim().min(1).max(500)`; both must pass `isStorableText`. The limits match the `varchar` sizes, so an over-long value is 400 `TOO_LONG`, never a Postgres `22001` (500).
  - Whitespace-only titles and summaries: `.trim()` (the posts precedent, no new rule) makes them empty, so they fail `min(1)` with 400 `TOO_SHORT`. JavaScript's `trim` removes every Unicode whitespace character, while the `ck_*_not_blank` checks (`btrim`) remove only spaces, so any value the request accepts also satisfies the database check. Tests: Task 4 schema unit tests (`"   "`, `"\t\n"`, `" 　"`) and Task 8 schema tests (a spaces-only value hits each `ck_*_not_blank`).
  - Field-error messages on the wire are the fixed per-code texts from `src/http/to-field-errors.ts` (e.g. `INVALID` → "This value is invalid."). Custom Zod messages are internal only, and exact-body tests expect the fixed text.
  - `videoId` `^[0-9]{1,20}$`; `privacyHash` `^[A-Za-z0-9]{1,64}$` and only together with `videoId`; `durationSeconds` an integer 1–86 400.
- **Pagination:** none on course lists (spec §21, services precedent). State this DEFAULT deviation in the PR Notes.
- **Owner-only (never run without explicit approval):**
  - `migration:run`, `migration:revert` (any database);
  - `yarn test:e2e`, and any e2e file that calls `resetDatabase` or writes rows;
  - anything that writes to `xuan_dev`.

  Allowed under the delegation (`development-workflow.md` §3.2 right column, §3.5 course row), because they change no database state:
  - `migration:generate`: it reads the configured database's schema (`xuan_dev` by default) and writes a migration **source file**; it applies nothing to any database (TypeORM runs the schema diff in SQL-memory mode). The owner still reviews the SQL at Checkpoint A;
  - lint, typecheck, unit tests, build;
  - the non-writing e2e file `test/openapi.e2e-spec.ts`, after `NODE_ENV=test yarn test:db-guard`.
- Never delete branches; no force-push; the PR targets `dev`; the merge waits for Task 11.

## Review Focus

1. **Text PostgreSQL can't store** (`"\u0000"` or a lone surrogate) in a title or summary must give 400, never 500. Test: Task 6 (course), Task 7 (section, lesson).
2. **An impossible public slug** (uppercase, Vietnamese diacritics, 300 characters, NUL) on `GET /courses/:slug` must give 404 without querying, never 500. Test: Task 5.
3. **A curriculum order naming a lesson or section from another course, or listing an id twice**, must give 409 `CURRICULUM_ORDER_MISMATCH`, never 500 or a partial reorder. Test: Task 4 (unit), Task 7 (e2e).
4. **Malformed Vimeo input:**
   - `privacyHash` without `videoId`, `videoId` `"12a"` or 21 digits, `durationSeconds` `0`/`-1`/`1.5`, unknown key `videoUrl` → 400 with the right field codes.
   - Clearing `videoId` on a published lesson → 409 `LESSON_VIDEO_MISSING`.

   Test: Task 7.
5. **A published course whose published lessons all sit in one section** must omit every other section from the public outline and keep curriculum order. Test: Task 5.

## File map

| File | Responsibility |
|---|---|
| `src/http/validation/storable-text.ts` (moved from `src/modules/content/body/`) | `isStorableText`, `STORABLE_TEXT_MESSAGE`, shared by content and courses |
| `src/modules/content/body/post-body.schema.ts`, `src/modules/content/dto/save-post.dto.ts` | import path update only |
| `src/modules/courses/course.entity.ts` · `course-section.entity.ts` · `course-lesson.entity.ts` | Entities, constraints, in-module FK metadata |
| `src/database/migrations/<ts>-CreateCourseCatalog.ts` | Generated migration (3 tables) |
| `src/modules/courses/courses.errors.ts` | The seven module codes |
| `src/modules/courses/course-tree.ts` | `CourseTree`, `AdminCourseListItem` (shared by the service and the mappers) |
| `src/modules/courses/curriculum-order.ts` (+ `.spec.ts`) | Pure validation of a requested order against the current curriculum |
| `src/modules/courses/dto/save-course.dto.ts` | `saveCourseSchema`, `saveCourseSectionSchema`, `saveCourseLessonSchema`, `curriculumOrderSchema`, the three id-param schemas, `COURSE_SLUG_PATTERN` |
| `src/modules/courses/dto/course.dto.ts` | Public DTOs + mappers |
| `src/modules/courses/dto/admin-course.dto.ts` | Admin DTOs + mappers |
| `src/modules/courses/courses.service.ts` | All use cases, the L1 lock helper, tree loading |
| `src/modules/courses/courses.controller.ts` | Public routes |
| `src/modules/courses/admin-courses.controller.ts` | Admin routes |
| `src/modules/courses/courses.module.ts`, `src/app.module.ts` | Wiring |
| `test/courses-schema.e2e-spec.ts` · `test/courses.e2e-spec.ts` · `test/admin-courses.e2e-spec.ts` · `test/openapi.e2e-spec.ts` | Constraints, public routes, admin routes and races, contract |
| `docs/database.md` §12 · `docs/data-model.md` · `docs/architecture.md` · `docs/api-contract.md` | Living docs |

---

### Task 1: Share the storable-text rule from `http/`

**Files:**
- Move: `src/modules/content/body/storable-text.ts` → `src/http/validation/storable-text.ts` (content unchanged)
- Modify: `src/modules/content/body/post-body.schema.ts:4`, `src/modules/content/dto/save-post.dto.ts:3` (import paths)
- Modify: `docs/architecture.md` §3 (`http/` line gains "the storable-text rule")

**Interfaces:** Produces `isStorableText(value: string): boolean` and `STORABLE_TEXT_MESSAGE` at `src/http/validation/storable-text.ts`.

- [ ] **Step 1:** `git mv` the file and update the two imports. No behavior change; the existing content tests are the proof.
- [ ] **Step 2:** Run `yarn lint && yarn typecheck && yarn test`. Expected: lint exit 0 (2 pre-existing warnings), typecheck clean, 235/235.
- [ ] **Step 3: Commit** `refactor(http): share the storable-text rule for request validation`.

### Task 2: Docs first: the physical map and the living docs

**Files:**
- Modify: `docs/database.md` §12 (status rows + three table sections, status **decided**)
- Modify: `docs/data-model.md` §2, §3 rows Course / Course section / lesson, §5 "Course format"
- Modify: `docs/architecture.md` §3 layout (add `courses/`), §13 new **AD15**, §16 two spike rows

- [ ] **Step 1: Write the §12 map** exactly as below. Status: *decided*. Settled in this plan, Task 3.

| Table | Column | Type | Null | Default | Constraint |
|---|---|---|---|---|---|
| `courses` | `id` | uuid | no | `uuidv7()` | **PK** `pk_courses` |
| | `slug` | varchar(160) | no | — | **UQ** `uq_courses_slug`; **CK** `ck_courses_slug_format` `slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'` |
| | `title` | varchar(200) | no | — | **CK** `ck_courses_title_not_blank` `btrim(title) <> ''` |
| | `summary` | varchar(500) | no | — | **CK** `ck_courses_summary_not_blank` |
| | `status` | varchar(16) | no | `'draft'` | **CK** `ck_courses_status` `status IN ('draft','published')` |
| | `published_at` | timestamptz | yes | — | **CK** `ck_courses_published_has_date` `status <> 'published' OR published_at IS NOT NULL` |
| | `created_at`, `updated_at` | timestamptz | no | `now()` | — |
| `course_sections` | `id` | uuid | no | `uuidv7()` | **PK** `pk_course_sections` |
| | `course_id` | uuid | no | — | **FK** `fk_course_sections_course_id` → `courses(id)` `ON DELETE RESTRICT` |
| | `title` | varchar(200) | no | — | **CK** `ck_course_sections_title_not_blank` |
| | `position` | integer | no | — | **CK** `ck_course_sections_position_not_negative` `position >= 0`; part of **UQ** `uq_course_sections_course_id_position` `(course_id, position)` **DEFERRABLE INITIALLY DEFERRED** (also the FK index) |
| | `created_at`, `updated_at` | timestamptz | no | `now()` | — |
| `course_lessons` | `id` | uuid | no | `uuidv7()` | **PK** `pk_course_lessons` |
| | `section_id` | uuid | no | — | **FK** `fk_course_lessons_section_id` → `course_sections(id)` `ON DELETE RESTRICT` |
| | `title` | varchar(200) | no | — | **CK** `ck_course_lessons_title_not_blank` |
| | `position` | integer | no | — | **CK** `ck_course_lessons_position_not_negative`; part of **UQ** `uq_course_lessons_section_id_position` `(section_id, position)` **DEFERRABLE INITIALLY DEFERRED** (also the FK index) |
| | `status` | varchar(16) | no | `'draft'` | **CK** `ck_course_lessons_status` |
| | `vimeo_video_id` | varchar(20) | yes | — | **CK** `ck_course_lessons_vimeo_video_id_format` `vimeo_video_id ~ '^[0-9]{1,20}$'` |
| | `vimeo_hash` | varchar(64) | yes | — | **CK** `ck_course_lessons_vimeo_hash_format` `vimeo_hash ~ '^[A-Za-z0-9]{1,64}$'`; **CK** `ck_course_lessons_hash_needs_video` `vimeo_hash IS NULL OR vimeo_video_id IS NOT NULL` |
| | `duration_seconds` | integer | yes | — | **CK** `ck_course_lessons_duration_positive` `duration_seconds > 0` |
| | (table) | | | | **CK** `ck_course_lessons_published_has_video` `status <> 'published' OR vimeo_video_id IS NOT NULL` |
| | `created_at`, `updated_at` | timestamptz | no | `now()` | — |

Index note for the map:
- There's no other index. The public list (`WHERE status = 'published' ORDER BY published_at DESC, id DESC`) runs over a handful of rows, as with services.
- TypeORM compares unique constraints **by name only**, so a later change of deferrability needs a hand-written migration. Generate won't detect it.

Write it in the existing §12 style: a Mermaid block, then a per-table column table, then the constraints table.

- [ ] **Step 2: `data-model.md`.**
  - §3 Course → "CONFIRMED. Designed 2026-10-17 (course platform spec): `courses` module".
  - Course section / lesson: LIKELY → CONFIRMED (sections contain ordered lessons; a lesson points to a Vimeo video).
  - §2 diagram: drop "(likely…)" on the two course edges.
  - §5 "Course format" → settled: self-paced video, sections and ordered lessons.

  Enrollment and entitlement stay untouched until outcome 2.
- [ ] **Step 3: `architecture.md`.**
  - §3 layout: add the `courses/` line.
  - §13 AD15:
    - Curriculum writes lock the course row `FOR NO KEY UPDATE` first, in one transaction (spec §10.6).
    - Why: P1 spans tables, so no constraint can hold it.
    - Why that lock mode: it doesn't block FK `KEY SHARE` from grant and progress inserts.
    - Revisit when an operation needs to lock two courses.
  - §16: add rows S7 and S9 with the desk-check results recorded in this plan (§"Feasibility checks" at the end), marked "runtime proof: Task 8 schema tests (commit-time violation; NO KEY UPDATE vs KEY SHARE)".
- [ ] **Step 4: Commit** `docs(course): map the course catalog schema before its migration`.

### Task 3: Spike S7: entities, the generated migration, and S9 SQL emission

**Files:**
- Create: `src/modules/courses/course.entity.ts`, `course-section.entity.ts`, `course-lesson.entity.ts`
- Create: `src/database/migrations/<ts>-CreateCourseCatalog.ts` (generated)

**Interfaces:**
- Produces:
  - `COURSE_STATUSES = ['draft','published'] as const`, `type CourseStatus`; `class Course { id, slug, title, summary, status, publishedAt: Date | null, createdAt, updatedAt }`;
  - `class CourseSection { id, courseId, title, position, createdAt, updatedAt }`;
  - `LESSON_STATUSES`, `type LessonStatus`; `class CourseLesson { id, sectionId, title, position, status, vimeoVideoId: string | null, vimeoHash: string | null, durationSeconds: number | null, createdAt, updatedAt }`.
- Column names exactly per the Task 2 map.

- [ ] **Step 1: Write the three entities** in the `post.entity.ts` style.
  - Every constraint and the PK are named in decorators: `primaryKeyConstraintName`, `@Unique(name, cols, { deferrable: 'INITIALLY DEFERRED' })`, `@Check(name, expr)`.
  - In-module FKs: `@ForeignKey(() => Course, { name: 'fk_course_sections_course_id', onDelete: 'RESTRICT' })` and `@ForeignKey(() => CourseSection, { name: 'fk_course_lessons_section_id', onDelete: 'RESTRICT' })`. Use FK metadata with **no relation properties**: queries join explicitly (D37, D38).
- [ ] **Step 2: Register the entities** in a minimal `CoursesModule` (`TypeOrmModule.forFeature([Course, CourseSection, CourseLesson])`, no controllers yet) and in `AppModule`.
- [ ] **Step 3: Generate.** Run `yarn migration:generate src/database/migrations/CreateCourseCatalog`. It compares the entities with `xuan_dev`'s current schema and writes the difference as a new migration source file; it doesn't apply the migration or write to the database. Expected: one new file.
- [ ] **Step 4: Read the SQL against the Task 2 map. Spike S7 check:**
  - every name above, with no `PK_`/`UQ_`/`FK_` hashes;
  - `TIMESTAMP WITH TIME ZONE`, `DEFAULT uuidv7()`;
  - both uniques render as `UNIQUE ("course_id", "position") DEFERRABLE INITIALLY DEFERRED` and `UNIQUE ("section_id", "position") DEFERRABLE INITIALLY DEFERRED`;
  - both FKs are `ON DELETE RESTRICT`;
  - nothing touches other tables;
  - `down()` drops FKs, then tables.

  **Stop rule:** if a unique lacks `DEFERRABLE`, edit nothing by hand. Switch to the spec's fallback (§10.3: plain uniques; the reorder in Task 7 offsets positions by `+ 1_000_000` first, then writes final values, in the same transaction), record it in AD15/§16, regenerate, and continue.
- [ ] **Step 5: S9 SQL emission (reads only).** Print the lock SQL through the CLI data source:
  ```
  node --no-warnings --loader ts-node/esm -e "const {default: ds} = await import('./src/database/data-source.ts'); await ds.initialize(); console.log(ds.getRepository('Course').createQueryBuilder('c').where('c.id = :id', { id: 'x' }).setLock('for_no_key_update').getQuery()); await ds.destroy();"
  ```
  Expected: the query ends in `FOR NO KEY UPDATE`.
- [ ] **Step 6: Commit** `feat(course): add the course catalog entities and their migration`.

**Checkpoint A, owner approval, requested immediately after Task 3:** request it with the exact commands, target, state change, guard and rollback (Task 11 items 1–3). The first e2e tests are in Task 5, and they need the tables on `xuan_test` plus approval to run e2e files repeatedly.
- **Until it's approved, only Task 4 proceeds**: pure, unit-tested code (curriculum order, schemas, DTOs).
- Tasks 5–8 don't start, so no behavior is written before its e2e test has been seen failing (DoD §13; `xuan-api-feature` "end at RED").

### Task 4: Errors, request schemas, curriculum-order rule, response DTOs

**Files:**
- Create: `src/modules/courses/courses.errors.ts`, `course-tree.ts`, `curriculum-order.ts`, `curriculum-order.spec.ts`
- Create: `src/modules/courses/dto/save-course.dto.ts`, `dto/course.dto.ts`, `dto/admin-course.dto.ts`

**Interfaces:**
- `coursesErrors` with the seven definitions (Global Constraints, exact messages).
- Request schemas (Zod `z.strictObject`, `.meta({ id })`):
  - `saveCourseSchema` → `SaveCourseDto` `{ slug, title, summary }`, type `SaveCourseInput`;
  - `saveCourseSectionSchema` → `SaveCourseSectionDto` `{ title }`;
  - `saveCourseLessonSchema` → `SaveCourseLessonDto` `{ title, videoId?, privacyHash?, durationSeconds? }`. Omitted optionals become `null` (full replacement). A `privacyHash` without `videoId` is a field error at path `privacyHash`, code `INVALID`. The wire shows `{ field: 'privacyHash', code: 'INVALID', message: 'This value is invalid.' }`;
  - `curriculumOrderSchema` → `CurriculumOrderDto` `{ sections: [{ id: uuid, lessonIds: uuid[] }] }` (max 200 sections, max 500 lessons per section);
  - `courseIdParamSchema` `{ courseId }` → `CourseIdParam`, `courseSectionIdParamSchema` `{ sectionId }` → `CourseSectionIdParam`, `courseLessonIdParamSchema` `{ lessonId }` → `CourseLessonIdParam`;
  - export `COURSE_SLUG_PATTERN`;
  - inferred types `SaveCourseInput`, `SaveCourseSectionInput`, `SaveCourseLessonInput` (`videoId`, `privacyHash`, `durationSeconds` are `… | null` after the transform), `CurriculumOrderInput`.
- `type CurriculumSnapshot = { sectionIds: readonly string[]; lessonIds: readonly string[] }` (all of the course's, any order).
- `isCompleteCurriculumOrder(current: CurriculumSnapshot, requested: CurriculumOrderInput): boolean`.
- Service-facing tree types (used by the Task 5 service and by the mappers):
  `type CourseTree = Readonly<{ course: Course; sections: ReadonlyArray<Readonly<{ section: CourseSection; lessons: readonly CourseLesson[] }>> }>`;
  `type AdminCourseListItem = Readonly<{ course: Course; lessonCount: number; publishedLessonCount: number }>`.
  Define both in `src/modules/courses/course-tree.ts` so the DTO files and the service share them without a cycle.
- **DTO classes** exactly per spec §11.1 and §11.3 field lists:
  - instants as ISO strings;
  - `durationSeconds: number | null`;
  - in `AdminCourseLessonDto`: `videoId: string | null`, `privacyHash: string | null`.
- **Mappers:**
  - `toCourseSummaryDto(course)`, `toCourseDto(tree)`;
  - `toAdminCourseSummaryDto(item)`, `toAdminCourseDto(tree)`. Counts are computed from the tree for the detail and taken from the item for the list.

- [ ] **Step 1: Write `curriculum-order.spec.ts`** (table-driven). Cases:
  - exact match in a different order → `true`;
  - a lesson moved to another listed section → `true`;
  - a missing section, a missing lesson, a duplicate lesson id, a duplicate section id, a lesson id not in `current`, a section id not in `current` → each `false`;
  - an empty course `{ sectionIds: [], lessonIds: [] }` with `{ sections: [] }` → `true`.
- [ ] **Step 2:** Run `npx vitest run src/modules/courses/curriculum-order.spec.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `isCompleteCurriculumOrder`.** Approach: build sets, reject on any duplicate, then require set equality for sections and lessons.
- [ ] **Step 4:** Run the spec. Expected: PASS.
- [ ] **Step 4b: Write `dto/save-course.dto.spec.ts`** (unit, through `toFieldErrors`): whitespace-only `title`/`summary` (`"   "`, `"\t\n"`, `" 　"`) and whitespace-only section and lesson titles → `TOO_SHORT` at that field; surrounding spaces are trimmed on success; `privacyHash` without `videoId` → `INVALID` at `privacyHash`; omitted optionals → `null`. Run it: FAIL (module missing).
- [ ] **Step 5: Write the schemas, errors, tree types, DTO classes and mappers.** Re-run the Step 4b spec: PASS.
  - Each DTO property gets `@ApiProperty` with `format: 'uuid'`/`'date-time'` and `nullable` where the type allows `null` (D17).
  - Lists use `type: [X]`.
- [ ] **Step 6:** Run `yarn typecheck && yarn lint`. Expected: clean.
- [ ] **Step 7: Commit** `feat(course): add course errors, request schemas and response DTOs`.

### Task 5: Public catalog and outline

**Files:**
- Create: `src/modules/courses/courses.service.ts` (read side now; Tasks 6–7 add writes), `courses.controller.ts`
- Modify: `src/modules/courses/courses.module.ts` (controller + provider)
- Test: `test/courses.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 3 entities and Task 4 types and mappers.
- Produces (on `CoursesService`):
  - `listPublished(): Promise<Course[]>`: newest `publishedAt` first, tie `id DESC`.
  - `getPublishedOutline(slug: string): Promise<CourseTree>`: published course; only published lessons; sections without one omitted; curriculum order (`position ASC` for sections, then lessons).
  - Private `loadTree(manager: EntityManager, courseId: string, scope: 'all' | 'published'): Promise<CourseTree>`: two explicit queries, sections then lessons `WHERE section_id IN (…)`, no N+1 (D38).

- [ ] **Step 1: Write the e2e tests (exact bodies, `toEqual`).** Fixtures insert rows with raw SQL through `DataSource`, independent of the admin API.
  - `GET /courses` → only published, newest first, `CourseSummaryDto` keys exactly `{ id, slug, title, summary, publishedAt }`.
  - `GET /courses/:slug` → exact `CourseDto`:
    - draft lessons absent;
    - a section with only drafts absent (Review Focus 5);
    - `durationSeconds` null or a number;
    - **the serialized body contains none of `videoId`, `privacyHash`, `vimeo`** (assert on `JSON.stringify(res.body)`).
  - A draft course, an unknown slug, and the impossible slugs `'Khoa-Hoc'`, `'khóa-học'`, `'a'.repeat(300)`, `'%00'` → 404 `NOT_FOUND` exact envelope (Review Focus 2).
  - Both routes work without a session.
- [ ] **Step 2: Run (Checkpoint A approved).** `NODE_ENV=test yarn test:db-guard && NODE_ENV=test npx vitest run --config vitest.config.e2e.ts test/courses.e2e-spec.ts`. Expected: FAIL (404 for unknown route).
- [ ] **Step 3: Implement** the two service methods and `CoursesController` (`@Public()`, `@ApiTags('courses')`, `@Controller('courses')`).
  - `GET /courses`: `@ApiEnvelopeResponse(CourseSummaryDto, { isArray: true })`, following `services.controller.ts:17`. `GET /admin/courses` does the same with `AdminCourseSummaryDto`.
  - `GET /courses/:slug`: `@ApiEnvelopeResponse(CourseDto)`, `@ApiErrorResponses(NOT_FOUND)`.
  - The slug is an opaque key (D7 deviation, as posts). `getPublishedOutline` returns 404 without querying when `slug.length > 160 || !COURSE_SLUG_PATTERN.test(slug)`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(course): add the public course catalog and outline`.

### Task 6: Admin course lifecycle and the L1 lock

**Files:**
- Modify: `src/modules/courses/courses.service.ts`
- Create: `src/modules/courses/admin-courses.controller.ts`
- Test: `test/admin-courses.e2e-spec.ts` (describe blocks `courses`, `authorization`)

**Interfaces:**
- Produces (on `CoursesService`):
  - `listForAdmin(): Promise<AdminCourseListItem[]>`: newest `updatedAt` first, tie `id DESC`; counts by one grouped query.
  - `getForAdmin(courseId: string): Promise<CourseTree>`.
  - `create(input: SaveCourseInput): Promise<CourseTree>`.
  - `update(courseId: string, input: SaveCourseInput): Promise<CourseTree>`.
  - `publish(courseId: string): Promise<CourseTree>`.
  - `unpublish(courseId: string): Promise<CourseTree>`.
  - Private `withCourseLock<T>(courseId: string, work: (manager: EntityManager, course: Course) => Promise<T>): Promise<T>`. One transaction; the first statement is `manager.findOne(Course, { where: { id }, lock: { mode: 'for_no_key_update' } })`; missing → `AppError(NOT_FOUND)`. Every later task's mutation goes through it.
  - Private `countPublishedLessons(manager, courseId): Promise<number>`: join lessons → sections, `status = 'published'`.

**Rules (spec §10.1, §10.2):**
- **create:** inserts a draft. A violation of `uq_courses_slug` → `COURSE_SLUG_TAKEN` (D11).
- **update:** under L1. If `publishedAt !== null` and the slug changes → `COURSE_SLUG_LOCKED`. A unique violation → `COURSE_SLUG_TAKEN`.
- **publish:** under L1. Idempotent with no write when already published. `countPublishedLessons < 1` → `COURSE_NEEDS_PUBLISHED_LESSON`. Otherwise `status = 'published'`, `published_at = COALESCE(published_at, now())`.
- **unpublish:** under L1. Idempotent. Sets `status = 'draft'`; `published_at` stays, so the slug stays locked.
- Every mutation returns `getForAdmin(courseId)` loaded **after** commit.

- [ ] **Step 1: Write the e2e tests:**
  - create → 201 exact `AdminCourseDto` (draft, `sections: []`, counts 0, `publishedAt: null`);
  - duplicate slug → 409 `COURSE_SLUG_TAKEN`;
  - list order and counts;
  - get unknown → 404; malformed `courseId` → 400 `VALIDATION_FAILED` field `courseId` code `INVALID_FORMAT`;
  - update title/summary;
  - publish without a published lesson → 409 `COURSE_NEEDS_PUBLISHED_LESSON`;
  - publish with one (fixture via raw SQL) → 200, `publishedAt` set;
  - publish again → same `publishedAt`;
  - unpublish then republish keeps the first `publishedAt`;
  - slug change after first publication (also while unpublished) → 409 `COURSE_SLUG_LOCKED`;
  - title `"\u0000x"` → 400 (Review Focus 1);
  - a 201-character title and a 501-character summary → 400 `TOO_LONG`;
  - slug `'Khoa-Hoc'` → 400 `INVALID_FORMAT`;
  - unknown key → 400 `UNKNOWN_FIELD`;
  - **authorization:** no session → 401; `user` and `editor` → 403 on every admin route; missing `X-Requested-With` on a write → 403 (exact envelopes).
- [ ] **Step 2: Run.** Expected: FAIL (route missing).
- [ ] **Step 3: Implement** the service methods and the first six routes of spec §11.3.
  - Controller `@Roles('admin')`, `@ApiTags('admin')`, `@Controller('admin')`. Paths `courses`, `courses/:courseId`, `courses/:courseId/publish`, `courses/:courseId/unpublish`.
  - Decorators per Global Constraints. `@ApiErrorResponses` lists exactly the codes in spec §11.3 plus `VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`.
  - Every route with a path id uses `@Param({ schema })` + `@ApiSchemaParameters('path', schema)`, as `admin-posts.controller.ts` does.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(course): add admin course authoring and publication`.

### Task 7: Sections, lessons, ordering and the publication races

**Files:**
- Modify: `src/modules/courses/courses.service.ts`, `admin-courses.controller.ts`
- Test: `test/admin-courses.e2e-spec.ts` (describe blocks `sections`, `lessons`, `curriculum order`, `concurrency`)

**Interfaces:**
- Produces (on `CoursesService`, all mutations through `withCourseLock`):
  - `addSection(courseId: string, input: SaveCourseSectionInput): Promise<CourseTree>`: appends at `COALESCE(MAX(position), -1) + 1`.
  - `renameSection(sectionId: string, input: SaveCourseSectionInput): Promise<CourseTree>`.
  - `deleteSection(sectionId: string): Promise<void>`: any lesson in it → `SECTION_NOT_EMPTY`.
  - `addLesson(sectionId: string, input: SaveCourseLessonInput): Promise<CourseTree>`: a draft, appended in its section.
  - `updateLesson(lessonId: string, input: SaveCourseLessonInput): Promise<CourseTree>`: full replacement of title, video id, hash and duration. A published lesson with `videoId` null → `LESSON_VIDEO_MISSING`.
  - `publishLesson(lessonId: string): Promise<CourseTree>`: idempotent; no video id → `LESSON_VIDEO_MISSING`.
  - `unpublishLesson(lessonId: string): Promise<CourseTree>`: idempotent. If the course is published and this is its last published lesson → `COURSE_NEEDS_PUBLISHED_LESSON`.
  - `deleteLesson(lessonId: string): Promise<void>`: published → `LESSON_IS_PUBLISHED`.
  - `reorder(courseId: string, input: CurriculumOrderInput): Promise<CourseTree>`: snapshot the course's ids under the lock; `isCompleteCurriculumOrder` false → `CURRICULUM_ORDER_MISMATCH`. Otherwise set each section's `position` to its index, and each lesson's `section_id` and `position` to its section and index, all through `manager` (deferred uniques make intermediate states legal; S7).
  - Private `courseIdOfSection(sectionId): Promise<string>` and `courseIdOfLesson(lessonId): Promise<string>` (plain reads; missing → `NOT_FOUND`). `section.course_id` is immutable, so the id stays valid. Inside the lock, re-read the section or lesson with `manager` (`WHERE id = :id`, joined to the locked course id); gone → `NOT_FOUND`.

- [ ] **Step 1: Write the e2e tests:**
  - **sections:** create (appended, 201); rename; delete empty (204); delete non-empty → 409 `SECTION_NOT_EMPTY`; unknown → 404.
  - **lessons:**
    - create a draft with and without video;
    - update full replacement (omitted optionals → null);
    - publish without video → 409 `LESSON_VIDEO_MISSING`;
    - publish, then `PUT` with no `videoId` → 409 `LESSON_VIDEO_MISSING`;
    - change the video id of a published lesson → 200 (references stay editable, spec §8.2);
    - unpublish the last published lesson of a published course → 409 `COURSE_NEEDS_PUBLISHED_LESSON`, while of a draft course → 200;
    - delete a published lesson → 409 `LESSON_IS_PUBLISHED`; delete a draft → 204;
    - Review Focus 4 validation cases (each with exact `details.fields`, fixed per-code messages); a NUL in a section or lesson title → 400 (Review Focus 1); a 201-character section or lesson title → 400 `TOO_LONG`.
  - **curriculum order:**
    - reorder sections; reorder lessons; move a lesson across sections. Lesson ids are unchanged and the `AdminCourseDto` order is exact;
    - mismatch cases from Review Focus 3 → 409 `CURRICULUM_ORDER_MISMATCH`, with nothing changed (re-read and compare).
  - **concurrency:** spec §18 R1–R4, each `for (let trial = 0; trial < 15; trial++)` with `Promise.all`, in the blog's style (`test/admin-posts.e2e-spec.ts:364`). Assertions:
    - **R1** draft course with one published lesson: `publish` ∥ `unpublishLesson`. Both serial orders end in exactly one 409: publish-first refuses the unpublish, and unpublish-first refuses the publish. Assert exactly one 409 and one 200, never 500, and afterwards, if the course is published, `publishedLessonCount ≥ 1`.
    - **R2** published course with two published lessons, both unpublished concurrently: exactly one 200 and one 409; final `publishedLessonCount === 1`.
    - **R3** empty section S, lesson L in section T: `DELETE` S ∥ reorder moving L into S. Outcomes are {204, 409 `CURRICULUM_ORDER_MISMATCH`} or {409 `SECTION_NOT_EMPTY`, 200}; never 500.
    - **R4** `addLesson` ∥ reorder of the old set: either the reorder is 200 and the new lesson is last in its section, or 409 mismatch. Positions within every section are always `0..n-1` (query the table).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the methods and the remaining seven routes of spec §11.3 (`courses/:courseId/sections`, `course-sections/:sectionId`, `course-sections/:sectionId/lessons`, `course-lessons/:lessonId`, its `publish`/`unpublish`, `courses/:courseId/curriculum-order`). Deletes are `@HttpCode(204)` + `@ApiNoContentResponse()`.
- [ ] **Step 4: Run.** Expected: PASS. If R1–R4 flake, the lock isn't the first statement or a write escapes `manager` (I8); fix the code, never the assertions.
- [ ] **Step 5: Commit** `feat(course): add sections, lessons and curriculum ordering`.

### Task 8: Schema invariants, the OpenAPI contract and the contract docs

**Files:**
- Create: `test/courses-schema.e2e-spec.ts`
- Modify: `test/openapi.e2e-spec.ts`
- Modify: `docs/api-contract.md` §11 (rows for all §11.1 and §11.3 routes, the DTO line, the error codes), §12 (new delta row "13 | endpoint notes | Courses: …")

- [ ] **Step 1: Schema tests,** in the `content-posts-schema.e2e-spec.ts` style (raw SQL, `constraintOf`). Each statement must fail on exactly:
  - `uq_courses_slug`, `ck_courses_slug_format`, `ck_courses_published_has_date`;
  - `ck_courses_title_not_blank`, `ck_courses_summary_not_blank`, `ck_course_sections_title_not_blank`, `ck_course_lessons_title_not_blank` (a spaces-only value);
  - `ck_course_lessons_published_has_video`, `ck_course_lessons_hash_needs_video`, `ck_course_lessons_vimeo_video_id_format`, `ck_course_lessons_duration_positive`;
  - `fk_course_lessons_section_id` (delete a section with a lesson);
  - `uq_course_lessons_section_id_position` **at COMMIT**: a transaction inserting two lessons with the same position fails on commit, not on insert. This is the runtime proof of S7.
  - Plus one positive case: inside one transaction, swap two lesson positions → commit succeeds.
  - **S9 runtime proof** (deterministic, two raw connections from `db.createQueryRunner()`):
    1. A runs `BEGIN; SELECT id FROM courses WHERE id = $1 FOR NO KEY UPDATE`.
    2. B runs `SET lock_timeout = '2s'` and inserts a `course_sections` row for that course. The insert **succeeds**: the FK's `KEY SHARE` doesn't conflict with `NO KEY UPDATE`.
    3. Contrast: the same with A using `FOR UPDATE`, where B fails with SQLSTATE `55P03`.
    4. A rolls back in both cases.
  - **If Task 3's stop rule switched to the fallback** (plain uniques): replace the commit-time and swap cases with an immediate-violation case and an "offset then final" reorder case, and change the map's DEFERRABLE wording.
- [ ] **Step 2: OpenAPI tests** (non-mutating, runnable without Checkpoint A). First update the existing harness in `test/openapi.e2e-spec.ts`:
  - add `'get /courses'` and `'get /courses/{slug}'` to the `publicOperations` set (line ~159), or the "every non-public operation documents 401" test fails;
  - widen the `codes` and `params` helpers' `method` type to `'get' | 'put' | 'post' | 'delete'`.

  Then the new assertions:
  - components contain every request and response identifier from Global Constraints;
  - `propsOf('CourseOutlineLessonDto')` equals `['durationSeconds','id','title']`;
  - `propsOf('AdminCourseLessonDto')` includes `videoId` and `privacyHash`;
  - **no public component** (`CourseSummaryDto`, `CourseDto`, `CourseOutlineSectionDto`, `CourseOutlineLessonDto`) has a property matching `/video|vimeo|hash/i`;
  - each route documents exactly its spec §11 codes, e.g. `codes('/admin/course-lessons/{lessonId}', 'delete')` contains `LESSON_IS_PUBLISHED` and not `LESSON_HAS_PROGRESS`.
- [ ] **Step 3: Run** both files. Expected: PASS.
- [ ] **Step 4: Update `api-contract.md`** §11 and §12 from the implemented behavior. Add an xuan-web note: the public outline 404s until publication; "Chưa mở đăng ký" stays a web decision (spec §10.5, §15).
- [ ] **Step 5: Commit** `test(course): pin the course schema and contract` and `docs(course): document the course catalog contract`.

### Task 9: Map status, layout and spike records

- [ ] Update `database.md` §12: status stays *decided* until Task 11, where it becomes *implemented* with the observed runs.
- [ ] Update `architecture.md` §16 S7/S9 rows with the observed results (Task 3 SQL, Task 8 commit-time violation, Task 7 races).
- [ ] **Commit** `docs(course): record the S7 and S9 results`.

### Task 10: Verification, reviews and the PR

- [ ] `superpowers:verification-before-completion`: fresh `yarn lint`, `yarn typecheck`, `yarn test`, `yarn build`, `npx prettier --check` on changed `src/` and `test/` files, and the e2e files (Checkpoint A).
- [ ] `xuan-api-architecture-review` over `dev...HEAD`. Run the skill's searches; the completeness table requires routes + tests + decorators and migration + §12 map.
- [ ] Independent whole-branch review (fresh reviewer, most capable model). It must specifically check:
  - every mutation goes through `withCourseLock` with the lock first;
  - no public DTO path carries a video field;
  - `@ApiErrorResponses` codes match runtime throws;
  - lesson ids never change on reorder.

  Fix findings within scope.
- [ ] Push; open the PR to `dev` with the §9.3 template.
  - **Database** section: only observed steps.
  - **API Contract** section.
  - **Security:** admin-only, no video refs public.
  - **Notes:** the D7 slug deviation, unpaginated lists (DEFAULT deviation), `FOR NO KEY UPDATE` vs the blog's `FOR UPDATE`, the S7 result, and the storable-text move.
- [ ] **Do not merge** until Task 11 is done. Never delete the branch.

### Task 11: Owner-approved database steps

Requested with target, command, state change, guard evidence and rollback for each.
- Items 1–3 form **Checkpoint A** (after Task 3).
- Item 4 comes after Task 10.
- Item 5 is optional.

1. **`xuan_test` run.** `NODE_ENV=test yarn test:db-guard && NODE_ENV=test yarn migration:run`. Creates the three empty tables. Rollback: `NODE_ENV=test yarn migration:revert`. Guard: the preflight names `xuan_test`; `SELECT id, name FROM migrations` before and after.
2. **`xuan_test` round trip.**
   - Inspect with `docker compose exec -T db psql -U xuan_app -d xuan_test -c '\d+ courses'` (and the other two tables), compared against the Task 2 map, `DEFERRABLE` included.
   - Then `migration:revert`, `\dt` (tables gone), `migration:run`.
   - Then `NODE_ENV=test yarn migration:generate src/database/migrations/Probe`, which must report **no changes** (S7 round trip).
3. **`xuan_test` e2e runs during Tasks 4–10.**
   - Single e2e files and the full `yarn test:e2e`, repeatedly.
   - Every file truncates all application tables between tests, after the I21 guard.
4. **`xuan_dev` run.** `yarn migration:run`. Creates the three empty tables; users, posts and services are untouched. Rollback: `yarn migration:revert`. Then `\d+` and an empty second generate on `xuan_dev`.
5. **Optional, separate:** create the real course `workflow-edit-video-youtube` on `xuan_dev` through the admin API (writes `xuan_dev` rows). Only if the owner asks; no seed script.

After item 4:
- `database.md` §12 → *implemented* with the observed runs;
- tick only observed PR boxes;
- merge per the delegation conditions (merge commit; branch kept locally and remotely).

---

## Feasibility checks already done (non-mutating, 2026-10-18)

| Check | Evidence | Result |
|---|---|---|
| TypeORM emits deferrable uniques (S7) | `node_modules/typeorm/driver/postgres/PostgresQueryRunner.js:2522`: `if (unique.deferrable) constraint += " DEFERRABLE …"`; `decorator/Unique.js:47` passes `options.deferrable` | Supported in `CREATE TABLE` |
| Second generate stays empty with a deferrable unique (S7) | `RdbmsSchemaBuilder.js:354,727` match uniques **by name only**; the constraint query (`PostgresQueryRunner.js:2063`) doesn't read `condeferrable` | Expected empty. Consequence: deferrability changes are invisible to generate (noted in the map) |
| `for_no_key_update` emits SQL (S9) | `SelectQueryBuilder.js:1651` returns `" FOR NO KEY UPDATE"` | Supported |
| Does a deferrable unique make `section_id`/`position` "key" columns (S9)? | PostgreSQL 18 `relcache.c:5418`: `isKey = indisunique && no expressions && no predicate`; deferrability isn't considered | **Yes.** Lesson moves and reorders take `FOR UPDATE` on those lesson rows. In outcome 1 this affects no concurrent writer (only curriculum transactions touch lessons, and they're serialized by L1). In outcome 3, progress upserts on a moved lesson wait for the reorder; that's a wait, not a deadlock (spec §10.6). Runtime confirmation belongs to outcome 3's R7 |
| A course slug change takes `FOR UPDATE` on the course row | Same rule (`uq_courses_slug`) | Affects outcome 2 grant inserts only (wait, not deadlock). Nothing to do in outcome 1 |
