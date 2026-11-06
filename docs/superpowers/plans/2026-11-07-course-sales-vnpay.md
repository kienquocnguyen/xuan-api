# Course sales with VNPAY Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sell the first course: YouTube-unlisted lessons, a course price, VNPAY checkout, a verified IPN that grants access.

**Architecture:**
- A new `orders` module owns `orders`, a pure `vnpay/` toolkit, checkout and the IPN.
- It reaches courses only through one exported provider, `CourseSales`. Its `grantForPurchase` writes through the IPN transaction's `EntityManager` (I8).
- Courses gain `price_vnd`, lessons gain `youtube_video_id`, grants gain the `purchase` source and `order_id`.

**Tech Stack:** NestJS 12, TypeORM 1.1, PostgreSQL 18, Zod 4, Jest, Node `crypto` (HMAC-SHA512). No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-07-course-sales-vnpay-design.md`

**Mode:** `[delegate]`, every task (owner, 2026-11-07). Database commands (`migration:*`, e2e) are **not delegated**: migrations are hand-written to match the entities, and e2e specs are written but run only after the owner approves the packet (Task 8).

## Global Constraints

- Branch `feat/course-sales-vnpay` from `dev` `4f93d38`. PR to `dev`, **not merged** (spec header).
- Price: `price_vnd integer NULL`, CK `BETWEEN 1000 AND 100000000`. The first course is 499.000 (data, set by an admin).
- YouTube id `^[A-Za-z0-9_-]{11}$`. At most one of the Vimeo and YouTube ids.
- VNPAY: version `2.1.0`, command `pay`, currency `VND`, locale `vn`, order type `other`, amount ×100, expiry 15 min, dates `yyyyMMddHHmmss` GMT+7, HMAC-SHA512 hex over the PHP-`urlencode`-compatible canonical query (spec S8).
- IPN answers (exact): `00 Confirm Success`, `01 Order Not Found`, `02 Order already confirmed`, `04 Invalid amount`, `97 Invalid Checksum`, `99 Unknown error`.
- New error codes: `COURSE_NOT_FOR_SALE` (409), `COURSE_ALREADY_OWNED` (409), `PAYMENTS_UNAVAILABLE` (503). Messages as in spec §5.4.
- Throttle: 5 orders per user per 15 min → `429 RATE_LIMITED` + `Retry-After`.
- Config: `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_PAYMENT_URL`, `VNPAY_RETURN_URL`: all four or none.
- Constraint names exactly as in the spec. Migrations hand-written in TypeORM's generated style; each must match its entity, so the owner's second `migration:generate` is empty.

## Review Focus

1. **The signature over values with spaces or URL characters** (`vnp_OrderInfo`, `vnp_ReturnUrl`, VNPAY's echoed `vnp_OrderInfo` arriving with `+` or `%20`). Verify must accept what sign produced, after Express's query parsing. Test in Task 3.
2. **GMT+7 dates around UTC midnight** (23:30 UTC = next day in Vietnam). Test in Task 3.
3. **IPN with missing or duplicated query keys** (`vnp_Amount` sent twice → Express gives an array). It must answer `97`/`04`/`01`, never throw a 500. Test in Task 3 (decision) and Task 6 (e2e).
4. **A late success IPN for a past-expiry pending order** must still be `paid` (S9). Test in Task 3.
5. **Two IPNs at once** → one grant, answers `00` + `02`. e2e in Task 6.

---

### Task 1: YouTube-unlisted lesson videos

**Files:**
- Modify:
  - `src/modules/courses/course-lesson.entity.ts`;
  - `src/modules/courses/dto/save-course.dto.ts`;
  - `src/modules/courses/courses.service.ts` (addLesson, updateLesson, publishLesson);
  - `src/modules/courses/dto/admin-course.dto.ts`;
  - `src/modules/courses/dto/learning.dto.ts`;
  - `src/modules/courses/courses.errors.ts`.
- Create: `src/database/migrations/1793990000000-AddLessonYouTubeVideo.ts`.
- Test:
  - `src/modules/courses/dto/save-course.dto.spec.ts` (unit);
  - `test/admin-courses.e2e-spec.ts`, `test/learning.e2e-spec.ts`, `test/courses-schema.e2e-spec.ts` (e2e, written only).

**Interfaces:**
- Produces:
  - `CourseLesson.youtubeVideoId: string | null`;
  - `SaveCourseLessonInput.youtubeVideoId: string | null`;
  - `LessonVideoDto { provider: 'vimeo' | 'youtube'; videoId: string; privacyHash: string | null }`, replacing `VimeoVideoDto`.

- [ ] **Step 1: Write the failing unit tests** in `save-course.dto.spec.ts`:
  - `{ title, youtubeVideoId: 'dQw4w9WgXcQ' }` parses, with `videoId: null`;
  - `youtubeVideoId: 'short'` fails `INVALID_FORMAT` at `youtubeVideoId`;
  - `videoId` together with `youtubeVideoId` fails at `youtubeVideoId`;
  - `privacyHash` with only `youtubeVideoId` fails at `privacyHash`;
  - omitting it gives `youtubeVideoId: null`.
- [ ] **Step 2:** `yarn test save-course.dto` → FAIL.
- [ ] **Step 3: Implement.**
  - Entity: column `youtube_video_id varchar(11)`; CKs `ck_course_lessons_youtube_video_id_format` and `ck_course_lessons_one_video`; `ck_course_lessons_published_has_video` with the new expression (spec §3).
  - Schema: the field and the superRefine rules.
  - Service: store the field; "has a video" = either id (update P2 check, the publish check, the `unchanged` comparison).
  - Admin DTO: `youtubeVideoId`.
  - Playback: `toLessonPlaybackDto` picks the provider from whichever id is set.
  - Error message: "A published lesson needs a video."
- [ ] **Step 4: Migration** `AddLessonYouTubeVideo1793990000000`.
  - `up`:
    - `ALTER TABLE "course_lessons" ADD "youtube_video_id" character varying(11)`;
    - `DROP CONSTRAINT "ck_course_lessons_published_has_video"`;
    - `ADD CONSTRAINT` the three CKs;
  - `down`: the reverse. It restores the old published CK **only after** `DELETE`-free validation: the down fails loudly if a published YouTube-only lesson exists, which is acceptable for a revert.
- [ ] **Step 5:** `yarn test save-course.dto` → PASS. `yarn typecheck` → clean.
- [ ] **Step 6: e2e (written, not run).**
  - admin create with `youtubeVideoId` → `AdminCourseLessonDto.youtubeVideoId`;
  - both ids → 400;
  - publish a YouTube-only lesson → 200;
  - playback → `video: { provider: 'youtube', videoId: 'dQw4w9WgXcQ', privacyHash: null }`;
  - schema: both ids in SQL → `23514` on `ck_course_lessons_one_video`.
- [ ] **Step 7: Commit** `feat(courses): accept YouTube-unlisted lesson videos`.

### Task 2: Course price

**Files:**
- Modify:
  - `course.entity.ts`, `courses.service.ts` (`setPrice`);
  - `admin-courses.controller.ts`;
  - `dto/save-course.dto.ts` (`saveCoursePriceSchema`, `SaveCoursePriceDto`);
  - `dto/course.dto.ts`, `dto/admin-course.dto.ts`.
- Create: `src/database/migrations/1793990100000-AddCoursePrice.ts`.
- Test: `save-course.dto.spec.ts`; e2e `test/admin-courses.e2e-spec.ts`, `test/courses.e2e-spec.ts` (written).

**Interfaces:**
- Produces:
  - `Course.priceVnd: number | null`;
  - `CoursesService.setPrice(courseId: string, priceVnd: number | null): Promise<CourseTree>`;
  - `CourseSummaryDto.priceVnd: number | null`, `AdminCourseSummaryDto.priceVnd`.

- [ ] **Step 1: Failing unit tests.**
  - `{ priceVnd: 499000 }` parses;
  - `{ priceVnd: null }` parses;
  - `{}` → `REQUIRED`;
  - `999` → `TOO_SMALL`;
  - `100000001` → `TOO_BIG`;
  - `499000.5` → invalid type;
  - extra key → `UNKNOWN_FIELD` (strict).
- [ ] **Step 2:** `yarn test save-course.dto` → FAIL.
- [ ] **Step 3: Implement.**
  - Entity column `price_vnd` + CK `ck_courses_price_vnd_range`.
  - `PUT /admin/courses/:courseId/price` → `toAdminCourseDto(await setPrice(...))`, errors `VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND`.
  - `setPrice` runs under `withCourseLock`; the same value means no write; otherwise update + `touchCourse`.
  - DTO mappers add `priceVnd`.
- [ ] **Step 4: Migration** `AddCoursePrice1793990100000`: `ADD "price_vnd" integer`, `ADD CONSTRAINT "ck_courses_price_vnd_range" CHECK ("price_vnd" BETWEEN 1000 AND 100000000)`. `down` reverses it.
- [ ] **Step 5:** unit PASS, typecheck clean.
- [ ] **Step 6: e2e (written).** Admin sets 499000 → `GET /courses/:slug` has `priceVnd: 499000`; `null` clears it; an editor gets 403; unknown course → 404.
- [ ] **Step 7: Commit** `feat(courses): price a course in VND`.

### Task 3: VNPAY toolkit (pure)

**Files:**
- Create in `src/modules/orders/vnpay/`:
  - `vnpay-signature.ts`;
  - `vnpay-dates.ts`;
  - `vnpay-payment-url.ts`;
  - `vnpay-ipn-decision.ts`;
  - a spec next to each.

**Interfaces:**
- Produces:
  - `canonicalQuery(params: Record<string,string>): string`: sorted keys, skips empty values, `urlencode(k)=urlencode(v)` joined by `&`. `urlencode` = `encodeURIComponent` + `%20→+` + `!'()*` percent-encoded.
  - `signVnpay(secret: string, params: Record<string,string>): string` (lowercase hex HMAC-SHA512 of `canonicalQuery`).
  - `verifyVnpay(secret: string, query: Record<string, unknown>): { valid: true; params: Record<string,string> } | { valid: false }`:
    - only string values whose key starts with `vnp_`;
    - an array value → invalid;
    - excludes `vnp_SecureHash` and `vnp_SecureHashType`;
    - compares with `timingSafeEqual`, case-insensitive.
  - `formatVnpayDate(at: Date): string` (GMT+7).
  - `normalizeClientIp(ip: string | null | undefined): string`.
  - `buildPaymentUrl(settings: VnpaySettings, order: { reference: string; amountVnd: number; createdAt: Date; expiresAt: Date }, clientIp: string): string`.
  - `VnpaySettings = { tmnCode; hashSecret; paymentUrl; returnUrl }`.
  - `decideIpn(order: { status: OrderStatus; amountVnd: number; expiresAt: Date } | null, params: Record<string,string>): IpnDecision`, where `IpnDecision = { kind: 'ack'; rspCode: '01'|'02'|'04' } | { kind: 'settle'; outcome: 'paid'|'failed' }`. The caller answers `00` after settling.
  - `IPN_MESSAGES: Record<'00'|'01'|'02'|'04'|'97'|'99', string>`.

- [ ] **Step 1: Failing tests.**
  - `canonicalQuery({ b: '2', a: 'x y', c: '' })` === `a=x+y&b=2`.
  - A fixed vector: `signVnpay('SECRET', {vnp_Amount:'49900000', vnp_TxnRef:'abc'})` equals the hex computed in the test with `createHmac('sha512','SECRET').update('vnp_Amount=49900000&vnp_TxnRef=abc')`.
  - Round trip: build a URL, parse it with `new URLSearchParams` into an object, and `verifyVnpay` is valid.
  - Flipping one char of `vnp_Amount` → invalid.
  - An array value → invalid.
  - Missing hash → invalid.
  - `formatVnpayDate(new Date('2026-11-07T17:30:00Z'))` === `'20261108003000'`.
  - `normalizeClientIp('::ffff:1.2.3.4')` === `'1.2.3.4'`; `'::1'` → `'127.0.0.1'`; `undefined` → `'127.0.0.1'`.
  - `decideIpn` cases:
    - null → `01`;
    - amount mismatch → `04`;
    - non-digit amount → `04`;
    - paid → `02`;
    - failed + a failure → `02`;
    - failed + `00`/`00` → settle paid (S14);
    - `00`/`00` → settle paid;
    - `24`/`02` → settle failed;
    - `00`/`01` → settle failed;
    - pending past `expiresAt` with `00`/`00` → settle paid.
  - The URL contains `vnp_Amount=49900000`, `vnp_Version=2.1.0` and `vnp_SecureHash=` last.
- [ ] **Step 2:** `yarn test vnpay` → FAIL.
- [ ] **Step 3:** Implement the signatures above.
- [ ] **Step 4:** `yarn test vnpay` → PASS.
- [ ] **Step 5: Commit** `feat(orders): add the VNPAY signing, dates and IPN decision toolkit`.

### Task 4: Payments config

**Files:**
- Modify: `src/config/env.schema.ts`, `src/config/load-config.ts`, `.env.example`, `test/support/create-test-app.ts`.
- Test: `src/config/load-config.spec.ts`.

**Interfaces:**
- Produces: `AppConfig.payments: Readonly<{ provider: 'vnpay'; vnpay: VnpaySettings } | { provider: 'disabled' }>`. `TestAppOptions.payments?` overrides it. The default test config is VNPAY with `tmnCode 'TESTTMN1'`, `hashSecret 'test-vnpay-secret'`, `paymentUrl 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'`, `returnUrl 'http://localhost:3000/khoa-hoc/thanh-toan/ket-qua'`.

- [ ] **Step 1: Failing tests.**
  - none set → `disabled`;
  - all four → `vnpay`;
  - three of four → `ConfigError` naming the missing variable;
  - a bad TMN code → error;
  - production + `http` return URL → error;
  - the error message never contains the secret value.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement. Rules as in spec §5.7. `.env.example` gets a commented VNPAY block with sandbox URLs and no values.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(config): add the VNPAY payment settings`.

### Task 5: Orders schema and the courses sales provider

**Files:**
- Create:
  - `src/modules/orders/order.entity.ts`;
  - `src/modules/courses/course-sales.ts` (`CourseSales`);
  - `src/database/migrations/1793990200000-CreateOrders.ts`.
- Modify:
  - `course-access-grant.entity.ts` (sources, `orderId`, CKs, partial UQ);
  - `courses.module.ts` (`exports: [CourseSales]`);
  - `dto/course-access.dto.ts` (enum widens).
- Test: e2e `test/orders-schema.e2e-spec.ts` (written).

**Interfaces:**
- Produces:
  - `Order` entity, columns as spec §5.2: `ORDER_STATUSES = ['pending','paid','failed']`, `OrderStatus`.
  - `CourseSales`:
    - `findForSale(courseId): Promise<{ id; slug; title; priceVnd: number | null } | null>` (published only);
    - `findSummaries(ids: string[]): Promise<Map<string, { id; slug; title }>>` (any status);
    - `hasActiveAccess(userId, courseId): Promise<boolean>`;
    - `grantForPurchase(manager: EntityManager, input: { userId; courseId; orderId }): Promise<void>`.
  - `GRANT_SOURCES = ['admin','purchase']`.
  - The partial index predicate constant `PURCHASE_GRANT_PREDICATE = "\"source\" = 'purchase'"`.

- [ ] **Step 1: Entities.**
  - `Order` with every CK, UQ, index and FK named as spec §5.2. FKs by entity name `'User'` and `'Course'`.
  - Grants: `@Index('uq_course_access_grants_order_id_purchase', ['orderId'], { unique: true, where: PURCHASE_GRANT_PREDICATE })`, FK `'Order'`, CK `ck_course_access_grants_purchase_has_order`, and the source CK widened.
- [ ] **Step 2: `CourseSales`.**
  - It reads `Course` through its repository and delegates `hasActiveAccess` to `CourseAccessService`.
  - `grantForPurchase` = `manager.insert(CourseAccessGrant, { userId, courseId, orderId, source: 'purchase', grantedByUserId: null })`.
- [ ] **Step 3: Migration** `CreateOrders1793990200000`.
  - `CREATE TABLE "orders"` in the generated style;
  - the three indexes;
  - FKs `fk_orders_user_id`, `fk_orders_course_id`;
  - grants:
    - `ADD "order_id" uuid`;
    - drop and re-add `ck_course_access_grants_source`;
    - add `ck_course_access_grants_purchase_has_order`;
    - hand-written `CREATE UNIQUE INDEX … WHERE "source" = 'purchase'`;
    - `fk_course_access_grants_order_id`.
  - `down` reverses in order.
- [ ] **Step 4:** `yarn typecheck && yarn build` → clean.
- [ ] **Step 5: e2e (written).** Schema invariants:
  - `reference` format (`23514`);
  - `paid` without `paid_at` (`23514`);
  - a purchase grant without `order_id` (`23514`);
  - two purchase grants for one order (`23505` on `uq_course_access_grants_order_id_purchase`);
  - an admin grant with an `order_id` (`23514`).
- [ ] **Step 6: Commit** `feat(orders): add the orders table and purchase grants`.

### Task 6: Checkout, order status, IPN, admin list

**Files:**
- Create in `src/modules/orders/`:
  - `orders.module.ts`, `orders.errors.ts`;
  - `orders.service.ts`, `vnpay-ipn.service.ts`;
  - `orders.controller.ts`, `vnpay-ipn.controller.ts`, `admin-orders.controller.ts`;
  - `dto/order.dto.ts`, `dto/create-order.dto.ts`, `dto/admin-orders-query.dto.ts`.
- Modify: `src/app.module.ts`.
- Test: e2e `test/orders.e2e-spec.ts`, `test/vnpay-ipn.e2e-spec.ts`, `test/admin-orders.e2e-spec.ts` (written); OpenAPI e2e expectations if it lists routes.

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  - `OrdersService.checkout(userId, courseId, clientIp): Promise<{ order: OrderView; paymentUrl: string }>`;
  - `OrdersService.getOwn(userId, reference): Promise<OrderView>`;
  - `OrdersService.listForAdmin(query): Promise<{ items: AdminOrderView[]; totalItems }>`;
  - `VnpayIpnService.handle(query: Record<string, unknown>): Promise<{ RspCode: string; Message: string }>`, which never throws;
  - `OrderRateLimitedError(retryAfterSeconds)`.

- [ ] **Step 1: e2e specs (written, not run).**
  - Checkout:
    - 401 without a session;
    - 403 without the CSRF header;
    - unknown course 404;
    - draft course 404;
    - no price → 409 `COURSE_NOT_FOR_SALE`;
    - owned → 409 `COURSE_ALREADY_OWNED`;
    - payments disabled → 503;
    - success → 201 with `order.status 'pending'`, `amountVnd 499000`, and a `paymentUrl` starting with the sandbox URL that `verifyVnpay` accepts;
    - the 6th order within 15 min → 429 with `Retry-After`.
  - `GET /orders/:reference`: own 200; another user's 404; malformed 400.
  - IPN, with params signed by the test secret: the six SIT cases + duplicate.
    - success → `{RspCode:'00'}`, the grant exists, `/learn/courses/:slug` → 200;
    - two concurrent success IPNs → one grant, codes `{00,02}`.
  - Admin list: admin 200 paginated newest first; editor 403.
- [ ] **Step 2: Implement.**
  - **Services:**
    - Checkout follows the spec §5.4 order. The throttle counts orders with `created_at > now() - 15 min` and `Retry-After` = seconds until the oldest of the 5 leaves the window.
    - `reference` = `id.replaceAll('-', '')`, with the id generated in code as `uuidv7`. TypeORM inserts `id` explicitly. Check how existing code gets a uuid before insert; if none, insert and then derive `reference` in the same insert with `RETURNING`: `INSERT … VALUES (..., replace(uuidv7()::text, '-', ''))` won't share the id, so generate the id in SQL with a CTE, or use `crypto.randomUUID()` and keep `id` as the default `uuidv7()` with `reference` = random hex.
    - **Decision:** `reference` = `randomUUID().replaceAll('-','')` (random v4 hex, unguessable), independent of `id`.
    - IPN: verify → `dataSource.transaction(manager => …)` with `manager.findOne(Order, { where: { reference }, lock: { mode: 'pessimistic_write' } })` → `decideIpn` → update + `grantForPurchase` → map to a code. Any throw is logged (reference + error name only) → `99`.
  - **Controllers:**
    - IPN: `@Public() @RawResponse() @Get('payments/vnpay/ipn')`, `res.status(200).json(ack)`.
    - Orders: `@Post('orders')` 201 envelope; `@Get('orders/:reference')` with `no-store`.
    - Admin: `@Roles('admin') @Get('admin/orders')`.
  - **Wiring:** register `OrdersModule` in `AppModule`.
- [ ] **Step 3:** `yarn typecheck && yarn lint && yarn test` → clean / PASS (unit only).
- [ ] **Step 4: Commit** `feat(orders): add VNPAY checkout, the IPN and the order views`.

### Task 7: Docs

**Files:**
- Modify:
  - `docs/api-contract.md` (routes, DTOs, codes, the IPN exception, xuan-web deltas);
  - `docs/architecture.md` (§4 deps, new AD, §15 row);
  - `docs/database.md` §12 (`orders` map, column additions; status **designed, awaiting owner-approved runs**);
  - `docs/data-model.md`;
  - `docs/development-workflow.md` §3.5 (delegation row);
  - `CLAUDE.md` status.

- [ ] **Step 1:** Write the changes; cite the spec, never restate the rules.
- [ ] **Step 2:** `yarn format:check` (or the project's equivalent) → clean.
- [ ] **Step 3: Commit** `docs: record the course sales and VNPAY design, contract and schema`.

### Task 8: Verification, review, PR, owner packet

- [ ] **Step 1:** `yarn lint && yarn typecheck && yarn build && yarn test` → all pass (observed).
- [ ] **Step 2:** `xuan-api-architecture-review` over the branch, then a fresh whole-branch review subagent. Fix Critical/Important findings.
- [ ] **Step 3:** Push; open the PR to `dev` with the §9.3 body. Database section: "not run, awaiting owner approval". **Do not merge.**
- [ ] **Step 4:** Write the owner packet (exact commands, targets, expected results) in the PR and the handoff report `docs/reports/2026-11-07-course-sales-handoff.md`:
  - `yarn test:db-guard`;
  - `xuan_test`: `migration:run`, `\d+`, revert ×3, run, second `migration:generate` empty;
  - e2e;
  - `xuan_dev`: run;
  - the Production steps later.
