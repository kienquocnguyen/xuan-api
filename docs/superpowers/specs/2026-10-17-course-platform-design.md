# Course platform (non-payment V1): design

**Status:** **APPROVED by the owner (2026-10-18), revision 2**, as the product and architecture baseline for the non-payment course platform V1.
- OD-1…OD-10 are approved as recorded in §19 (tag **[Approved]**). OD-11 stays **deferred**: V1 never resets progress because a Vimeo video changed.
- Every [Proposed] item is approved as part of the spec, including the §10.6 concurrency rule and the §11 identifiers. The S7, S8 and S9 mechanisms are approved **conditionally on their spikes**: if a spike fails, the stated fallback is evaluated against the same invariants, and work stops at that boundary if the fallback fails too.
- Only outcome 1 is authorized for planning (2026-10-18). Outcomes 2 and 3 get their own plans once the previous outcome merged.
- Not authorized by this approval: payments, orders, checkout, fake payment events, any Vimeo API integration, speculative modules, frontend changes, unrelated maintenance.
- Delegation recorded in `development-workflow.md` §3.5 (PR #12). Database operations keep per-operation owner approval.
- Committed on `feat/build-course-catalog` (outcome 1). Frozen once merged; the living docs carry the result.
- Research input: `discovery/2026-10-17-course-platform-discovery.md` (local-only, not a specification).

**Decision tags:**

| Tag | Meaning |
|---|---|
| **[Owner]** | Confirmed by the owner (Decisions A and B, 2026-10-17) |
| **[Docs]** | Already settled in canonical docs (`docs/*.md`, rule IDs) |
| **[Impl]** | Verified in the current implementation (`dev` @ `1eb246b`) |
| **[Vimeo]** | Provider fact from Vimeo's own documentation |
| **[Approved]** | The owner's answer to an open decision (OD-1…OD-10), proposed 2026-10-17 and approved with this spec on 2026-10-18 |
| **[Proposed]** | Claude's proposal. Needs explicit owner approval |
| **[Open]** | Unresolved. The design is kept independent of it, or it blocks a named step |

**Revision 2 changes** (owner review 2026-10-17):
- §10.6 new: curriculum concurrency (lock rule, lock order, deadlocks, invariant proof).
- §7.1 new: revocation consistency.
- §8.4: revocation vs references already delivered.
- §9.6 new: video replacement and saved progress.
- §11: learner list route renamed `GET /me/courses` → `GET /learn/courses`; learner DTOs split so outcome 3 only adds fields.
- §11.6 new: contract by outcome.
- §16: compatibility.
- §18: race tests.
- §19: the owner's answers (approved 2026-10-18).
- §21 new: architecture consistency review.
- After an independent review of revision 2:
  - §5.3: the grant became an `ON CONFLICT` upsert on the partial index, fixing a grant ∥ revoke race.
  - §10.6: corrected which updates take `FOR UPDATE`.
  - §7.1: the window is no longer claimed to be milliseconds; added `no-store`.
  - §11: D9 wording; the error-enum caveat.
  - Tests R5b, R7.

## 1. Outcome and scope

XuanCreative creates and manages its first self-paced video course. An admin organizes it into sections and ordered lessons, each pointing to a Vimeo video, and publishes it. Visitors see the published outline. An admin grants lifetime access to existing users. Students with active access open lessons, watch them through the Vimeo player in `xuan-web`, and resume where they stopped. A later orders/VNPAY slice grants access from verified payments without reworking this design.

**In scope:**
- one `courses` module owning courses, sections, lessons, access grants and lesson progress;
- admin curriculum management and publication;
- the public catalog and outline;
- admin-granted access and revocation;
- gated playback references;
- progress, completion and resume;
- migrations, docs, OpenAPI and tests.

**Out of scope:**
- prices, money, orders, payments, VNPAY;
- purchase availability or checkout states;
- free preview playback;
- invitations to unregistered emails;
- access expiry or subscriptions;
- certificates, quizzes, comments, downloads, attachments;
- course deletion;
- rich marketing copy in the API;
- multilingual courses;
- any Vimeo API call, token, gateway or DRM;
- progress resets;
- the `xuan-web` pages and player (their own outcome in `xuan-web`).

## 2. Requirements and decisions

### 2.1 Confirmed by the owner

| # | Requirement | Tag |
|---|---|---|
| CP1 | **Lifetime access.** Valid access never expires automatically. No expiry date, subscriptions or recurring payments | [Owner] A |
| CP2 | Access can be **explicitly revoked**. Revocation never deletes learning progress; if access is restored, previous progress is available again. Lifetime ≠ irrevocable | [Owner] A |
| CP3 | **Admins may grant access manually before VNPAY.** The recipient must already be a user, which means they signed in with Google at least once (no other path creates `users` rows today, [Impl]). A grant creates no order or payment record | [Owner] B |
| CP4 | Grants and revocations are **admin-only**. A student can't grant access to themselves | [Owner] B |
| CP5 | Repeating a grant **never creates duplicate active access** | [Owner] B |
| CP6 | Revoked students **can't retrieve protected playback references** | [Owner] B |
| CP7 | Granting to a never-registered email is out of scope for V1 | [Owner] B |

### 2.2 The owner's first provisional directions, reviewed

| # | Provisional direction | Review | Result |
|---|---|---|---|
| CP8 | First course is `workflow-edit-video-youtube` | Agree. It matches the public route and the old site's links. The slug is created as data by the admin, not hard-coded | [Proposed] as is |
| CP9 | One access row per user/course, provable to evolve | **Challenged** (§5.1): one mutable row can't keep a still-valid complimentary grant when a purchase is refunded. Replaced by one row **per grant**, which the owner approved (OD-1) | [Approved] OD-1 |
| CP10 | Sections containing ordered lessons | Agree. Every lesson belongs to a section; a flat course is a single section | [Proposed] as is |
| CP11 | No free preview playback in V1 | Agree. It removes the only case where a video reference would be public. No `is_preview` column | [Proposed] as is |
| CP12 | Visitors see published section and lesson titles and their order | Agree, plus a lesson's duration when the admin entered it | [Proposed] |
| CP13 | Completion on Vimeo `ended`, sticky | Agree. Completion is self-reported learning state, never proof of viewing (§9.5) | [Proposed] as is |
| CP14 | Admin-only course and curriculum management | Agree. Editors keep blog authoring only | [Proposed] as is |
| CP15 | Editorial copy stays in `xuan-web`; the API owns identity, publication, curriculum | Agree. The API course has `title` and a short `summary`; everything else stays on the web, keyed by slug | [Proposed] as is |
| CP16 | Lessons with progress can't be deleted; unpublish instead | Agree, narrowed: only **draft** lessons **without progress** can be deleted (§10.4) | [Proposed] |
| CP17 | Delegated implementation after approval | See OD-8 (§19) for the minimal record | [Approved] OD-8 |
| CP18 | Accept Vimeo's practical limits; no DRM assumptions | Agree. §8.4 and §14 state exactly what's protected and what isn't | [Proposed] as is |

## 3. Module boundaries

**Proposed:** one module, `src/modules/courses/` ([Docs] architecture §5 already names `admin-courses.controller.ts` there).

```
modules/courses/
  courses.module.ts                 forFeature([Course, CourseSection, CourseLesson, CourseAccessGrant, LessonProgress]) (I1); imports UsersModule
  course.entity.ts · course-section.entity.ts · course-lesson.entity.ts
  course-access-grant.entity.ts · lesson-progress.entity.ts
  courses.errors.ts
  courses.service.ts                catalog + curriculum + publication (public and admin use cases)
  course-access.service.ts          grants, revocation, "has active access?"
  learning.service.ts               learner curriculum, playback, progress, resume
  courses.controller.ts             public    /courses
  admin-courses.controller.ts       admin     /admin/courses, /admin/course-sections, /admin/course-lessons
  admin-course-access.controller.ts admin     /admin/courses/:courseId/access…
  learning.controller.ts            session   /learn/courses…
  dto/
```

File names are indicative. The three services arrive with the three outcomes (§16), and each is one cohesive set of use cases. This isn't internal layering (C4). Each entity arrives with the outcome that creates its table.

**Why one module, not `courses` + `learning` + `entitlements`:**
- Progress has foreign keys to lessons, and grants have foreign keys to courses. Separate modules would immediately need cross-module FKs inside the course domain, plus exported "does this lesson exist / is it in this course / does this user have access" providers.
- The web's feature split is a UI concern ([Impl] xuan-web `architecture.md`), not a reason to split tables.

**Signal for splitting later:** a second product with access rules, or orders needing more than one exported grant provider.

**Dependencies:**
- `UsersModule` for `UserProfilesReader.findPublicProfiles` ([Impl] AD14), used for the admin grant list.
- FKs to `users` declared with `@ForeignKey('User', …)` and no relation ([Docs] AD14).
- New `database/` plumbing: a factual `isForeignKeyViolation(error, constraint)` helper beside `isUniqueViolation` ([Impl] `src/database/postgres-errors.ts` has only the latter; D11).
- No other module imports `courses` in V1.

## 4. Course, section and lesson data model [Proposed]

Physical names follow `database.md` §2. Final column sizes are settled at the plan's map checkpoint (`xuan-database-change` steps 2–3).

### 4.1 `courses`

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | PK `pk_courses`, `uuidv7()` |
| `slug` | varchar(160) | UQ `uq_courses_slug`; CK `ck_courses_slug_format` (lowercase kebab, D30); **locked after first publication** (service, like posts B17) |
| `title` | varchar(200) | CK not blank |
| `summary` | varchar(500) | CK not blank |
| `status` | varchar(16) | `'draft'`; CK `IN ('draft','published')` |
| `published_at` | timestamptz null | First publication instant, kept across unpublish (like posts B16); CK `status <> 'published' OR published_at IS NOT NULL` |
| `created_at`, `updated_at` | timestamptz | D27 |

No language column. Posts carry `language` because a second language was a stated direction; courses have none, and the column is additive later. No price.

### 4.2 `course_sections`

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | PK |
| `course_id` | uuid | FK `fk_course_sections_course_id` → `courses` `ON DELETE RESTRICT`. **Immutable**: no endpoint moves a section to another course |
| `title` | varchar(200) | CK not blank |
| `position` | integer | CK `>= 0`; UQ `uq_course_sections_course_id_position` **DEFERRABLE INITIALLY DEFERRED** (spike S7) |
| `created_at`, `updated_at` | timestamptz | |

Sections have **no status**. A section appears publicly and to learners only if it holds at least one published lesson.

### 4.3 `course_lessons`

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | PK. **The stable identity progress points to** |
| `section_id` | uuid | FK `fk_course_lessons_section_id` → `course_sections` `ON DELETE RESTRICT`. Changes only to another section **of the same course** (§10.3) |
| `title` | varchar(200) | CK not blank |
| `position` | integer | CK `>= 0`; UQ `uq_course_lessons_section_id_position` DEFERRABLE INITIALLY DEFERRED |
| `status` | varchar(16) | `'draft'`; CK `IN ('draft','published')` |
| `vimeo_video_id` | varchar(20) null | CK digits only `^[0-9]{1,20}$` |
| `vimeo_hash` | varchar(64) null | CK `^[A-Za-z0-9]{1,64}$`; CK `vimeo_hash IS NULL OR vimeo_video_id IS NOT NULL` |
| `duration_seconds` | integer null | CK `> 0`; admin-entered, optional (§8.3) |
| `created_at`, `updated_at` | timestamptz | |

- `ck_course_lessons_published_has_video`: `status <> 'published' OR vimeo_video_id IS NOT NULL`.
- No `course_id` on lessons: the course is reached through the immutable `section.course_id`. That avoids a redundant column that could disagree with its section.

### 4.4 Content changes without migrations

Titles, summaries, sections, order, moves, Vimeo references, durations and publication are row edits through admin endpoints. A migration is needed only for a new *kind* of data.

## 5. Access grants and entitlement

### 5.1 The comp → purchase → refund case

| Event | One mutable row per (user, course) | One row per grant |
|---|---|---|
| 1. Admin comp | row `source=admin`, active | grant G1 `admin`, active |
| 2. Purchase | Overwrite `source=purchase`? The comp is lost. Keep `admin`? The purchase is invisible | grant G2 `purchase`, active |
| 3. Refund of the purchase | Revoking the row cuts off the still-valid comp. Not revoking it means the refund has no effect | G2 revoked; G1 still active → access continues |
| 4. Admin revokes the comp later | Needs a second row squeezed into one | G1 revoked → no active grant → no access |
| History | Latest state only | Every grant and revocation, with who and when |

**Verdict:** a single mutable row can't represent the scenario without losing history or wrongly revoking legitimate access.

**Alternatives considered:**
- **Separate `enrollments` + `entitlements` tables.** Rejected: `enrollments` would hold only derivable facts (first `granted_at`, progress rows).
- **Per-source flags or columns.** Rejected: every source becomes a migration, and history is lost.
- **One row per grant.** **[Approved] OD-1.**

### 5.2 `course_access_grants` [Proposed]

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → `users` `ON DELETE RESTRICT`, by entity name (AD14) |
| `course_id` | uuid | FK → `courses` `ON DELETE RESTRICT` |
| `source` | varchar(16) | CK `source IN ('admin')`. **Only value in V1**; the orders slice widens it to `'purchase'` |
| `granted_by_user_id` | uuid null | FK → `users` RESTRICT. CK `ck_course_access_grants_admin_has_granter`: `source <> 'admin' OR granted_by_user_id IS NOT NULL` |
| `granted_at` | timestamptz | `now()` |
| `revoked_at` | timestamptz null | |
| `revoked_by_user_id` | uuid null | FK → `users` RESTRICT. CK `ck_course_access_grants_revocation_pair`: `(revoked_at IS NULL) = (revoked_by_user_id IS NULL)` |
| `created_at`, `updated_at` | timestamptz | |

**Indexes:**
- `uq_course_access_grants_user_id_course_id_active_admin`: a **partial unique index** on `(user_id, course_id) WHERE source = 'admin' AND revoked_at IS NULL` (CP5; spike S8).
- `ix_course_access_grants_user_id_course_id`: the access check and the user FK.

**The access rule:** access ⇔ at least one grant for (user, course) with `revoked_at IS NULL`.
- One indexed query per learner request.
- Never cached in the session.

### 5.3 Grant, revoke and restore semantics [Proposed]

| Operation | Behavior |
|---|---|
| **Grant** (admin, CP3–CP5) | One statement (C6, D32 with explicit columns): `INSERT … ON CONFLICT (user_id, course_id) WHERE source = 'admin' AND revoked_at IS NULL DO UPDATE SET updated_at = course_access_grants.updated_at RETURNING *`. The conflict target infers the partial unique index, so a duplicate active admin grant is impossible (CP5), and the statement always returns the active grant, new or existing. If a concurrent revoke changes the conflicting row, Postgres re-runs the insertion inside the statement, so a grant racing a revoke ends in some serial order and never in an empty result. TypeORM: `orUpdate([...], ['user_id','course_id'], { indexPredicate })`, with the logged SQL read in spike S8. **Fallback** if S8 shows TypeORM can't emit it: plain insert; on the index's unique violation, re-read the active grant; if the re-read is empty (a revoke raced it), retry the insert once; a second failure is a 500. Unknown user → FK violation on `fk_course_access_grants_user_id` → `404 NOT_FOUND` (translated, D11). The course may be draft, so testers can be prepared before publication |
| **Revoke** (admin) | One `UPDATE … SET revoked_at = now(), revoked_by_user_id = :admin WHERE user_id, course_id, source = 'admin' AND revoked_at IS NULL`. No active admin grant → `204` anyway (idempotent). Progress is untouched (CP2) |
| **Restore** | A new grant row. The revoked row stays as history |
| **Self-grant by an admin** | Allowed and recorded like any other grant ([Approved] OD-6). A `user` or `editor` can never reach the route (CP4) |
| **Admins and learner routes** | Admins have **no implicit learner access**. They preview through admin routes (§11.3). Learner routes need an active grant for every role |

V1 revoke affects admin grants only. A "remove all access" policy is deferred to the orders slice ([Approved] OD-7).

### 5.4 How verified VNPAY payments connect later (not built now)

1. A future `orders` module owns orders and payments and verifies the VNPAY return/IPN signature, amount and order state server-side.
2. When it marks an order paid, inside its transaction, it calls an exported courses provider (for example `grantForPurchase(…)`) that inserts a `purchase` grant tied to the order.
3. The orders slice adds, expand-only:
   - `'purchase'` in the source CHECK;
   - a nullable `order_id` FK;
   - a partial unique index on `order_id` where `source = 'purchase'` (one grant per order, so a replayed IPN stays idempotent);
   - a CHECK tying `order_id` to that source.
4. A refund revokes only the grant with that `order_id` (§5.1).

The cross-module transaction mechanism is **[Docs] deferred** to that slice (architecture §15). V1 adds no order column, payment table, payment endpoint or fake order.

## 6. Lifetime access and revocation semantics

| State | Catalog / outline | `GET /learn/courses` | Learner curriculum, playback, progress write | Progress rows |
|---|---|---|---|---|
| Never granted | ✓ (if published) | not listed | `403 COURSE_ACCESS_REQUIRED` | none |
| Active grant | ✓ | listed (published courses) | ✓ (published course and lesson) | read/write |
| All grants revoked | ✓ | not listed | `403 COURSE_ACCESS_REQUIRED` (CP6) | kept, not readable via the API |
| Restored | ✓ | listed | ✓, previous progress visible | unchanged |

There's no `expires_at` (CP1).

## 7. Student playback authorization

`GET /learn/courses/:slug/lessons/:lessonId` returns a lesson's Vimeo reference only if **all** of these hold, checked in this order:

1. A valid session (guard): 401.
2. The course exists and is **published**: 404.
3. The lesson exists, belongs to that course through its section, and is **published**: 404. A draft and a lesson from another course look the same.
4. The user has an **active grant** for the course: 403 `COURSE_ACCESS_REQUIRED`.

Steps 2 and 3 come before 4, so an ungranted user learns nothing beyond the public outline. Playback DTOs are the only response classes with a video field (I10, exact-body e2e). [Proposed]

### 7.1 Revocation consistency [Proposed]

Learner requests check access with a plain read. They don't lock the grant row, and revocation doesn't wait for in-flight requests.

| Request | Guarantee |
|---|---|
| Its access check runs **after** the revocation committed | **Refused (403).** No reference is returned and no progress is written. This is the guarantee CP6 needs |
| Its access check ran **before** the revocation committed (already authorized, still in flight) | **May complete.** A playback request may return the reference it was already building. A progress request may perform its one upsert after the revocation. The window is that request's lifetime, including any lock wait (§10.6). Nothing bounds it to a fixed time |

**Why not stronger:**
- A late progress write only changes the revoked student's own progress, which is retained anyway (CP2).
- A late playback response delivers a reference the student could have fetched a moment earlier.
- Closing the window would need row locks between grants and every learner request, or a re-check inside each write's transaction, for no protective value.

**What the spec claims:** "revocation applies to every request whose access check runs after it commits". It does **not** claim "no request completes after revocation".

Every `/learn/*` response sends `Cache-Control: no-store` (a controller-level header), so CP6 never depends on a browser or proxy cache keeping an old response. [Proposed, Claude's call]

## 8. Vimeo reference and privacy strategy

### 8.1 What's evidence and what isn't

| Spike | Question | Resolvable from documentation? | Status |
|---|---|---|---|
| S1 | Do domain restrictions work on `localhost`, staging and production? | Partly. Up to 50 domains, a referrer-based check, `no-referrer`/`same-origin` break it [Vimeo]. Localhost and port behavior is undocumented; subdomain depth comes only from a help excerpt | **Needs a real account** |
| S2 | Does an **Embed only** video need the privacy hash? | No. Only **Unlisted** is documented to need `h` [Vimeo] | **Needs a real account** |
| S3 | Does Replace / New version keep the id and privacy? | No. Replacing increments the version number [Vimeo]; keeping the id and settings isn't stated | **Needs a real account** |

All three need a paid plan, since Embed only is paid [Vimeo], and none is authorized. **The design doesn't depend on their answers.**

### 8.2 Least costly safe option ([Approved] OD-5)

- **Store `vimeo_video_id` plus an optional `vimeo_hash`.** Playback returns `video: { provider: 'vimeo', videoId, privacyHash: string | null }`.
  - If S2 shows Embed only needs no hash, the column stays null.
  - If it needs one, or Unlisted is ever used, the admin fills it in, and the contract doesn't change.
- Returning the parts, not a URL, keeps URL construction in the SDK's documented form (`id`, or `url` with `h`) on the web side.
- **References are editable at any time**, also on published lessons, as long as a published lesson keeps an id. S3 changes only the operating procedure, never the schema.
- **The hash is treated like the id:** never in public or outline responses, never logged.
- **No Vimeo API, token or gateway** (C5 not triggered). Duration is admin-entered (§8.3).

### 8.3 Duration

`duration_seconds` is optional:
- shown in the outline when present;
- used to clamp positions (§9.2, §9.6);
- never required to publish.

The web player's duration is authoritative for playback (§9.4).

### 8.4 What this protects, and what revocation can't undo

| Control | Owner | What it does | Limit |
|---|---|---|---|
| **Entitlement enforcement** | Our backend (§7, §7.1) | Decides who may **retrieve** a reference from the API. Revocation stops every future retrieval | **Can't invalidate a reference already delivered.** A revoked student who kept the id (and hash) still holds it; the backend has no lever over Vimeo playback |
| **Embedding protection** | Vimeo, Embed only + specific domains [Vimeo] | Decides **where** a reference plays: not on vimeo.com, not on unlisted sites | Referrer-based. It doesn't know who the viewer is or whether they're entitled. A forged referrer or screen recording defeats it |

Neither is DRM, and the design adds none (CP18). To invalidate an already-delivered reference, the owner would replace the video with a new upload (new id), edit the lesson's reference and delete the old video. That's a manual, operational step, not a V1 feature.

### 8.5 Environments

- **Development before any paid plan:** the web integrates the player against any public Vimeo video (or one with embed "Anywhere").
- **Production:** course videos are Embed only, restricted to the production web domain (and staging when one exists).

## 9. Progress and resume semantics

### 9.1 Storage: `lesson_progress`

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | PK (D26) |
| `user_id` | uuid | FK → `users` RESTRICT (AD14) |
| `lesson_id` | uuid | FK `fk_lesson_progress_lesson_id` → `course_lessons` **RESTRICT** |
| `position_seconds` | integer | CK `>= 0` |
| `completed_at` | timestamptz null | Sticky |
| `last_watched_at` | timestamptz | Server time of the last write |
| `created_at`, `updated_at` | timestamptz | |

UQ `uq_lesson_progress_user_id_lesson_id`. One row per (user, lesson). Table name settled at the map checkpoint (`course_lesson_progress` is the alternative).

### 9.2 Write: `PUT /learn/courses/:slug/lessons/:lessonId/progress`

- Request `{ positionSeconds: integer 0–86 400, completed?: true }` (strict, D8). `completed: false` is a validation error.
- The user is always the session user (I9).
- Authorization is the same as §7, with the §7.1 guarantee.
- **Clamping on write:** to `duration_seconds` when known.
- **One statement:** `INSERT … ON CONFLICT ON CONSTRAINT uq_lesson_progress_user_id_lesson_id DO UPDATE SET position_seconds = …, last_watched_at = now(), completed_at = COALESCE(lesson_progress.completed_at, CASE WHEN :completed THEN now() END)` (D32).
- If the lesson was deleted between the check and the write, the FK violation is translated to `404 NOT_FOUND` (D11). That's only reachable after unpublish → delete, §10.6.
- **Response `204`.**

### 9.3 Tabs, devices, ordering

- The position is last write wins by arrival.
- Completion never regresses.
- Out-of-order arrival from one tab can step the position back by one interval; accepted.
- No client timestamps or optimistic locking (architecture §14 precedent).

### 9.4 Resume

`resumeLessonId` (outcome 3):
1. Among **published** lessons, take the latest `last_watched_at`.
2. If it's **completed**, use the **next published lesson in curriculum order**; if none is left, stay on it. There's no "near the end" test (§9.6).
3. With no progress, use the first published lesson.

Frontend:
- seek to `min(position, playerDuration − 1)`;
- start at 0 when within 5 s of the end;
- catch `RangeError`.

### 9.5 Frontend send cadence and limits

| Trigger | Send |
|---|---|
| Playing | Every **15 s**, throttled from `timeupdate` (~250 ms) [Vimeo] |
| `pause` | Immediately |
| `seeked` | Debounced ~2 s |
| `ended` | `completed: true` (not fired with loop on [Vimeo], so loop stays off) |
| `visibilitychange` → hidden, `pagehide` | Best effort `fetch(…, { keepalive: true })` |
| Failure | Keep only the latest value; retry on the next trigger; no queue |

- `navigator.sendBeacon` can't set `X-Requested-With`, so `CsrfGuard` rejects it ([Impl]).
- Keepalive through the CORS preflight is browser-dependent (S5); losing up to one interval is accepted.
- **Load:** 100 concurrent viewers ≈ 7 writes/s, trivial for Postgres. D23 still applies before launch.
- **Trust:** playback events don't prove a person watched anything, and a student can call the endpoint by hand. Progress is self-reported learning state for that student only, and nothing in V1 depends on it.

### 9.6 Video replacement and saved progress ([Proposed]; a reset policy stays [Open])

The backend can't tell a re-encode with the same content from a different video. Replacing the file in Vimeo is invisible to it; editing a lesson's reference is just a field change. So V1 **never touches progress because of a video change**:

| Aspect | Behavior |
|---|---|
| Saved position | **Kept.** Clamped on write, and **on read**: playback and the learner curriculum return `min(position, duration_seconds)` when the duration is known, without writing. The web clamps again to the player's real duration (§9.4) |
| Sticky completion | **Kept.** Resetting it would be a destructive, product-level decision |
| Duration change | The admin updates `duration_seconds`; read clamping follows at once. With no duration, only the player clamps |
| Resume | Completion alone decides (§9.4 rule 2), so a completed lesson stays finished whatever the new duration. An incomplete lesson resumes at its clamped position (the web still restarts within 5 s of the end, §9.4). Consequence: a student who rewatches part of a completed lesson resumes at the **next** lesson, which is "continue the course" behavior |

**Deferred ([Open], OD-11):** an explicit admin action such as "reset progress for this lesson" when a video's content materially changes. It's not built in V1; the data model doesn't block it (it would be a targeted update or delete of `lesson_progress` rows).

Revision 2 simplified §9.4 rule 2: a completed lesson always advances resume. The draft's "within 10 s of the duration" condition was dropped, because a replaced, longer video could otherwise make a finished lesson look unfinished.

## 10. Publication and curriculum lifecycle ([Approved] OD-9)

### 10.1 Publication readiness

| Action | Condition | Failure |
|---|---|---|
| Publish a lesson | It has a `vimeo_video_id` | `409 LESSON_VIDEO_MISSING` (also the DB CHECK) |
| Publish a course | At least one published lesson | `409 COURSE_NEEDS_PUBLISHED_LESSON` |
| Unpublish the **last** published lesson of a **published** course | Refused | `409 COURSE_NEEDS_PUBLISHED_LESSON` |
| Clear the video id of a published lesson | Refused | `409 LESSON_VIDEO_MISSING` |
| Change the slug of a once-published course | Refused | `409 COURSE_SLUG_LOCKED` |

A published course may still hold draft lessons and sections with no published lessons; unfinished curriculum stays invisible.

### 10.2 Unpublishing with students ([Approved] OD-4)

- **Course:** allowed. It disappears from the catalog and `GET /learn/courses`, and learner routes give 404. Grants and progress stay; republishing restores everything.
- **Lesson:** allowed (subject to §10.1). It disappears from the outline, the learner curriculum and resume; progress stays.

### 10.3 Ordering

- New sections and lessons append at the end.
- `PUT /admin/courses/:courseId/curriculum-order` with `{ sections: [{ id, lessonIds: [...] }] }`:
  - it must list every section of the course exactly once, and every lesson of the course exactly once, otherwise `409 CURRICULUM_ORDER_MISMATCH`;
  - it covers reordering sections, reordering lessons and moving lessons between sections of **that course**, in one transaction.
- Deferrable unique positions make intermediate states legal (S7). Fallback: a two-phase update (offset by a large constant, then final values) in the same transaction.

### 10.4 Deletion

- **Section:** only when empty → `409 SECTION_NOT_EMPTY`.
- **Lesson:** only **draft** → `409 LESSON_IS_PUBLISHED`. From outcome 3, also only without progress: FK RESTRICT → `409 LESSON_HAS_PROGRESS` (D11).
- **Course:** no deletion in V1.

### 10.5 Published but not purchasable ([Approved] OD-3)

`published` means visible and learnable by granted users, not for sale. There's no availability field in V1. The web keeps "Chưa mở đăng ký"; the orders slice adds availability as an additive contract change (api-contract §9). A private beta is a published course with granted testers ([Approved] OD-2).

### 10.6 Curriculum concurrency [Proposed]

**Invariants:**

| ID | Invariant | Protected by |
|---|---|---|
| P1 | A published course has ≥ 1 published lesson | **Service rule under the course lock (below).** No single-row constraint can express it |
| P2 | A published lesson has a video id | DB CHECK `ck_course_lessons_published_has_video` |
| P3 | Positions unique per parent | Deferrable UQ (S7) |
| P4 | A lesson's section belongs to the lesson's course | Sections never change course; moves are validated against the course's own sections under the course lock |
| P5 | Sections being deleted are empty; lessons being deleted are draft (and have no progress) | Service check under the course lock + FK RESTRICT (`fk_course_lessons_section_id`, `fk_lesson_progress_lesson_id`) as the backstop |

**Lock rule L1:** every admin operation that changes a course's curriculum or publication runs in **one transaction** that **first** locks that course's row with `SELECT … FOR NO KEY UPDATE`. TypeORM lock mode `for_no_key_update` exists in 1.1.2 ([Impl] `FindOneOptions` type). Only after that does it read, check and write sections and lessons.
- **Covered:** course update, publish and unpublish; section create, update and delete; lesson create, update, publish, unpublish and delete; curriculum-order.
- **Operations addressed by a section or lesson id** first resolve the course id with a plain read. That's safe because `section.course_id` never changes. Then they lock the course row and **re-read** the section or lesson inside the transaction, so a concurrent delete gives 404.
- **Why the course row, and why `NO KEY UPDATE`:** one lock per course serializes every curriculum change for that course; admin edits are rare, so the serialization costs nothing. The explicit lock is `FOR NO KEY UPDATE`, which conflicts with itself but **not** with the `FOR KEY SHARE` locks Postgres takes for FK checks. So taking the course lock alone never blocks grant inserts (FK → `courses`) or progress upserts (FK → `course_lessons`). The blog's `pessimistic_write` (`FOR UPDATE`) would block them for every edit.
- **Where a stronger lock still happens:** Postgres takes `FOR UPDATE` on any `UPDATE` that changes a column covered by a non-partial, non-expression unique index.
  - **A course slug change** (`uq_courses_slug`) therefore briefly makes concurrent grant inserts for that course wait until the admin transaction commits.
  - **Lesson moves and reorders** change `section_id`/`position`, which are in the deferrable `uq_course_lessons_section_id_position`. Whether Postgres treats a deferrable unique index as a key for this purpose is **unverified** (S9). If it does, a curriculum-order transaction and concurrent progress upserts on the lessons it moves wait for each other in turn.
  - Both cases are **waits, not deadlocks**: the waiting statement is a single statement that holds no lock the admin transaction needs. They lengthen the §7.1 window. They don't break an invariant.

**Lock order and deadlocks:**
- Every curriculum transaction takes exactly one course lock, first, then only row locks on that course's sections and lessons (from its own updates and deletes). Two curriculum transactions for the same course serialize on the course lock before touching anything below it. Transactions for different courses share no rows. **No lock cycle exists among curriculum transactions.**
- Non-curriculum writers never take a course lock:
  - Grant insert: `KEY SHARE` on the course row, compatible with `NO KEY UPDATE`.
  - Revoke: one row update on `course_access_grants`.
  - Progress upsert: `KEY SHARE` on one lesson row (its FK check, taken at the end of the statement). That's compatible with lesson updates that change no unique-indexed column (status, video, duration, title). It may wait on a move or reorder (above, S9). It conflicts with a lesson **DELETE** (`FOR UPDATE`). The delete then waits for the progress transaction, and fails RESTRICT (409) or succeeds first (the progress write gets 404, §9.2). The progress transaction holds one lock and requests no other, so there's no cycle.
- Learner reads take no locks.
- **If Postgres still reports a deadlock (40P01)**, it's untranslated: 500 + error log (I15). There's no automatic retry. A retry policy is added only if one is ever observed.

**Why P1 holds under concurrency:**
- Only **lesson unpublish** can lower a course's published-lesson count:
  - lesson delete requires a draft;
  - moves stay inside the course;
  - a video edit can't unpublish (P2);
  - section delete requires an empty section.
- Only **course publish** can make the invariant start to apply.
- Both hold the course lock while they count published lessons and write. Under READ COMMITTED, the count statement starts after the lock was granted, so it sees every change committed by the previous holder.
- Therefore any two such operations behave as in some serial order, and every serial order preserves P1 (§10.1 checks).

**Operations that need no extra protection:**

| Operation | Why |
|---|---|
| Updating a published lesson's video reference | P2 is a CHECK, and the row update is atomic. L1 still applies (it's a curriculum operation), but only for consistent error messages |
| Deleting a draft lesson or an empty section | Can't change P1; FK RESTRICT is the backstop |
| Reorder or move | Doesn't change any status. L1 is needed for P3/P4 and the mismatch check |

## 11. Routes, request components and response DTOs ([Approved] OD-10)

Every name below is a proposed contract identifier (I19).

Shared behavior:
- Success is `{ data }` (I11); no-content is 204 (I12).
- Every route documents its codes from runtime definitions (I18).
- Writes need CSRF headers ([Impl]).
- Malformed UUIDs → `400 VALIDATION_FAILED` with field code `INVALID_FORMAT` (D9). Slugs are opaque lookup keys (the posts/services D7 deviation).
- Every route can also return 500.

**Route families:**
- `/courses`: public.
- `/learn/courses`: signed-in learner.
- `/admin/…`: admin.

All learner routes share one prefix. That's why revision 2 replaces the draft's `GET /me/courses` with `GET /learn/courses`: it avoids a new `/me` family next to the existing `/auth/me`.

### 11.1 Public (outcome 1)

| Route | Response | Errors |
|---|---|---|
| `GET /courses` | `CourseSummaryDto[]` `{ id, slug, title, summary, publishedAt }`; published only, newest `publishedAt` first, unpaginated | — |
| `GET /courses/:slug` | `CourseDto` = summary + `sections: CourseOutlineSectionDto[] { id, title, lessons: CourseOutlineLessonDto[] { id, title, durationSeconds \| null } }`. Published lessons only; sections without one omitted; **no video fields** | 404 |

### 11.2 Learner (outcome 2, extended additively in outcome 3)

| Route | Request | Response | Errors |
|---|---|---|---|
| `GET /learn/courses` | — | `LearnerCourseSummaryDto[]` (§11.6) for published courses with an active grant | 401 |
| `GET /learn/courses/:slug` | — | `LearnerCourseDto` (§11.6) | 401, 403 `COURSE_ACCESS_REQUIRED`, 404 |
| `GET /learn/courses/:slug/lessons/:lessonId` | path `LessonPathParams` | `LessonPlaybackDto` (§11.6) | 400, 401, 403, 404 |
| `PUT /learn/courses/:slug/lessons/:lessonId/progress` (outcome 3) | `SaveLessonProgressDto` `{ positionSeconds, completed? }` | 204 | 400, 401, 403, 404, 413 |

### 11.3 Admin: curriculum (outcome 1, `@Roles('admin')`)

| Route | Request | Response | Errors (besides 400/401/403) |
|---|---|---|---|
| `GET /admin/courses` | — | `AdminCourseSummaryDto[]` | — |
| `POST /admin/courses` | `SaveCourseDto` `{ slug, title, summary }` | 201 `AdminCourseDto` (draft) | 409 `COURSE_SLUG_TAKEN` |
| `GET /admin/courses/:courseId` | — | `AdminCourseDto` | 404 |
| `PUT /admin/courses/:courseId` | `SaveCourseDto` | `AdminCourseDto` | 404, 409 `COURSE_SLUG_TAKEN` / `COURSE_SLUG_LOCKED` |
| `POST /admin/courses/:courseId/publish` · `/unpublish` | — | `AdminCourseDto`; idempotent | 404, 409 `COURSE_NEEDS_PUBLISHED_LESSON` (publish) |
| `POST /admin/courses/:courseId/sections` | `SaveCourseSectionDto` `{ title }` | 201 `AdminCourseDto` | 404 |
| `PUT /admin/course-sections/:sectionId` | `SaveCourseSectionDto` | `AdminCourseDto` | 404 |
| `DELETE /admin/course-sections/:sectionId` | — | 204 | 404, 409 `SECTION_NOT_EMPTY` |
| `PUT /admin/courses/:courseId/curriculum-order` | `CurriculumOrderDto` | `AdminCourseDto` | 404, 409 `CURRICULUM_ORDER_MISMATCH` |
| `POST /admin/course-sections/:sectionId/lessons` | `SaveCourseLessonDto` `{ title, videoId?, privacyHash?, durationSeconds? }` | 201 `AdminCourseDto` | 404 |
| `PUT /admin/course-lessons/:lessonId` | `SaveCourseLessonDto` (full replacement; omitted optional → null) | `AdminCourseDto` | 404, 409 `LESSON_VIDEO_MISSING` |
| `POST /admin/course-lessons/:lessonId/publish` · `/unpublish` | — | `AdminCourseDto`; idempotent | 404, 409 `LESSON_VIDEO_MISSING` (publish) / `COURSE_NEEDS_PUBLISHED_LESSON` (unpublish) |
| `DELETE /admin/course-lessons/:lessonId` | — | 204 | 404, 409 `LESSON_IS_PUBLISHED`; + `LESSON_HAS_PROGRESS` from outcome 3 |

**Admin DTO fields:**
- `AdminCourseSummaryDto` = `{ id, slug, title, summary, status, publishedAt, updatedAt, publishedLessonCount, lessonCount }`.
- `AdminCourseDto` = summary fields + `{ createdAt, sections: AdminCourseSectionDto[] }`.
- `AdminCourseSectionDto` = `{ id, title, position, lessons: AdminCourseLessonDto[] }`.
- `AdminCourseLessonDto` = `{ id, title, position, status, videoId | null, privacyHash | null, durationSeconds | null, updatedAt }`.
- Lists are in curriculum order; `position` is informational.
- Every curriculum write returns the whole `AdminCourseDto`.

### 11.4 Admin: access (outcome 2)

| Route | Response | Errors (besides 400/401/403) |
|---|---|---|
| `GET /admin/courses/:courseId/access-grants` | `CourseAccessGrantDto[]` `{ id, user: CourseAccessUserDto { id, displayName, avatarUrl }, source, grantedAt, grantedBy: CourseAccessUserDto \| null, revokedAt \| null, revokedBy: CourseAccessUserDto \| null }`, newest first, history included, unpaginated | 404 |
| `PUT /admin/courses/:courseId/access/:userId` | 200 `CourseAccessGrantDto` (the active admin grant: existing or new) | 404 (course or user) |
| `DELETE /admin/courses/:courseId/access/:userId` | 204, idempotent | 404 (course) |

The grant list shows public profiles only ([Impl] `UserProfilesReader`, no email). Admins find user ids through the existing `GET /admin/users`.

### 11.5 Error codes (owned by `courses.errors.ts`, D10)

| Code | Kind | First outcome |
|---|---|---|
| `COURSE_SLUG_TAKEN`, `COURSE_SLUG_LOCKED`, `COURSE_NEEDS_PUBLISHED_LESSON`, `LESSON_VIDEO_MISSING`, `LESSON_IS_PUBLISHED`, `SECTION_NOT_EMPTY`, `CURRICULUM_ORDER_MISMATCH` | conflict | 1 |
| `COURSE_ACCESS_REQUIRED` | forbidden | 2 |
| `LESSON_HAS_PROGRESS` | conflict | 3 |

### 11.6 Contract by outcome

| DTO / component | Outcome 1 | Outcome 2 | Outcome 3 (additive only) |
|---|---|---|---|
| `CourseSummaryDto`, `CourseDto`, `CourseOutlineSectionDto`, `CourseOutlineLessonDto` | **new** | — | — |
| Admin course DTOs, `SaveCourseDto`, `SaveCourseSectionDto`, `SaveCourseLessonDto`, `CurriculumOrderDto` | **new** | — | — |
| `CourseAccessGrantDto`, `CourseAccessUserDto` | — | **new** | — |
| `LearnerCourseSummaryDto` | — | **new**: `{ course: CourseSummaryDto, totalLessons }` | **+** `completedLessons`, `resumeLessonId` |
| `LearnerCourseDto` | — | **new**: `{ course: CourseSummaryDto, sections: LearnerCourseSectionDto[] }` | **+** `resumeLessonId` |
| `LearnerCourseSectionDto` | — | **new**: `{ id, title, lessons: LearnerCourseLessonDto[] }` | — |
| `LearnerCourseLessonDto` | — | **new**: `{ id, title, durationSeconds \| null }` | **+** `progress: LessonProgressDto` |
| `LessonPlaybackDto` | — | **new**: `{ id, title, sectionTitle, durationSeconds \| null, video: VimeoVideoDto, previousLessonId \| null, nextLessonId \| null }` | **+** `progress: LessonProgressDto` |
| `VimeoVideoDto` | — | **new**: `{ provider: 'vimeo', videoId, privacyHash \| null }` | — |
| `LessonProgressDto` | — | — | **new**: `{ positionSeconds, completed }`; zeros/false when no row; position read-clamped (§9.6) |
| `SaveLessonProgressDto`, the progress PUT | — | — | **new** |

**Compatibility:**
- Outcome 2 needs no progress table, and none of its fields depends on progress.
- Outcome 3 only **adds** response fields, one route, one request component and one error code to an existing route. Each is additive at runtime under api-contract §9: existing consumers keep working, and regenerated types gain fields.
- **One compile-time caveat:** `@ApiErrorResponses` documents a per-status `code` enum, so `LESSON_HAS_PROGRESS` widens the 409 union of `DELETE /admin/course-lessons/:lessonId`. Exhaustive `switch`/`Record` code in xuan-web would need one new case when it regenerates.
- Learner DTOs are separate classes from the public outline DTOs from outcome 2 on. Outcome 3 therefore extends learner shapes without touching the public contract, and no class is renamed (I19).

## 12. Role and access matrix [Proposed]

| Capability | Visitor | User without grant | User with active grant | Editor | Admin |
|---|---|---|---|---|---|
| Catalog and published outline | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GET /learn/courses` | 401 | ✓ (empty) | ✓ | ✓ (own grants) | ✓ (own grants) |
| Learner curriculum, playback, progress | 401 | 403 | ✓ | as a user (needs a grant) | as a user (needs a grant) |
| Admin curriculum, publication | 401 | 403 | 403 | 403 | ✓ |
| Grant, revoke, list grants | 401 | 403 | 403 | 403 | ✓ (self-grant allowed, OD-6) |
| Draft courses/lessons and their video refs | 404 | 404 | 404 | 404 (403 on admin routes) | ✓ via admin routes |

## 13. Important database constraints

The full list is in §4, §5.2 and §9.1. The ones carrying the rules:
- `ck_course_lessons_published_has_video` (P2);
- `uq_courses_slug`, `ck_courses_slug_format`, `ck_courses_published_has_date`;
- `uq_course_access_grants_user_id_course_id_active_admin` (partial unique, CP5);
- `ck_course_access_grants_admin_has_granter`, `ck_course_access_grants_revocation_pair`;
- `uq_lesson_progress_user_id_lesson_id` (the upsert target, D32);
- `fk_lesson_progress_lesson_id` RESTRICT, `fk_course_lessons_section_id` RESTRICT (P5 backstops);
- the deferrable position UQs (P3, S7).

Each translated constraint gets an e2e test proving its name ([Docs] `database.md` §9). P1 has no constraint; §10.6 explains why the course lock is the mechanism.

## 14. Security and privacy boundaries

| Boundary | Mechanism | Prevents? |
|---|---|---|
| Unauthenticated learner access | Default-deny guard ([Impl]) | Yes |
| Signed in without a grant | Service access check per request (§7) | Yes |
| Revoked students, new requests | Same check, no caching (CP6, §7.1) | Yes, for requests starting after the revocation commits |
| Revoked students, references already delivered | — | **No** (§8.4) |
| Direct lesson-id requests | Lesson must be published and in the path's course | Yes |
| Video refs in public or outline responses | Separate DTO classes; exact-body e2e | Yes |
| Draft content leaking | Default draft; every non-admin query filters course and lesson status | Yes |
| Privilege escalation via grants | `@Roles('admin')`; no client-writable access field (I9) | Yes |
| Writing another user's progress | User from session only | Yes |
| CSRF | Existing `CsrfGuard`, CORS, `SameSite=Lax` ([Impl]) | Yes |
| Logging | No request bodies (I17); video ids and hashes never logged | Yes |
| Provider secrets | None exist in V1 | n/a |
| A granted student shares a reference and replays it with a forged referrer; screen recording | Embed only + domain allowlist reduce casual reuse [Vimeo] | **No.** Accepted (CP18) |

## 15. Frontend integration requirements (for xuan-web's own outcome)

- **Prerequisite:** xuan-web's `feat/integrate-google-sign-in` (apiClient, generated types, sign-in) is merged in xuan-web. It isn't today ([Impl], read-only check).
- **Types:** generated from `/docs-json`. `_data/courses.ts` keeps the editorial copy; identity, status and outline come from the API by slug.
- **Public outline:** a 404 (course not yet published) still renders the static page, without an outline.
- **Sale label:** "Chưa mở đăng ký" stays a web decision for every published course (§10.5).
- **Player:**
  - Vimeo Player SDK with `id`, or `url` with `h` when `privacyHash` is set;
  - loop off;
  - the §9.5 cadence;
  - resume per §9.4;
  - `PrivacyError` / `NotFoundError` states.
- **Build order:** playback can be built against outcome 2; progress and resume against outcome 3 (§11.6).
- **Errors:**
  - 401 → sign in with `returnTo`;
  - 403 `COURSE_ACCESS_REQUIRED` → "you don't have access" (no checkout);
  - 404;
  - 400 `VALIDATION_FAILED`.
- **Writes:** `X-Requested-With` and credentials; no `sendBeacon`.
- **Headers:** `Referrer-Policy` never `no-referrer` or `same-origin`; a future CSP allows `frame-src https://player.vimeo.com`.
- **Contract docs:** the `api-contract.md` §12 mirror-delta rows are extended per outcome.

## 16. Implementation sequence [Proposed]

Each outcome starts from freshly updated `dev` and merges before the next branch starts. No stacking.

| # | Branch (illustrative) | Delivers | Depends on | Stands alone because |
|---|---|---|---|---|
| 0 | `docs/record-course-delegation` (only if OD-8 = delegated) | The OD-8 doc record (§19) | — | A process record, independent of course code (`xuan-git-branch-cohesion`: unrelated to the outcome → its own branch) |
| 1 | `feat/build-course-catalog` | `courses`, `course_sections`, `course_lessons`; §11.1 and §11.3; L1 locking; outcome-1 errors; `isForeignKeyViolation` if needed; this spec committed; docs; OpenAPI; e2e | (0) | Content can be authored and its public outline served. Video refs are stored but only admins see them |
| 2 | `feat/grant-course-access` | `course_access_grants`; §11.4; learner routes without progress (§11.6 outcome-2 column); `COURSE_ACCESS_REQUIRED` | 1 merged | Granted students can watch. **The smallest useful slice ends here** |
| 3 | `feat/track-course-progress` | `lesson_progress`; the progress PUT; the outcome-3 additive fields; `LESSON_HAS_PROGRESS` | 2 merged | Resume and completion, without breaking outcome 2's consumers |

- **Not four outcomes:** Vimeo playback has no backend part beyond the gated reference.
- **2 and 3 not merged:** 3 adds a table, a write path and the resume rule, and the web can build playback against 2 first.
- **1 not split:** an admin-only half has no reader, and a public-only half has no content.
- **Docs on each branch:**
  - `database.md` §12 (map first, then implemented);
  - `data-model.md` (course/section/lesson LIKELY → CONFIRMED in 1; the enrollment/entitlement resolution in 2);
  - `api-contract.md` §11 and §12;
  - `architecture.md` §3 layout and §17 user references (1 and 2), plus a decision entry for the grant model and the L1 lock rule (1 and 2).

**Database approval checkpoints** (owner, every time, `xuan-database-change`):

| Outcome | Checkpoints |
|---|---|
| 1, 2, 3 | Map approval → `migration:run` on `xuan_test` (guarded) → revert → re-run → empty second generate → `migration:run` on `xuan_dev` → every mutating e2e run |
| — | No seed scripts. Creating the real course through the admin API on `xuan_dev` needs approval too. Production runs are deployment work |

## 17. Required technical spikes

| Spike | Needs | Blocks | When |
|---|---|---|---|
| S7 TypeORM deferrable unique on positions; empty second generate | Repo only | P3 in outcome 1 | First task of outcome 1. Fallback §10.3 |
| S8 TypeORM partial unique index (`@Index({ unique, where })`) generates and round-trips; `orUpdate(…, { indexPredicate })` emits `ON CONFLICT (user_id, course_id) WHERE … DO UPDATE … RETURNING` | Repo only | CP5 in outcome 2 | First task of outcome 2. Fallbacks: raw SQL index + metadata keeping generate empty; insert/re-read/retry-once (§5.3) |
| S9 `for_no_key_update` emits `FOR NO KEY UPDATE` and doesn't block a concurrent FK insert. Also: does a move/reorder (deferrable position unique) take `FOR UPDATE` on lessons? Do a slug change and a grant only wait, never deadlock? | Repo only | L1 in outcome 1; R6/R7 in outcomes 2–3 | Inside outcome 1's first lock task (read the logged SQL + race tests). Either S9 answer is acceptable; it only decides which waits the docs describe |
| S4 Resume and `setCurrentTime` on iOS Safari / Android Chrome | Any public Vimeo video | Web resume UX | Web outcome |
| S5 `fetch` keepalive with `X-Requested-With` on `pagehide` | Local API + web | Last-interval progress only | Any time |
| S1, S2, S3 Domain allowlist incl. localhost; hash need; Replace keeps id | Paid Vimeo plan + one test video | Operating procedure only; no backend outcome | Before launch |
| S6 Production referrer reaches Vimeo | Staging or production web | Launch | Before launch |

## 18. Test and acceptance criteria

Unit tests cover only pure logic: the resume rule, the curriculum-order validation and read clamping. Everything else is e2e on `xuan_test` with exact bodies. Race tests follow the blog's pattern ([Impl] `test/admin-posts.e2e-spec.ts`): fire the requests concurrently with `Promise.all` and assert that the outcome matches **some serial order**.

**Outcome 1:**
- A draft course or lesson is invisible publicly; a section without a published lesson is omitted.
- Every §10.1 409.
- Slug taken and slug locked.
- Reorder (sections, lessons, cross-section move), and a mismatch → 409.
- Deletion rules.
- `uq_courses_slug` is translated.
- **Public bodies contain no video field (exact body).**
- Non-admins get 401/403.
- The OpenAPI document builds.
- **Race tests:**
  - **R1** course publish ∥ unpublish of its only published lesson → never a published course with zero published lessons; exactly one 409 when the serial order demands it.
  - **R2** published course with two published lessons: two concurrent unpublishes → exactly one succeeds, one 409.
  - **R3** delete an empty section ∥ curriculum-order moving a lesson into it → serial outcome (204 then 409 `CURRICULUM_ORDER_MISMATCH`, or order applied then 409 `SECTION_NOT_EMPTY`); never 500.
  - **R4** lesson create ∥ curriculum-order → order applied with the new lesson appended after it, or 409 mismatch; positions stay unique.

**Outcome 2:**
- Grant is idempotent (same id).
- **R5** two concurrent grant PUTs → one active row, both 200 with the same id.
- Unknown user → 404 (FK translated).
- Revoke → the next learner request is 403.
- Restore → a new row, history listed.
- Ungranted → 403; draft lesson → 404 even with a grant; draft course → 404 even with a grant (OD-2).
- Playback exact body includes `videoId` and `privacyHash`; the learner curriculum has no video field.
- Admin self-grant works; editor → 403 on access routes.
- `GET /learn/courses` lists only active, published courses.
- **R5b** grant PUT ∥ revoke DELETE for the same user and course → 200 and 204 in some serial order (an active grant exists only if the grant came last); never 500.
- **R6** grant PUT ∥ a slug change and ∥ a lesson publish on the same course → all complete, no 40P01 (S9).

**Outcome 3:**
- The upsert creates, then updates, one row.
- Completion is sticky; `completed:false` → 400.
- A position is clamped on write, and read-clamped after a duration decrease.
- Another user's progress is unaffected.
- Revoked user → 403 and no row change.
- Resume: latest lesson, then next after completion, first by default; an unpublished lesson is excluded.
- Deleting a lesson with progress → 409 `LESSON_HAS_PROGRESS`.
- **R7** progress PUT ∥ curriculum-order moving that lesson → both complete, no 40P01; the progress row stays attached to the lesson (S9).
- Outcome 2's exact-body tests are updated only by **added** fields.

**Every outcome:**
- lint, typecheck, unit, e2e, build, empty second `migration:generate`;
- `xuan-api-architecture-review` plus an independent review before merge (workflow §12–§13).

## 19. Decisions

**Owner decisions, approved 2026-10-18** (proposed in the owner's 2026-10-17 review, approved with revision 2 of this spec).

| ID | Decision | Answer | Tag |
|---|---|---|---|
| OD-1 | Access model | One row per grant; access = at least one active grant | [Approved] |
| OD-2 | Draft course access | Draft = admin-only; beta = published course, not purchasable | [Approved] |
| OD-3 | Availability field | None until orders/payment design | [Approved] |
| OD-4 | Unpublish with grants | Allowed; grants and progress preserved | [Approved] |
| OD-5 | Vimeo reference | Video id + optional privacy hash | [Approved] |
| OD-6 | Admin self-grant | Allowed, recorded like any grant | [Approved] |
| OD-7 | Remove-all-access policy | Deferred to orders | [Approved] |
| OD-8 | Working mode | Delegated; database approvals unchanged; minimal doc record below | [Approved] |
| OD-9 | Publication, deletion, ordering rules | As §10, with the §10.6 concurrency rule | [Approved] |
| OD-10 | Contract identifiers | As §11, including the revision-2 rename `GET /me/courses` → `GET /learn/courses` | [Approved] |
| OD-11 | Progress reset after a material video change | **Deferred**; V1 never resets progress (§9.6) | [Open], deferred by the owner (2026-10-18) |

**OD-8 minimal canonical record** (branch 0, §16), two edits:
1. `docs/development-workflow.md` §3.5: one new row, "Course platform outcomes 1–3 (`2026-10-17-course-platform-design.md`) | <approval date> | Claude implements, verifies, reviews and merges each outcome PR under the Git row's conditions. Database operations keep the row below: owner approval each time."
2. `CLAUDE.md` **Status** lines only: "Current slice" becomes the course platform; the blog moves to "Done". The "Working mode" section needs no change: it already allows work the owner "has delegated", and the delegated classes live in §3.5.

Not proposed: recording the blog's delegation retroactively. It's merged history, and changing that record is the owner's choice.

## 20. What approval unlocks

The owner approved this spec on 2026-10-18 (OD-1…OD-10 approved, OD-11 deferred). That allowed:
1. Branch 0 (the OD-8 record): done, PR #12, merged into `dev` as `247c8cc`.
2. `superpowers:writing-plans` for **outcome 1 only**, followed by a plan for each later outcome after the previous one merged.

Spikes S7, S8 and S9 are plan tasks with stated fallbacks. Every database step keeps its own approval.

**Calls made by Claude (for the owner to check while reading):**
- the admin DTO field lists;
- `LESSON_HAS_PROGRESS` only from outcome 3;
- `COURSE_NEEDS_PUBLISHED_LESSON` removed from lesson deletion;
- `FOR NO KEY UPDATE` instead of the blog's `FOR UPDATE`;
- no automatic deadlock retry;
- read-side clamping;
- the simplified resume rule (§9.6);
- `revokedBy` added to the grant DTO;
- column sizes and the progress table name at the map checkpoint.

## 21. Architecture consistency review (revision 2)

| Item | Canonical source | Verdict |
|---|---|---|
| One `courses` module, five tables | D1, architecture §3, §5 ("Module ≠ table", data-model) | Consistent. Five tables arrive over three outcomes; no speculative module |
| FKs to `users` from grants (3 columns) and progress | AD14, C12 | Consistent: `@ForeignKey('User', …)` by name, no relation, no `User` import. `architecture.md` §17 "References to `users.id`" gets the new FKs. AD14's revisit trigger (a join or more than public profiles) is not hit |
| FKs within the module | D37 | Builder's choice: FK metadata or `@ManyToOne` without eager/lazy. Queries join explicitly (D38) |
| Partial unique active-grant index | D25 naming, D31, D32, C6 | Named `uq_<table>_<cols>_active_admin`: the `<cols>` pattern plus a predicate suffix, since a plain `uq_<table>_<cols>` would wrongly suggest a full unique. The expected conflict is handled as a result (C6) with `ON CONFLICT` on **explicit columns + index predicate** (D32's "explicit columns" form; `ON CONSTRAINT` can't name an index). Translation-and-retry is only the S8 fallback |
| Deferrable position uniques | D25, D31, D33 | Consistent if S7 passes; fallback keeps plain uniques |
| Lesson deletion with progress | D11, I15, database §9 | Consistent: FK RESTRICT translated by the owning service; untranslated violations stay 500 |
| Course row lock | I8, C3, the posts precedent | Consistent: one transaction, manager only. The lock mode differs from posts for a stated reason (§10.6) |
| Admin-only management | AD13, A7 explicit role lists | Consistent: `@Roles('admin')` |
| Vimeo id + optional hash, no gateway | C5, I4, I6 | Consistent: no provider call, so no gateway, config or secret |
| Future purchase source and idempotency | architecture §15 (cross-module transactions deferred), data-model §5 | Consistent: nothing built; expand-only path described; data-model's "enrollment vs entitlement" is resolved by OD-1 in outcome 2's docs |
| Pagination absent on course lists | api-contract §3 ("offset pagination is the default") | Stated deviation: tiny lists, the services precedent (`GET /services` unpaginated). Reported in each PR's Notes (DEFAULT deviation with reason) |
| `/learn` prefix, no `/me` family | api-contract §11, D22 (no global prefix) | Consistent; avoids a second "me" family next to `/auth/me` |
