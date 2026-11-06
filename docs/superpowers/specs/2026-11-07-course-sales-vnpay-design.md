# Course sales with VNPAY: design

**Status:** **Delegated by the owner (2026-11-07)**: "write the design docs, review then code it by yourself" (the owner was unavailable for clarification). Decisions are labelled **[Owner]** (stated by the owner) or **[Claude]** (my call under that delegation, open to the owner's override at PR review).

**Builds on:**
- the course platform design (`2026-10-17-course-platform-design.md`): §5.4 is the blueprint for purchase grants, §8 covers video, §10.5 is "published ≠ for sale";
- the discovery report `discovery/2026-11-07-vnpay-course-payment-discovery.md` (local), which holds the VNPAY facts and sources.

**Not authorized by this delegation:**
- database operations: every `migration:*` command and e2e run needs the owner's approval each time (`development-workflow.md` §3.5, last row);
- Production, provider credentials, merging into `dev` (merging deploys Production), refunds through the API.

## 1. Outcome

A signed-in visitor opens the first course (`workflow-edit-video-youtube`) and clicks "Đăng ký".
1. xuan-api creates an order and returns a signed VNPAY payment URL.
2. The browser goes to VNPAY's hosted page, where the student pays by VNPAY-QR (or ATM/card).
3. VNPAY calls our **IPN** endpoint. We verify it and, in one transaction, mark the order paid and insert a **purchase grant**.
4. VNPAY redirects the student to xuan-web's result page, which polls the order and then shows the course. Its lessons now play through the existing learner routes, as **YouTube unlisted** embeds.

**In scope:**
- YouTube-unlisted lesson videos;
- a course price;
- the `orders` module: checkout, IPN, the order status for the buyer, the admin order list;
- purchase grants; config; docs; OpenAPI; tests.

**Out of scope:**
- refunds through the API (manual in the VNPAY portal) and revoking purchase grants via the API;
- `querydr` reconciliation; e-invoices; discount codes;
- several prices or currencies; xuan-web changes (separate repo).

## 2. Decisions

| ID | Decision | Source |
|---|---|---|
| S1 | The first course costs **499.000 VND**. Price is **data** set by an admin, not code | [Owner] |
| S2 | Lesson videos may be **YouTube unlisted** for now (Vimeo is an extra cost the business isn't ready for). Vimeo stays supported. The leak risk is accepted (§6) | [Owner] |
| S3 | Payment = VNPAY Payment Gateway v2.1.0, redirect model; HMAC-SHA512 | [Owner] (signed up), VNPAY techspec |
| S4 | **Only the IPN changes order state and grants access.** The return page only reads | [Claude]; VNPAY model; SIT grades the IPN |
| S5 | The IPN route answers VNPAY's `{ RspCode, Message }` JSON with HTTP 200 for every outcome. It is a documented exception to I11/I13, through the existing `@RawResponse` opt-out (AD6 precedent) | [Claude] (discovery Q2, forced by VNPAY) |
| S6 | Refunds are manual in the VNPAY merchant portal. Revoking a purchase grant through the API is **deferred** | [Claude] (discovery Q5) |
| S7 | Where the SIT runs (Production with sandbox keys, a tunnel, or a preview) is an ops decision for the owner. The code works with any of them | [Owner, pending] |
| S8 | Signature canonical form = **PHP-`urlencode`-compatible encoding** of keys and values, sorted by key, joined `k=v&…`, as in VNPAY's current official demos. **Must be confirmed with one sandbox payment before go-live** (the PDF's samples disagree) | [Claude] |
| S9 | No `expired` order state. A successful IPN after `vnp_ExpireDate` is still honoured, because the money was taken | [Claude] |
| S10 | Each checkout creates a new order. Earlier pending orders stay payable. Two paid orders for one course give two purchase grants (harmless, OD-1) and are refunded by hand | [Claude] |
| S11 | Checkout is limited to **5 orders per user per 15 minutes** (`429 RATE_LIMITED`) | [Claude] |
| S13 | **A purchase grant is unconditional.** The paid order is the authority: the money was taken. `grantForPurchase` checks neither the course's status or price nor existing grants. A buyer who already holds an admin grant gets a second, purchase grant (OD-1) | [Claude] (builder check) |
| S14 | **`failed` isn't terminal for a success.** A success IPN for a `failed` order settles it `paid` and grants access: a charged buyer is never left without access. A failure IPN for a `failed` order, and any IPN for a `paid` order, answers `02` | [Claude] (builder check) |
| S15 | Migrations are **hand-written** in TypeORM's generated style, because `migration:generate` needs a database the delegation doesn't cover. The owner's packet ends with a second `migration:generate`, which must be empty. Baseline: local `xuan_dev` has every migration through `CreateContactSubmissions` (verified 2026-11-03) | [Claude] (builder check) |
| S12 | One outcome, one branch (`feat/course-sales-vnpay`): the video provider, price and orders together. Separate branches would need stacking, because nothing can merge until the owner approves the database steps | [Claude] (`xuan-git-branch-cohesion`) |

## 3. Lesson videos: YouTube unlisted (S2)

**Storage (`course_lessons`, additive):**
- `youtube_video_id varchar(11) NULL`, CK `ck_course_lessons_youtube_video_id_format`: `"youtube_video_id" ~ '^[A-Za-z0-9_-]{11}$'`.
- CK `ck_course_lessons_one_video`: `"vimeo_video_id" IS NULL OR "youtube_video_id" IS NULL`.
- `ck_course_lessons_published_has_video` is **replaced** (same name): `"status" <> 'published' OR "vimeo_video_id" IS NOT NULL OR "youtube_video_id" IS NOT NULL`. This relaxes it, so no existing row can violate it.

**Admin contract (additive):**
- `SaveCourseLessonDto` gains `youtubeVideoId?` (11 chars `[A-Za-z0-9_-]`). It's cleared when omitted, like the other optional fields.
- `videoId` (Vimeo) and `youtubeVideoId` together → `400 INVALID` at `youtubeVideoId`.
- `privacyHash` stays Vimeo-only: with `youtubeVideoId` → `400 INVALID` at `privacyHash`, unchanged rule "a privacy hash needs a (Vimeo) video id".
- `AdminCourseLessonDto` gains `youtubeVideoId: string | null`.
- `LESSON_VIDEO_MISSING` now means "neither id". Its message becomes "A published lesson needs a video."

**Learner contract:**
- `LessonPlaybackDto.video` becomes `LessonVideoDto` = `{ provider: 'vimeo' | 'youtube', videoId, privacyHash: string | null }`.
- For YouTube, `videoId` is the 11-character id and `privacyHash` is `null`.
- The component is **renamed** from `VimeoVideoDto` (I19). No consumer renders it yet: xuan-web only has it in its generated snapshot. It's recorded as a contract delta.

## 4. Price (S1)

**Storage:**
- `courses.price_vnd integer NULL`, CK `ck_courses_price_vnd_range`: `"price_vnd" BETWEEN 1000 AND 100000000`.
- 1.000đ is a practical floor. 100 million VND keeps `vnp_Amount` (×100) far below its 12 digits.
- `NULL` = **not for sale**. This settles the course spec §10.5 "availability" deferral: no separate flag.

**Admin:**
- `PUT /admin/courses/:courseId/price`, body `SaveCoursePriceDto { priceVnd: integer | null }` (strict, required key) → `AdminCourseDto`.
- It runs under the course lock (L1) and moves `courses.updated_at`. Setting the same value is a no-op.
- A separate route, so `SaveCourseDto`'s full-replacement semantics don't change.

**Wire:**
- `CourseSummaryDto` (and so `CourseDto` and the learner DTOs that embed it) gains `priceVnd: number | null`.
- `AdminCourseSummaryDto` (and `AdminCourseDto`) gains `priceVnd`.
- xuan-web shows "499.000đ" and the button when it's non-null, and "Chưa mở đăng ký" otherwise.

## 5. Orders and VNPAY

### 5.1 Module

New `src/modules/orders/` (`OrdersModule`).

**What it owns:**
- the `orders` table (I1);
- a pure `vnpay/` toolkit: canonical encoding, sign/verify, GMT+7 dates, payment-URL builder, IPN decision;
- `OrdersService` (checkout, the buyer's read, the admin list);
- `VnpayIpnService`.

**What it imports:**
- `CoursesModule`, for one new exported provider, `CourseSales`:
  - `findForSale(courseId)`: published course `{ id, slug, title, priceVnd }` or null;
  - `findSummaries(ids)`;
  - `hasActiveAccess(userId, courseId)`;
  - `grantForPurchase(manager, { userId, courseId, orderId })`.
- `UsersModule`, for `UserProfilesReader` (the admin list's buyer profile).

Allowed dependencies (architecture §4) gain `orders → courses, users`.

**Cross-module transaction** (architecture §15, deferred until now):
- `orders` opens the transaction and passes its `EntityManager`.
- `grantForPurchase` writes **only** through that manager (I8).
- The courses module still owns the grant rows and their rules. `orders` never touches `course_access_grants` directly (I1).

### 5.2 `orders` table

| Column | Type | Null | Default | Constraint / why |
|---|---|---|---|---|
| `id` | uuid | no | `uuidv7()` | PK `pk_orders` |
| `reference` | varchar(32) | no | — | UQ `uq_orders_reference`; CK `ck_orders_reference_format` `^[0-9a-f]{32}$`. The id's hex without dashes; sent as `vnp_TxnRef` (alphanumeric only) and used in the buyer's URL |
| `user_id` | uuid | no | — | FK `fk_orders_user_id` → `users` RESTRICT (by entity name, AD14) |
| `course_id` | uuid | no | — | FK `fk_orders_course_id` → `courses` RESTRICT (by entity name) |
| `amount_vnd` | integer | no | — | CK `ck_orders_amount_vnd_positive` `> 0`. The price snapshot at checkout; the IPN compares against it |
| `status` | varchar(16) | no | `'pending'` | CK `ck_orders_status` `IN ('pending','paid','failed')` |
| `expires_at` | timestamptz | no | — | = `vnp_ExpireDate` (created + 15 min). Display only (S9) |
| `paid_at` | timestamptz | yes | — | CK `ck_orders_paid_pair` `(status = 'paid') = (paid_at IS NOT NULL)` |
| `vnp_transaction_no` | varchar(15) | yes | — | VNPAY's transaction id (support, refunds) |
| `vnp_response_code` | varchar(2) | yes | — | From the IPN |
| `vnp_transaction_status` | varchar(2) | yes | — | From the IPN |
| `vnp_bank_code` | varchar(20) | yes | — | |
| `vnp_card_type` | varchar(20) | yes | — | |
| `vnp_bank_tran_no` | varchar(255) | yes | — | |
| `vnp_pay_date` | varchar(14) | yes | — | Raw `yyyyMMddHHmmss` GMT+7 as VNPAY sent it |
| `created_at`, `updated_at` | timestamptz | no | `now()` | D27 |

- CK `ck_orders_settled_has_result`: `status = 'pending' OR vnp_response_code IS NOT NULL`. A settled order always records what VNPAY said.
- Indexes:
  - `ix_orders_user_id_created_at` (rate limit, buyer FK);
  - `ix_orders_course_id` (FK);
  - `ix_orders_created_at_id` (admin list, newest first).

### 5.3 `course_access_grants` (expand-only, course spec §5.4)

- `order_id uuid NULL`, FK `fk_course_access_grants_order_id` → `orders` RESTRICT (by entity name).
- `ck_course_access_grants_source` is **replaced**: `"source" IN ('admin','purchase')`.
- CK `ck_course_access_grants_purchase_has_order`: `("source" = 'purchase') = ("order_id" IS NOT NULL)`.
- Partial UQ `uq_course_access_grants_order_id_purchase` on `(order_id) WHERE source = 'purchase'`. One grant per order, so a replayed IPN can't double-grant. The predicate is hand-written, because generate ignores it (spike S8).
- Existing behaviour is unchanged:
  - the admin upsert and its partial index;
  - admin revoke still closes only admin grants (OD-7 stays deferred);
  - `hasActiveAccess` already counts any source.
- `CourseAccessGrantDto.source` widens to `'admin' | 'purchase'`. A purchase grant has `grantedBy: null`.

### 5.4 Endpoints

| Route | Access | Request → response | Errors |
|---|---|---|---|
| `POST /orders` | signed in, CSRF | `CreateOrderDto { courseId: uuid }` → **201** `CheckoutDto { order: OrderDto, paymentUrl }` | `400`, `401`, `403` (CSRF), `404` (unknown or unpublished course), `409 COURSE_NOT_FOR_SALE`, `409 COURSE_ALREADY_OWNED`, `429 RATE_LIMITED`, `503 PAYMENTS_UNAVAILABLE` |
| `GET /orders/:reference` | signed in; own orders only | `OrderReferenceParam` → `OrderDto`, `Cache-Control: no-store` | `400`, `401`, `404` (unknown or someone else's) |
| `GET /payments/vnpay/ipn` | `@Public`, VNPAY only (signature) | the VNPAY query → **200** `{ RspCode, Message }` raw (S5) | none: every failure is an `RspCode` |
| `GET /admin/orders` | admin | `AdminOrdersQuery { page, pageSize, status? }` → paginated `AdminOrderDto`, newest first | `400`, `401`, `403` |
| `PUT /admin/courses/:courseId/price` | admin | §4 | `400`, `401`, `403`, `404` |

**DTOs:**
- `OrderDto` = `{ id, reference, status: 'pending'|'paid'|'failed', amountVnd, course: OrderCourseDto { id, slug, title }, createdAt, expiresAt, paidAt: string|null, failureCode: string|null }`.
  - `failureCode` is `vnp_response_code` when `failed`, otherwise `null`.
  - xuan-web maps it to a Vietnamese hint (discovery §2.4).
- `AdminOrderDto` = `OrderDto` + `{ user: OrderUserDto { id, displayName, avatarUrl }, vnpTransactionNo, vnpBankCode, vnpCardType, vnpPayDate }`.
- `CheckoutDto` = `{ order: OrderDto, paymentUrl }`.

**Error codes** (`orders.errors.ts`):

| Code | Status | Message |
|---|---|---|
| `COURSE_NOT_FOR_SALE` | 409 | "This course isn't open for purchase." |
| `COURSE_ALREADY_OWNED` | 409 | "You already have access to this course." |
| `PAYMENTS_UNAVAILABLE` | 503 | "Online payment is temporarily unavailable." |

`RATE_LIMITED` is the baseline code, with `Retry-After`.

**Checkout steps:**
1. Throttle check.
2. `findForSale`: null → 404.
3. `priceVnd === null` → 409 `COURSE_NOT_FOR_SALE`.
4. `hasActiveAccess` → 409 `COURSE_ALREADY_OWNED`.
5. Payments disabled → 503 `PAYMENTS_UNAVAILABLE`. It's checked after the course checks, so a 404 stays a 404.
6. Insert the order (`pending`, `amount_vnd = priceVnd`, `expires_at = now + 15 min`).
7. Build the URL.

### 5.5 Payment URL (techspec §2.5.3.1)

| Param | Value |
|---|---|
| `vnp_Version` | `2.1.0` |
| `vnp_Command` | `pay` |
| `vnp_TmnCode` | config |
| `vnp_Amount` | `amount_vnd × 100` |
| `vnp_CurrCode` | `VND` |
| `vnp_TxnRef` | `reference` |
| `vnp_OrderInfo` | `Thanh toan khoa hoc ` + `reference`. ASCII only, so the encoding risk (S8) is minimal |
| `vnp_OrderType` | `other` |
| `vnp_Locale` | `vn` |
| `vnp_ReturnUrl` | config |
| `vnp_IpAddr` | `req.ip`, normalized: strip `::ffff:`; anything shorter than 7 characters (e.g. `::1`) → `127.0.0.1` |
| `vnp_CreateDate` / `vnp_ExpireDate` | `yyyyMMddHHmmss`, **GMT+7**, computed from UTC (the server runs in UTC) |
| `vnp_BankCode` | omitted (VNPAY's method picker, QR first) |

`paymentUrl` = `VNPAY_PAYMENT_URL + '?' + canonical(params) + '&vnp_SecureHash=' + hmacSha512Hex(secret, canonical(params))`.

### 5.6 IPN (S4, S5; SIT cases 1–6)

Params come from the query string, and every `vnp_*` key except `vnp_SecureHash` and `vnp_SecureHashType` is signed. The decision is a **pure function** of the verified params and the locked order, so it can be unit-tested.

```text
signature invalid or missing                         → 97 Invalid Checksum
BEGIN
  SELECT … FROM orders WHERE reference = vnp_TxnRef FOR UPDATE
    none, or vnp_TxnRef malformed                    → 01 Order Not Found
  vnp_Amount ≠ amount_vnd × 100 (or not digits)       → 04 Invalid amount
  status = paid, or status = failed and not a success → 02 Order already confirmed (S14)
  vnp_ResponseCode = '00' AND vnp_TransactionStatus = '00'   (pending or failed)
        → status paid, paid_at now(), vnp_* stored; CourseSales.grantForPurchase(manager, …)
  else  → status failed, vnp_* stored
COMMIT                                                → 00 Confirm Success
any unexpected error → ROLLBACK                       → 99 Unknown error (VNPAY retries)
```

- **Concurrency:** `FOR UPDATE` serializes duplicate IPNs. The second sees `paid` and answers `02`. The partial UQ on `order_id` is the backstop. If it ever fires, the transaction rolls back and the answer is `99`; the state stays consistent.
- **Logging (I17):** reference, `RspCode`, `vnp_ResponseCode` and `vnp_TransactionStatus` only. Never the query, the signature or the secret.
- **OpenAPI:** the route is **excluded** (`@ApiExcludeEndpoint`), like Google's sign-in callback, the other provider-to-API redirect target. VNPAY's query and the `{ RspCode, Message }` answer aren't a xuan-web contract; this spec and `api-contract.md` document them instead.

### 5.7 Config (I4, I5)

| Variable | Rule |
|---|---|
| `VNPAY_TMN_CODE` | `^[A-Za-z0-9]{8}$` |
| `VNPAY_HASH_SECRET` | min 1; secret, never printed |
| `VNPAY_PAYMENT_URL` | URL; `https` |
| `VNPAY_RETURN_URL` | URL; `https` in production |

- All four or none (`Set all four VNPAY variables, or none.`).
- None → `payments: { provider: 'disabled' }`, and checkout answers `503`. The API still deploys before keys exist.
- The IPN URL (`https://api.xuancreative.com/payments/vnpay/ipn` in Production) is registered with VNPAY per terminal. It isn't a request param.
- With payments disabled, the IPN answers `97`: there's no secret to verify with.

## 6. Security notes

- **Trust:**
  - the IPN is trusted only through the HMAC (constant-time compare over equal-length buffers) and the amount check against our own snapshot;
  - the return page's query is never trusted;
  - `vnp_TmnCode` is covered by the signature.
- **The IPN is a mutating GET.** The CSRF guard passes GET by design. The protection here is the signature, not the method or CORS.
- **YouTube unlisted (S2, accepted risk):**
  - the backend still returns the id only to students with an active grant (course spec §7);
  - but an unlisted id plays on youtube.com for anyone who has it;
  - YouTube can't restrict embeds to our domain;
  - the remedy, when the business is ready, is moving lessons to Vimeo (already supported: switch the lesson's id field).
- **Course spec §8.4 applies, more strongly:** revocation can't undo a delivered id.

## 7. Verification plan

| Level | Covers | Runs |
|---|---|---|
| Unit | encoding and signing (fixed vector, tamper → invalid, `+` for spaces), GMT+7 formatting across the UTC midnight boundary, IP normalization, the IPN decision table (all SIT cases), the save-lesson schema (YouTube rules), the price schema, config all-or-none | tonight (no database) |
| e2e on `xuan_test` | schema invariants (CKs, partial UQ); checkout refusals and success; the IPN's 6 SIT cases + 99; grant appears and playback turns 200 with a YouTube video; duplicate IPN → one grant; **two concurrent IPNs → one grant**; another user's order → 404; admin list; price route; OpenAPI | **after the owner approves the database packet** |
| Sandbox | S8 confirmed by one NCB test-card payment; then VNPAY's SIT | owner, with sandbox keys |

## 8. Docs touched

- `api-contract.md`: endpoints, DTOs, codes, the IPN exception, contract deltas for xuan-web.
- `architecture.md`:
  - §4: `orders → courses, users`;
  - a new **AD**: the orders module, the cross-module transaction via a passed `EntityManager`, the IPN envelope exception;
  - §15: the cross-module transactions row resolved.
- `database.md` §12: the `orders` map; additions to `courses`, `course_lessons` and `course_access_grants`.
- `data-model.md`: Order/Payment CONFIRMED; the lesson video provider.
- `development-workflow.md` §3.5: a delegation row for this work.
- CLAUDE.md status line.
