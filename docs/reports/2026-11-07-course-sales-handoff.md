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
| Migrations on `xuan_test` / `xuan_dev` | **Not run**: needs your approval (§1) |
| e2e (new: orders, IPN SIT cases + races, schema; updated: courses, learning, OpenAPI) | **Written, not run**: needs your approval (§1) |
| Signature encoding vs VNPAY's real server (spec S8) | **Unverified**: needs sandbox keys (§3) |
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

| Answer | Vietnamese hint | Action |
|---|---|---|
| `409 COURSE_ALREADY_OWNED` | "Bạn đã sở hữu khóa học này" | Link to the course |
| `409 COURSE_NOT_FOR_SALE` | "Khóa học chưa mở đăng ký" | — |
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

## 6. Known limitations

- **YouTube unlisted (S2, accepted):** an unlisted id plays on youtube.com for anyone who has it. Our API hands it only to paying students, but it can't stop a student from sharing it. The remedy is Vimeo: switch each lesson's id field, with no code change.
- **No refund API:** refunds are manual in the VNPAY portal, and an admin API to revoke a purchase grant is deferred (S6).
- **No `querydr` reconciliation:** if VNPAY's IPN never arrives, the order stays `pending`. Fix: look up the transaction in the VNPAY portal and grant access manually with the admin grant.
- **Paying twice:** two tabs paying two orders give two grants and two charges; refund one manually (S10).
