# Course sales with VNPAY: handoff (2026-11-07)

**For:** the owner (database approval, VNPAY onboarding, release order) and the xuan-web implementer (§5).
**Branch:** `feat/course-sales-vnpay`, PR to `dev`, **not merged**. Merging deploys Production (Vercel builds `dev`), and Production's database doesn't have the new columns yet (§4).
**Design:** `docs/superpowers/specs/2026-11-07-course-sales-vnpay-design.md`. Every **[Claude]** decision there can be overridden in the PR review.
**Plan:** `docs/superpowers/plans/2026-11-07-course-sales-vnpay.md`.

## 0. Status at a glance

| Item | State |
|---|---|
| YouTube-unlisted lessons, course price, orders, checkout, IPN, purchase grants, admin order list | Code done |
| `yarn lint`, `yarn typecheck`, `yarn build`, `yarn format:check`, `yarn test` (602 unit tests) | Pass (observed) |
| Entity metadata vs the three hand-written migrations | Matches name for name (built offline) |
| Nest DI of the new providers | Resolves (compiled offline) |
| Migrations on `xuan_test` / `xuan_dev` | **Done 2026-11-08** (owner-approved, §1a): run, catalog matches the map, revert ×3 and re-run, empty second generate on both; `xuan_dev` backed up first, existing data and schema unchanged |
| e2e (new: orders, IPN SIT cases + races, schema; updated: courses, learning, OpenAPI) | **724/724 pass** on `xuan_test` (40 files), first run |
| Duplicate-charge guard (§6.1, spec S16): one payable order per user and course, reuse, `409 ORDER_PENDING` | **Code done 2026-11-08** (owner-approved); unit tests pass; e2e: see the PR |
| Signature encoding vs VNPAY's real server (spec S8) | **Unverified**: needs sandbox keys (§3, §7) |
| VNPAY SIT, production keys, Production migration | Not started (§3, §4) |

## 1. Approval packet: local databases

**One-line approval you can give:**

> Approved: run the course sales packet in §1 on `xuan_test`, then `xuan_dev`, provided the preflight matches: target `localhost:5433` Docker, exactly the three pending migrations `AddLessonYouTubeVideo1793990000000`, `AddCoursePrice1793990100000`, `CreateOrders1793990200000`. If the target, the pending list or the SQL differs, stop.

### What runs

**`xuan_test`** (Git Bash; `NODE_ENV=test` makes the config read `.env.test`):

```bash
NODE_ENV=test yarn test:db-guard              # proves the target is a *_test database
NODE_ENV=test yarn migration:show             # expect exactly the 3 new migrations pending
NODE_ENV=test yarn migration:run
docker compose exec db psql -U xuan_app xuan_test -c '\d+ orders' -c '\d+ course_access_grants' -c '\d+ course_lessons' -c '\d+ courses'
NODE_ENV=test yarn migration:revert           # ×3, then run again (reversibility)
NODE_ENV=test yarn migration:run
NODE_ENV=test yarn migration:generate src/database/migrations/ShouldBeEmpty   # expect "No changes in database schema were found"
yarn test:e2e                                 # all suites, including the new ones
```

**`xuan_dev`** (protected, because two migrations replace an existing CHECK, a relaxed one and a widened one):

```bash
docker compose exec db pg_dump -U xuan_app -Fc xuan_dev > .superpowers/sdd/xuan_dev-before-course-sales.dump   # git-ignored backup
yarn migration:show                           # expect the same 3 pending
yarn migration:run
yarn migration:generate src/database/migrations/ShouldBeEmpty   # expect no changes
```

### What they change

| Migration | Change |
|---|---|
| `AddLessonYouTubeVideo` | `course_lessons` + `youtube_video_id`, 2 CHECKs; `ck_course_lessons_published_has_video` replaced (relaxed) |
| `AddCoursePrice` | `courses` + `price_vnd`, 1 CHECK |
| `CreateOrders` | new `orders` table; `course_access_grants` + `order_id` (FK), 1 CHECK, 1 partial unique index; `ck_course_access_grants_source` replaced (widened to `admin`, `purchase`) |

No existing row is modified, and no existing row can violate the new or replaced constraints.

### Rollback

`migration:revert` ×3. Each `down()` refuses loudly rather than deleting data, if a purchase grant or a published YouTube-only lesson exists.

## 1a. Packet result (2026-11-08)

**`xuan_test`:**
- **Preflight:** guard passed; target `localhost:5433` → Docker `xuan-postgres` (PostgreSQL 18.6), database `xuan_test`. Exactly the three migrations were pending.
- **Run and inspect:** `migration:run` succeeded. The catalog matches `database.md` §12: columns, every CHECK, FK and unique, both partial-index predicates.
- **Reversibility:** `migration:revert` ×3, then run again.
- **Second `migration:generate`:** "No changes in database schema were found".
- **`yarn test:e2e`:** 40 files, **724 tests passed**, including the six SIT cases, duplicate IPNs and two concurrent IPNs.

**`xuan_dev`:**
- **Preflight:** the same Docker server, database `xuan_dev`, and the same three migrations pending.
- **Backup:** `pg_dump` saved to `.superpowers/sdd/xuan_dev-before-course-sales.dump` (git-ignored, 56 KB). `pg_restore --list` reads 17 table-data entries.
- **Fingerprints taken before the run:** row count and content hash of each of the 17 tables, plus a hash of every pre-existing column.
- **Run:** `migration:run` succeeded, and the second generate is empty.
- **After the run:** only `migrations` (11 → 14 rows) and the new, empty `orders` table differ. Every other table and the pre-existing column hash are unchanged. Constraint and index sets are identical to `xuan_test`.

**Environment note:** Docker Desktop wasn't running. It was started, along with the existing `db` container (`docker compose start db`). Nothing was recreated, and no volume was touched.

## 2. What the backend does now

**Price:**
- `PUT /admin/courses/:courseId/price { priceVnd: 499000 }` (admin).
- `priceVnd` appears on `GET /courses` and `GET /courses/:slug`.
- `null` means not for sale.

**Lesson video:**
- The admin lesson save accepts `youtubeVideoId` (the unlisted video's 11-character id from `youtube.com/watch?v=<id>`) instead of `videoId` (Vimeo).
- Learner playback returns `video: { provider: 'youtube', videoId, privacyHash: null }`.

**Checkout, `POST /orders { courseId }`** (signed in, CSRF header): `201 { order, paymentUrl }`.

**VNPAY IPN, `GET /payments/vnpay/ipn`:**
- Verifies the signature, locks the order, checks the amount.
- In one transaction: marks the order `paid` and inserts the purchase grant.
- The student can then open `/learn/courses/:slug`.

**Order status, `GET /orders/:reference`:** for the result page.

**Admin, `GET /admin/orders`:** for reconciliation with the VNPAY portal.

## 3. VNPAY onboarding (owner)

1. **Sandbox keys:** VNPAY's onboarding email has `vnp_TmnCode` and `vnp_HashSecret` for the sandbox. Put them in your local `.env` yourself:

   ```
   VNPAY_TMN_CODE=<8 chars>
   VNPAY_HASH_SECRET=<secret>
   VNPAY_PAYMENT_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html
   VNPAY_RETURN_URL=http://localhost:3000/khoa-hoc/thanh-toan/ket-qua
   ```

   Don't paste them into chat.
2. **Signature check (S8, the go-live gate):**
   - Check out once locally and open `paymentUrl`.
   - If VNPAY shows its payment page instead of a signature error ("Sai chữ ký"), the encoding is right.
   - Pay with the NCB test card from VNPAY's sandbox instructions (card number, name, date and OTP are in their email or demo page).
3. **IPN reachability:**
   - VNPAY must reach the IPN over public HTTPS. For local tests: `cloudflared tunnel --url http://localhost:4000` (no account needed).
   - Register `<tunnel or API host>/payments/vnpay/ipn` as the terminal's IPN URL in VNPAY's sandbox merchant admin, or send it to VNPAY.
   - Where the SIT runs is your call (spec S7): a tunnel, or Production with sandbox keys and no price set.
4. **SIT:** make ≥ 2 sandbox payments (stop one at OTP, per `VNPAY SIT.docx`). VNPAY replays its 6 cases against the IPN. The backend answers exactly `00`, `00`, `01`, `02`, `04` and `97`, as their script expects.
5. **Production keys:** after the SIT passes, VNPAY issues the production terminal. Set the four variables in Vercel Production with `VNPAY_PAYMENT_URL=https://pay.vnpay.vn/vpcpay.html` (confirm with VNPAY's email) and an `https` return URL on xuancreative.com. Register `https://api.xuancreative.com/payments/vnpay/ipn` as the production IPN URL.

## 4. Release order (Production)

1. You approve, then the Production migration runs:

   ```bash
   (set -a; . ./.env.production.local; set +a; yarn migration:show && yarn migration:run)
   ```

   It's additive and safe for the **old** code too: no column the old code needs disappears, and the replaced CHECKs only relax or widen. So it goes **before** the merge.
2. Merge the PR into `dev`. Vercel deploys.
3. Without VNPAY variables, checkout answers `503 PAYMENTS_UNAVAILABLE`, and nothing else changes for visitors until a price is set.
4. Upload the 12 lessons' YouTube ids and publish them. Then, once VNPAY production is live, set the price to 499000.

## 5. xuan-web notes

The contract is in `docs/api-contract.md` "Course sales" and delta 22.

**Course page:**
- Show `priceVnd` as "499.000đ" plus "Đăng ký" when non-null, and "Chưa mở đăng ký" when null.
- If the visitor isn't signed in, send them to Google sign-in first (`/auth/google?returnTo=…`).

**"Đăng ký":**
- `POST /orders { courseId }` with `X-Requested-With`, then `window.location.assign(paymentUrl)`.
- **`201` and `200` are both success; treat them alike.** `201` = a new order. `200` = the user's live pending order for this course (a double click, a second tab, coming back from VNPAY's page), with a freshly signed `paymentUrl` for the **same** VNPAY transaction (same `reference`, amount, `expiresAt`).
- **Never store or rebuild a payment URL.** To get a valid one, call `POST /orders` again: the backend returns the live order or creates a new one. Disable the button while the request runs (the backend is race-safe anyway).
- Optional: show "Thanh toán trước *HH:MM*" from `order.expiresAt`.

| Answer | Vietnamese hint | Action |
|---|---|---|
| `409 COURSE_ALREADY_OWNED` | "Bạn đã sở hữu khóa học này" | Link to the course |
| `409 COURSE_NOT_FOR_SALE` | "Khóa học chưa mở đăng ký" | — |
| `409 ORDER_PENDING` | "Giao dịch trước đang được xác nhận, vui lòng thử lại sau *N* phút" | `N` from `Retry-After` (seconds, ≤ 6 min). Can't happen while the live order has more than a minute left |
| `429` | — | Show the `Retry-After` wait |
| `503` | "Thanh toán trực tuyến tạm thời gián đoạn" | — |

**Result page (`VNPAY_RETURN_URL`):**
- Read `vnp_TxnRef` from the query.
- Poll `GET /orders/<vnp_TxnRef>` every ~2 s, for up to ~20 s.
- Then act on the order:
  - `paid`: "Thanh toán thành công", link to the course;
  - `failed`: map `failureCode` (`24` "Bạn đã hủy giao dịch", `11` "Hết thời gian thanh toán", `51` "Tài khoản không đủ số dư", else "Giao dịch không thành công") and offer to try again;
  - still `pending`: "Đang xác nhận thanh toán…", with a refresh.
- **Never trust the query's `vnp_ResponseCode` for access.**

**Player:**
- When `video.provider === 'youtube'`, embed `https://www.youtube-nocookie.com/embed/<videoId>`.
- The Vimeo path stays as designed.

**Admin:**
- A price field (`PUT /admin/courses/:id/price`).
- A `youtubeVideoId` field on the lesson form.
- An orders list (`GET /admin/orders`).

**OpenAPI:** regenerate the snapshot from a local API (`DOCS_ENABLED=true`, `yarn api:pull`, `yarn api:generate`). `VimeoVideoDto` is now `LessonVideoDto`.

## 6. Payment risks before Production (evaluated 2026-11-08)

### 6.1 Duplicate charges (guard built 2026-11-08, spec S16)

**The risk:** two payable orders for one course (two tabs, a second click on "Đăng ký" within 15 minutes) could both be paid: two charges.

**What the backend does now (owner-approved; spec S16):**
- **At most one payable order per user and course.** Checkout runs under `pg_advisory_xact_lock` per user and course, so simultaneous clicks are serialized. Exactly one order is created; the others get it back.
- **Reuse:** a `pending` order with ≥ 1 minute left is returned (`200`) with a re-signed URL for the same `vnp_TxnRef`, amount and expiry. VNPAY charges a `vnp_TxnRef` at most once, and our IPN settles an order once.
- **Wait:** an order in its last minute, or expired less than 5 minutes ago, answers `409 ORDER_PENDING` with `Retry-After`. Expiry isn't proof VNPAY didn't charge: a payment started just before it can still complete and its IPN arrive.
- **New order:** only when nothing is pending, the old order `failed`, or it expired over 5 minutes ago. The old one stays `pending`, never assumed unpaid.
- **The IPN is unchanged:** a late success (after expiry, after a new order, after an admin or another purchase grant) is always recorded `00`/`paid` with a grant. A real charge is never refused (S9, S13, S14). Proven by e2e.
- The throttle (5 per 15 min) now counts only **new** orders; a reuse is never throttled.

**What remains possible:** a second charge needs VNPAY to accept a payment over 5 minutes after its own `vnp_ExpireDate` while the buyer opens a new order. Recovery stays manual:
1. `GET /admin/orders?status=paid` shows two paid orders for the same user and course.
2. Refund the later one by its `vnpTransactionNo` in the VNPAY merchant portal.
3. Note it. The extra purchase grant is harmless (OD-1).

**Open, checked in the sandbox (§7):**
- whether VNPAY's page accepts a re-opened `vnp_TxnRef` (the reuse path);
- whether VNPAY sends an IPN when the buyer **cancels** on its page. If it doesn't, the cancelled order stays `pending` and the next checkout reuses a transaction VNPAY has closed. The buyer would then wait up to ~20 minutes. If the sandbox shows this, it's a follow-up decision for the owner, not part of this change.

### 6.2 A successful payment whose IPN never arrives

**What happens:**
- The money is taken, the order stays `pending`, and the student has no access.
- VNPAY retries an IPN that isn't answered `00`/`02` (retry count unverified).
- A permanent miss means an outage on our side longer than VNPAY's retries, or a wrong IPN URL. The SIT and the sandbox test (§7) prove the URL first.

**Minimum acceptable for launch: an operational procedure, no new code.**
1. The result page shows "Đang xác nhận thanh toán…" and the order `reference` when the order is still `pending` after ~20 s, and asks the student to send the reference to Xuan if access doesn't appear within an hour.
2. Daily, while volume is low: `GET /admin/orders?status=pending` → for each order older than 15 minutes, look up `vnp_TxnRef` = `reference` in the VNPAY merchant portal.
3. If VNPAY shows it paid: grant access with the existing admin route `PUT /admin/courses/:courseId/access/:userId`. The user id is on the admin order row. Record the VNPAY transaction number in your notes.
   - The order stays `pending` in our table. That's a known record mismatch, acceptable at this volume.
4. If VNPAY shows it unpaid or expired: nothing to do.

**Later improvement (not now):** an admin "reconcile" action that calls VNPAY `querydr` (techspec §2.5.4) and settles through the same transaction as the IPN. This turns step 3 into one click and fixes the record.

## 7. Next: one controlled VNPAY sandbox payment

Sandbox only, no real money, against **local `xuan_dev`** only. Never Neon: the API reads `.env` (not `.env.production.local`), and the preflight below refuses anything but local `xuan_dev`.

### 7.1 Owner setup (minimum)

1. **Docker Desktop** running, with `xuan-postgres` up.
2. **Sandbox credentials**, typed into your local `.env` yourself (never in chat, never committed):
   - `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`;
   - `VNPAY_PAYMENT_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html`;
   - `VNPAY_RETURN_URL=http://localhost:3000/khoa-hoc/thanh-toan/ket-qua`. The page can 404 for now; the IPN is what's tested.
3. **The HTTPS tunnel:** install `cloudflared` once (`winget install --id Cloudflare.cloudflared`, a new tool: your OK). Start a quick tunnel, no account needed: `cloudflared tunnel --url http://localhost:4000`. It prints `https://<random>.trycloudflare.com`.
   - The tunnel exposes the **whole** local API while it runs. Keep it up only for the test, then stop it (Ctrl+C).
   - The address changes on every start, so register it again each time.
4. **Register the IPN URL** `https://<random>.trycloudflare.com/payments/vnpay/ipn` for your sandbox terminal: in VNPAY's sandbox merchant admin (link in the onboarding email), or ask VNPAY support to set it.

### 7.2 Gates before any transaction

1. `yarn build`, then Claude runs a read-only preflight script (kept out of the repo; it prints no secret and connects only to read `current_database()`). It must say `PREFLIGHT OK: local xuan_dev + VNPAY sandbox`. It checks:
   - the effective `DATABASE_URL` is `xuan_dev` on a local host;
   - a live `SELECT current_database()` = `xuan_dev`;
   - VNPAY is configured with the sandbox host.
2. `yarn start:dev`. Config loads with no `VNPAY_*` error.
3. **Tunnel → API check, creates nothing:** `curl https://<random>.trycloudflare.com/payments/vnpay/ipn` must answer `{"RspCode":"97","Message":"Invalid Checksum"}`.
4. You confirm the IPN URL is registered with VNPAY.

### 7.3 Isolated test data on `xuan_dev` (as admin, through the admin API)

A dedicated course that no real student owns: slug `vnpay-sandbox-test`, title `[TEST] VNPAY sandbox`, one section, one published lesson with a `youtubeVideoId`, the course published, and `PUT /admin/courses/:id/price {"priceVnd":499000}`. Afterwards, set the price back to `null` and unpublish it.

The buyer can be your own admin account. Admins also need a grant to watch, so the before and after check still works, and the purchase grant lands only on the test course.

### 7.4 The test (in this order)

From a page on `http://localhost:3000`, signed in, run `POST /orders` in DevTools:

```js
const checkout = () => fetch('http://localhost:4000/orders', {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
  body: JSON.stringify({ courseId: '<test course id>' }),
}).then(async (r) => ({ status: r.status, body: await r.json() }));
```

**A. Cancelled payment first** (you can't buy after owning):
1. `await checkout()` → `201`. Open `body.data.paymentUrl`.
2. **Signature gate (S8): VNPAY's payment page must appear.** "Sai chữ ký" / checksum error → stop; the encoding must change first.
3. Cancel on VNPAY's page ("Hủy thanh toán").
4. **Observe:** does an `VNPAY IPN <reference>: RspCode 00, vnp_ResponseCode 24 …` line appear?
   - Yes → `GET /orders/<reference>` → `failed`, `failureCode: "24"`, no grant.
   - No (stays `pending`) → note it (§6.1 open item), and run step B.1 to see whether the reused URL still works.

**B. Successful payment, including reuse:**
1. `await checkout()` twice. First `201` (or `200` if A's order is still `pending`), then **`200` with the same `reference`**. Open the **second** `paymentUrl`. Record whether VNPAY accepts the re-signed URL for the same `vnp_TxnRef`.
2. Pay with the sandbox NCB test card (from VNPAY's instructions).
3. **Check, in order:**
   - the API log: `VNPAY IPN <reference>: RspCode 00, vnp_ResponseCode 00, vnp_TransactionStatus 00`;
   - `GET /orders/<reference>` → `status: "paid"`, `paidAt` set;
   - `GET /admin/orders` → `vnpTransactionNo`, bank and card filled;
   - `GET /admin/courses/<id>/access-grants` → a `purchase` grant for this order;
   - `GET /learn/courses/vnpay-sandbox-test/lessons/<lessonId>` → `200` with `video.provider: "youtube"`;
   - `await checkout()` → `409 COURSE_ALREADY_OWNED`.

### 7.5 Then the SIT

Ask VNPAY to run the SIT against the same IPN URL. **Their script needs two separate transactions stopped at OTP** (`VNPAY SIT.docx`). With S16, a second checkout by the same user for the same course within 15 minutes returns the **same** transaction. Use two test users, or two test courses, or wait 20 minutes between them.

## 8. Known limitations

- **YouTube unlisted (S2, accepted):** an unlisted id plays on youtube.com for anyone who has it. Our API hands it only to paying students, but it can't stop a student from sharing it. The remedy is Vimeo: switch each lesson's id field, with no code change.
- **No refund API:** refunds are manual in the VNPAY portal, and an admin API to revoke a purchase grant is deferred (S6).
- **No `querydr` reconciliation:** if VNPAY's IPN never arrives, the order stays `pending`. Fix: look up the transaction in the VNPAY portal and grant access manually with the admin grant.
- **Paying twice:** now only if VNPAY accepts a payment over 5 minutes after its own expiry while the buyer opened a new order (S16). Two grants, two charges; refund one manually (§6.1).
