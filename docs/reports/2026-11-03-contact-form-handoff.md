# Contact form: frontend handoff and activation checklist

**For:** the xuan-web implementer (sections 1–12) and the owner (sections 13–15).
**Backend:** PR #31, branch `feat/contact-submissions-and-notifications`. Design: `docs/superpowers/specs/2026-11-03-contact-form-design.md` (CF-1…CF-15, notification delivery revised the same day). Contract: `docs/api-contract.md` §11 "Contact form". The OpenAPI document is authoritative; this page explains it.
**The `/lien-he` design stays as it is.** Only the submit logic and a new admin inbox are added.

## 0. Status at a glance

| Question                              | Answer                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is the backend contract final for FE? | **Yes.** Request/response shapes, enums and error codes below are stable contract identifiers (I19)                                                                                               |
| Is it on production?                  | **No.** PR #31 is open, not merged, not deployed. Production does not expose these routes yet                                                                                                     |
| Can FE build now?                     | Yes, against this document and a locally generated snapshot (§11). Test end to end against a local xuan-api (`yarn start:dev`), where reCAPTCHA is skipped and no email is sent unless configured |
| What does production need first?      | Owner steps in §13–§15: reCAPTCHA keys, Resend domain + key, Vercel variables, the Neon migration, then the merge                                                                                 |

## 1. Public submit

```
POST /contact-submissions
Content-Type: application/json
X-Requested-With: XMLHttpRequest        ← required (CSRF guard); the apiClient already sends it
credentials: 'include'                   ← harmless; no session is needed

{
  "name": "Nguyễn Văn A",
  "email": "a@example.com",
  "subject": "youtube_editing_course",
  "message": "Mình muốn hỏi về khóa học.\nCảm ơn!",
  "recaptchaToken": "<fresh token from grecaptcha.execute>"
}
```

Request component: `CreateContactSubmissionDto` (strict: unknown fields are refused). All five fields are **required**; there are no optional fields.

**Success:** `202 Accepted`

```json
{ "data": { "receivedAt": "2026-11-03T07:05:09.123Z" } }
```

`ContactSubmissionReceiptDto` has only `receivedAt` (ISO 8601, UTC). No id, status or anything else.

What `202` means: **the message is stored** in the database. Show the thank-you state. The backend then tries once to email the business inbox, but that result is never on the wire: an email outage still answers `202`. Never tell the visitor "email sent"; say "we received your message".

**Duplicates:** the same email, subject and message again within 24 hours (also a double click, or a retry after a network blip) answers `202` with the **first** `receivedAt`, and nothing is stored or emailed again. Treat it exactly like success.

## 2. Subjects (`subject`)

Send the value; show the label.

| Value (send this)           | Label (vi, show this)                            |
| --------------------------- | ------------------------------------------------ |
| `youtube_editing_course`    | Hỏi về khóa học YouTube Editing Workflow         |
| `channel_kickstart_session` | Hỏi về buổi coaching Channel Kickstart Session   |
| `youtube_coaching_3_months` | Hỏi về chương trình 3-Month 1:1 YouTube Coaching |
| `general`                   | Liên hệ khác / Hợp tác                           |

The values are contract identifiers and won't change. The backend uses the same labels in the notification email. Labels never come over the wire, so keep this table in the web's constants.

## 3. Field rules (mirror them in the form for instant feedback)

| Field            | Rule (server)                                                              | Field codes on failure                         |
| ---------------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| `name`           | trimmed; 1–100 characters; one line (no line breaks or control characters) | `REQUIRED`, `TOO_SHORT`, `TOO_LONG`, `INVALID` |
| `email`          | trimmed; valid email; ≤ 254; the server lowercases it                      | `REQUIRED`, `INVALID_FORMAT`, `TOO_LONG`       |
| `subject`        | one of the four values                                                     | `REQUIRED`, `INVALID`                          |
| `message`        | line endings → `\n`; trimmed; 10–5 000 characters; newlines kept           | `REQUIRED`, `TOO_SHORT`, `TOO_LONG`, `INVALID` |
| `recaptchaToken` | non-empty string, ≤ 4 096; never stored                                    | `REQUIRED`, `TOO_SHORT`, `TOO_LONG`            |

- Characters are counted as Unicode code points (an emoji is one), after trimming. A value that is blank after trimming answers `TOO_SHORT` (not `REQUIRED`); `REQUIRED` means the field is missing or `null`.
- A value of the wrong JSON type (e.g. `"name": 123`) answers `INVALID_TYPE` at that field.
- Unknown fields → `UNKNOWN_FIELD` at that name.
- `details.fields[].field` is the property name, so it maps straight onto React Hook Form.
- Plain text only. The server stores the text as typed, never interprets HTML, and the admin UI must render it escaped.

## 4. reCAPTCHA v3

1. Load `https://www.google.com/recaptcha/api.js?render=<SITE_KEY>` on `/lien-he` only. The site key is public: **`NEXT_PUBLIC_RECAPTCHA_SITE_KEY`**.
2. **At submit time** (not on page load), after client-side validation passes:
   ```ts
   const recaptchaToken = await new Promise<string>((resolve, reject) =>
     grecaptcha.ready(() =>
       grecaptcha.execute(SITE_KEY, { action: 'contact_submit' }).then(resolve, reject),
     ),
   );
   ```
   The action must be exactly **`contact_submit`**; the server refuses any other.
3. Send it as `recaptchaToken`. A token works **once** and expires after **2 minutes**. Get a **new token for every attempt**, including a retry after any error.
4. If `grecaptcha` failed to load (blocked script, offline), show the "temporarily unavailable" message (§5, 503 row) instead of sending a request without a token.
5. Disable the submit button while a request is in flight. The backend also treats a double click as one submission.
6. Privacy: if the badge is hidden with CSS, show Google's required notice near the button: "This site is protected by reCAPTCHA and the Google Privacy Policy and Terms of Service apply." (with both links). Mention reCAPTCHA in the site's privacy policy.

The server checks: Google's `success`, action `contact_submit`, a hostname in its allowlist, score ≥ its threshold (default 0.5), and the token's age. The reason for a refusal is never sent to the browser.

## 5. Errors on the submit route

Every error is the standard envelope: `{ "data": null, "error": { "code", "message", "details" } }`. Branch on `code`, never on `message` (English, user-safe).

| Status | `error.code`                    | When                                                                          | Suggested UI (vi)                                                                                         |
| ------ | ------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_FAILED`             | A field breaks §3 (`details.fields[]`)                                        | Field messages                                                                                            |
| 403    | `RECAPTCHA_VERIFICATION_FAILED` | Token failed, reused, expired, low score, wrong action or host                | "Không xác minh được, vui lòng thử lại." Get a **new** token and let them retry                           |
| 403    | `FORBIDDEN`                     | Missing `X-Requested-With` or a foreign `Origin`: a bug                       | Generic error                                                                                             |
| 413    | `PAYLOAD_TOO_LARGE`             | Body over 100 kB (can't happen within the field limits)                       | Generic error                                                                                             |
| 429    | `RATE_LIMITED`                  | Over 3 accepted submissions an hour for this email, or 5 an hour from this IP | "Bạn đã gửi nhiều lần, vui lòng thử lại sau." The `Retry-After` header (seconds) is readable through CORS |
| 503    | `CONTACT_FORM_UNAVAILABLE`      | Google unreachable, or reCAPTCHA not configured on the server                 | "Form tạm thời không khả dụng, vui lòng thử lại sau hoặc email trực tiếp." Don't auto-retry               |
| 500    | `INTERNAL_ERROR`                | Anything unexpected                                                           | Generic error                                                                                             |

Example (`429`):

```json
{
  "data": null,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Try again in a moment.",
    "details": {}
  }
}
```

## 6. Admin inbox: routes

Admin role only. A session cookie is required (`credentials: 'include'`); writes also need `X-Requested-With`. Editors and users get `403`, so hide the inbox from them.

| Method and path                                                    | Body | Answer                                                               |
| ------------------------------------------------------------------ | ---- | -------------------------------------------------------------------- |
| `GET /admin/contact-submissions?status=&page=&pageSize=`           | —    | `200 { data: { items: AdminContactSubmissionDto[], pageInfo } }`     |
| `GET /admin/contact-submissions/:submissionId`                     | —    | `200 { data: AdminContactSubmissionDto }`. Does **not** mark it read |
| `POST /admin/contact-submissions/:submissionId/read`               | none | `200 { data: AdminContactSubmissionDto }`                            |
| `POST /admin/contact-submissions/:submissionId/archive`            | none | `200 { data: AdminContactSubmissionDto }`                            |
| `POST /admin/contact-submissions/:submissionId/notification/retry` | none | `200 { data: AdminContactSubmissionDto }`                            |

Request components: `AdminContactSubmissionsQuery` (query), `ContactSubmissionIdParam` (path, a UUID).

## 7. Pagination, sorting, filtering, status

- `page` ≥ 1 (default 1); `pageSize` 1–50 (default 12). A page beyond `totalPages` answers `200` with empty `items`.
- `pageInfo` = `{ page, pageSize, totalItems, totalPages }`.
- Order is fixed: newest `createdAt` first (tie: `id`). There's no sort parameter.
- `status` filter: `new` | `read` | `archived`; omit it for all. Any other value → `400 VALIDATION_FAILED`.
- Inbox status (`status` on the DTO):
  - `new` → `read`: `POST …/read` changes only `new`; on `read` or `archived` it answers the unchanged submission. Call it when the admin opens a `new` one.
  - anything → `archived`: `POST …/archive`, idempotent.
  - No unarchive and no delete in V1.

## 8. `AdminContactSubmissionDto`

```json
{
  "id": "0190d6c2-6a1e-7b3c-9f00-1a2b3c4d5e6f",
  "name": "Nguyễn Văn A",
  "email": "a@example.com",
  "subject": "youtube_editing_course",
  "message": "Mình muốn hỏi về khóa học.\nCảm ơn!",
  "status": "new",
  "notification": {
    "status": "failed",
    "attempts": 1,
    "lastAttemptAt": "2026-11-03T07:05:09.200Z",
    "lastError": "PROVIDER_UNAVAILABLE",
    "sentAt": null,
    "retryable": true
  },
  "createdAt": "2026-11-03T07:05:09.123Z",
  "updatedAt": "2026-11-03T07:05:17.300Z"
}
```

Render `message` as **escaped plain text** with newlines kept (`white-space: pre-wrap`), never as HTML. `subject` → the label from §2. The client IP is never in the DTO.

## 9. Notification status (the email to the business inbox)

The inbox is the source of truth for messages; the email is only a heads-up. One attempt is made per submission, during the submit request. There are **no automatic retries**.

| `notification.status` | Meaning                                                                                                                              | Suggested badge                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `sent`                | Resend accepted the email (`sentAt` set). Not proof that it reached the mailbox                                                      | "Đã gửi email"                                     |
| `failed`              | The attempt failed, or no email provider is configured (`lastError`)                                                                 | "Gửi email lỗi" + retry button                     |
| `pending`             | An attempt is running right now, or it was interrupted (the request died). `retryable` turns `true` 10 minutes after `lastAttemptAt` | "Đang gửi…"; if `retryable`, show the retry button |

`lastError` (a category, never provider text): `NOT_CONFIGURED` (no provider; `attempts` is 0), `TIMEOUT`, `NETWORK_ERROR`, `PROVIDER_REJECTED`, `PROVIDER_UNAVAILABLE`, `INVALID_RESPONSE`. It's cleared when a retry starts and once sent, so a `pending` notification has `lastError: null`.

`attempts`: 1 after the submission's own attempt, +1 per admin retry; 0 when nothing was attempted. `lastAttemptAt`: when the latest attempt started (`null` if none).

## 10. Manual retry

- Show the button only when **`notification.retryable`** is `true`. Don't recompute it on the client.
- `POST …/notification/retry` makes **one** attempt now and answers the updated submission. Read `notification.status` from the answer: `sent` (done) or `failed` (still failing; show `lastError`).
- If the notification isn't retryable (already `sent`, or an attempt is running), the answer is the **unchanged** submission with `200`, and nothing is sent. Two clicks or two admins at once send at most one attempt.
- The same `Idempotency-Key` is used on every attempt for a submission, so a retry within 24 hours after Resend silently accepted the first one doesn't deliver a second email.
- Errors: `401`, `403`, `404 NOT_FOUND` (unknown id), `400 VALIDATION_FAILED` (malformed id, `details.fields[0].code = INVALID_FORMAT`), and **`503 CONTACT_NOTIFICATIONS_UNAVAILABLE`** "Notification email is not configured." when the server has no email provider. Show "Email chưa được cấu hình" and keep the button. Nothing changes on a 503.
- The request waits for the provider (up to about 8 seconds). Show a spinner and disable the button meanwhile.
- A `500 INTERNAL_ERROR` from the retry means the attempt broke unexpectedly: reload the submission; it shows `pending` and becomes `retryable` again after 10 minutes.

All admin routes: `400`, `401`, `403`, `404` (not on the list), `413`, `500`; the retry adds `503`.

## 11. OpenAPI and generated types

The canonical workflow (`docs/api-contract.md` §0, §5): xuan-api produces the document; xuan-web commits a snapshot and generates its types.

1. Pull: `yarn api:pull` in xuan-web (→ `openapi/openapi.json`). Before the deployment, run xuan-api locally (`yarn start:dev` on this branch, with docs enabled) and pull from it.
2. Generate: `yarn api:generate` (→ `src/generated/api-schema.ts`). Never edit the generated files by hand.
3. New components: `CreateContactSubmissionDto`, `ContactSubmissionReceiptDto`, `AdminContactSubmissionDto`, `AdminContactNotificationDto`, `AdminContactSubmissionsQuery`, `ContactSubmissionIdParam`. New codes: `RECAPTCHA_VERIFICATION_FAILED`, `CONTACT_FORM_UNAVAILABLE`, `CONTACT_NOTIFICATIONS_UNAVAILABLE`. New status: **503** (an exhaustive `switch` on statuses needs one case).
4. After production deploys, pull again from production and commit the snapshot.

## 12. Frontend environment variables

| Variable                         | Where                                            | Value                                                                    |
| -------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` | xuan-web (all environments that show `/lien-he`) | The reCAPTCHA v3 **site** key (public). The secret never goes to the web |

No other new web variable. The API base URL is unchanged.

## 13. Owner setup: Google reCAPTCHA v3 (not done yet)

1. Google reCAPTCHA admin console → create a key of type **score-based (v3)**. Labels and the Google Cloud project are your choice.
2. Domains: `xuancreative.com`, `www.xuancreative.com` (add `localhost` or a preview domain only if you want real verification there).
3. You get a **site key** (public → `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` on xuan-web) and a **secret key** (→ `RECAPTCHA_SECRET_KEY` on xuan-api only). Never paste the secret in chat or commit it.
4. Backend variables: `RECAPTCHA_SECRET_KEY`, `RECAPTCHA_ALLOWED_HOSTNAMES=xuancreative.com,www.xuancreative.com`, optional `RECAPTCHA_MIN_SCORE` (0–1, default 0.5; raise it later only if spam gets through). The action is fixed in code: `contact_submit`.
5. Without the secret, production refuses every submission with `503 CONTACT_FORM_UNAVAILABLE` (fail closed). The rest of the API works.

## 14. Owner setup: Resend (not done yet)

1. Create a Resend account.
2. **Add and verify a sending domain**, ideally a subdomain such as `mail.xuancreative.com`. Resend shows the exact DNS records to add at your DNS host (Cloudflare): typically a DKIM TXT record (`resend._domainkey…`) and, for the bounce subdomain (`send…`), an SPF TXT and an MX record. A DMARC TXT record (`_dmarc`) is recommended. Wait until Resend shows the domain as **Verified**.
3. Create an API key with **sending access** only (optionally restricted to that domain).
4. Backend variables (all three or none):
   - `RESEND_API_KEY` = the key (secret);
   - `CONTACT_EMAIL_FROM` = `XuanCreative <contact@mail.xuancreative.com>` (any address on the verified domain);
   - `CONTACT_NOTIFICATION_TO` = `business.xuanpham@gmail.com`.
5. Without them, submissions are still stored and the inbox shows `failed` / `NOT_CONFIGURED`; the retry answers `503`. After configuring, an admin can retry those.
6. Replies: the email's `Reply-To` is the visitor's address, so "Reply" in Gmail answers the visitor directly.

## 15. Owner setup: database, Vercel and activation order

| #   | Step                                                                                                                                                                                  | Notes                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | reCAPTCHA key (§13)                                                                                                                                                                   | —                                                                                                                                                                                                                                                                                         |
| 2   | Resend domain + key (§14)                                                                                                                                                             | DNS changes are yours                                                                                                                                                                                                                                                                     |
| 3   | Vercel → xuan-api → Production env: `RECAPTCHA_SECRET_KEY`, `RECAPTCHA_ALLOWED_HOSTNAMES`, (`RECAPTCHA_MIN_SCORE`), `RESEND_API_KEY`, `CONTACT_EMAIL_FROM`, `CONTACT_NOTIFICATION_TO` | `TRUST_PROXY_HOPS` can stay unset (production default 1, Vercel's edge). **No `CRON_SECRET` and no `vercel.json` cron**: scheduled retries were removed                                                                                                                                   |
| 4   | Vercel → xuan-web: `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`                                                                                                                                   | Public                                                                                                                                                                                                                                                                                    |
| 5   | Neon production (`xuan_staging`): run `CreateContactSubmissions1793750400000` **before** the merge                                                                                    | The 2026-10-31 procedure: verified identity, a clean `git archive` of the commit being merged, DIRECT URL with `sslmode=verify-full`, a backup branch first. Additive: one new table, 3 indexes, no FK, no change to existing rows. `down()` drops the table (only safe while it's empty) |
| 6   | Merge PR #31 into `dev`                                                                                                                                                               | Vercel's production branch is `dev`, so this deploys                                                                                                                                                                                                                                      |
| 7   | Production smoke test                                                                                                                                                                 | below                                                                                                                                                                                                                                                                                     |
| 8   | xuan-web: pull the production snapshot, ship the form and the inbox                                                                                                                   | —                                                                                                                                                                                                                                                                                         |

Before steps 1–3 a deployed form answers `503` (safe). Without step 5 the contact routes answer `500` (table missing); nothing else breaks.

**Production smoke test (owner, after step 6):**

- [ ] `GET /docs` (if enabled) or the OpenAPI JSON lists `/contact-submissions` and the five admin routes.
- [ ] Submit the real `/lien-he` form once → thank-you state; the request shows `202`.
- [ ] `business.xuanpham@gmail.com` receives "[Liên hệ] … — <name>"; "Reply" addresses the visitor.
- [ ] Resend dashboard shows the email as delivered.
- [ ] Admin inbox lists it as `new`, `notification.status = sent`; open → read; archive → archived.
- [ ] Submitting the identical message again answers `202` and sends no second email.
- [ ] reCAPTCHA admin console shows requests for action `contact_submit`.

## 16. Verified on the backend (2026-11-03)

| Item                                                                                                                                                                                           | State                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Implementation (module, migration, gateways, one-attempt notification, manual retry, inbox, docs)                                                                                              | Done on PR #31                      |
| Unit tests, lint, typecheck, format, build                                                                                                                                                     | Pass (see the PR for the exact run) |
| E2E on `xuan_test` (submission, reCAPTCHA, limits, duplicates and concurrency, notification sent/failed/not configured/lost response, inbox, retry and concurrent retry, constraints, OpenAPI) | Pass                                |
| Migration run → `\d+` → revert → run → second `migration:generate` empty, on `xuan_test`                                                                                                       | Pass                                |
| `xuan_dev`, Neon                                                                                                                                                                               | **Not run**                         |
| Google reCAPTCHA, Resend, Vercel variables                                                                                                                                                     | **Not configured, not verified**    |
| Production                                                                                                                                                                                     | **Not deployed, not verified**      |

## 17. Known limitations

- `sent` = accepted by Resend, not delivered. Bounces aren't tracked (no webhooks).
- Not exactly-once: a retry more than 24 hours after an attempt whose acceptance was lost (a timeout after Resend accepted) can deliver a second copy. Within 24 hours the idempotency key prevents it.
- No automatic retry: a failed email stays failed until an admin retries it. An interrupted attempt stays `pending` and becomes retryable after 10 minutes.
- The submit request waits for the email attempt (up to about 8 s) when Resend is slow.
- Limits are per email and per IP only; a flood of invalid tokens is bounded by Google's quota and the CSRF/Origin checks. The per-email limit is exact (serialized by a lock); the per-IP limit can be exceeded by the number of submissions from one IP with **different** emails running at the same instant.
- Changing `CONTACT_EMAIL_FROM` or `CONTACT_NOTIFICATION_TO` changes the email payload. Resend may then refuse a retry of an attempt made in the previous 24 hours under the same idempotency key (shown as `PROVIDER_REJECTED`); retrying after 24 hours works.
- No unarchive, delete, search or retention policy yet.
