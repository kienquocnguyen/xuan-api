# Contact form: frontend handoff and activation checklist

**For:** the xuan-web team (sections 1–6) and the owner (sections 7–9).
**Backend:** `feat/contact-submissions-and-notifications`. Design: `docs/superpowers/specs/2026-11-03-contact-form-design.md`. Contract: `docs/api-contract.md` §11 "Contact form". The OpenAPI document is authoritative: pull the snapshot and regenerate after the backend is deployed.
**The `/lien-he` design stays as it is.** Only the submit logic changes.

## 1. Submit

```
POST /contact-submissions
Content-Type: application/json
X-Requested-With: XMLHttpRequest        ← required (CSRF guard); the apiClient already sends it
credentials: 'include'                   ← harmless; no session is needed

{ "name": "…", "email": "…", "subject": "general", "message": "…", "recaptchaToken": "…" }
```

**Success:** `202 { "data": { "receivedAt": "2026-11-03T07:05:09.123Z" } }`. Show the thank-you state; there is nothing else to read.

- A repeat of the same email, subject and message within 24 hours also answers `202`, with the first `receivedAt`. Treat it as success.
- `202` means the message is **stored**. The email to the business inbox is the backend's job: its outcome never changes the answer, so never tell the visitor "email sent".

## 2. Subjects (`subject`)

Send the value; show the label.

| Value | Label (vi) |
|---|---|
| `youtube_editing_course` | Khóa học YouTube Editing Workflow |
| `channel_kickstart_session` | Buổi Channel Kickstart Session |
| `youtube_coaching_3_months` | Coaching 1:1 YouTube 3 tháng |
| `general` | Liên hệ chung hoặc hợp tác |

The values are contract identifiers (I19); the labels may be reworded on the web freely.

## 3. Field rules (mirror them in the form for instant feedback)

| Field | Rule | Codes on failure |
|---|---|---|
| `name` | trimmed, 1–100 characters, one line | `TOO_SHORT`, `TOO_LONG`, `INVALID` |
| `email` | trimmed, valid email, ≤ 254 (the server lowercases it) | `INVALID_FORMAT`, `TOO_LONG` |
| `subject` | one of the four values | `INVALID`, `REQUIRED` |
| `message` | trimmed, 10–5 000 characters (newlines kept) | `TOO_SHORT`, `TOO_LONG`, `INVALID` |
| `recaptchaToken` | non-empty, ≤ 4 096 | `REQUIRED`, `TOO_SHORT`, `TOO_LONG` |

Characters are counted as code points (an emoji is one). Unknown fields → `UNKNOWN_FIELD`. `details.fields[].field` is the property name, so it maps straight onto React Hook Form.

## 4. reCAPTCHA v3

1. Load `https://www.google.com/recaptcha/api.js?render=<SITE_KEY>` on `/lien-he` only. The site key is public: `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`.
2. **At submit time** (not on page load): `const token = await grecaptcha.execute(SITE_KEY, { action: 'contact_submit' })`. The action must be exactly `contact_submit`.
3. Send it as `recaptchaToken`. A token works **once** and expires after **2 minutes**, so get a new one for every attempt, including a retry after an error.
4. Show Google's required notice if the badge is hidden (Google's branding rules). Nothing else about reCAPTCHA is needed: no analytics, no other pages.
5. Disable the submit button while a request is in flight. The backend also treats a double click as one submission.

The secret key exists only in the backend.

## 5. Errors on the submit route

| Status | `error.code` | Suggested UI |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Field messages from `details.fields` |
| 403 | `RECAPTCHA_VERIFICATION_FAILED` | "Không xác minh được, vui lòng thử lại." Get a new token and let them retry |
| 403 | `FORBIDDEN` | A bug (missing `X-Requested-With` or an unlisted origin); generic error |
| 413 | `PAYLOAD_TOO_LARGE` | Generic error (can't happen within the field limits) |
| 429 | `RATE_LIMITED` | "Bạn đã gửi nhiều lần, vui lòng thử lại sau." `Retry-After` (seconds) is readable through CORS |
| 503 | `CONTACT_FORM_UNAVAILABLE` | "Form tạm thời không khả dụng, vui lòng thử lại sau hoặc email trực tiếp." |
| 500 | `INTERNAL_ERROR` | Generic error |

Branch on `code`, never on `message` (English, user-safe).

## 6. Admin inbox (dashboard, admin role only)

| Route | Notes |
|---|---|
| `GET /admin/contact-submissions?status=&page=&pageSize=` | Newest first; `status` `new` \| `read` \| `archived` (omit for all); `pageSize` ≤ 50, default 12; `{ items, pageInfo }` |
| `GET /admin/contact-submissions/:submissionId` | Detail. **Doesn't** mark it read; call `…/read` when the admin opens it |
| `POST /admin/contact-submissions/:submissionId/read` | `new` → `read`; anything else is unchanged |
| `POST /admin/contact-submissions/:submissionId/archive` | → `archived`; idempotent. There's no unarchive and no delete in V1 |
| `POST /admin/contact-submissions/:submissionId/notification/retry` | Show it when `notification.status` is `failed` (or `pending` with `attempts > 0`) |

Every route returns `AdminContactSubmissionDto`: `{ id, name, email, subject, message, status, notification: { status, attempts, nextAttemptAt, lastError, sentAt }, createdAt, updatedAt }`. Render `message` as **escaped plain text** with newlines kept, never as HTML. Editors get `403`, so hide the inbox from them. Writes need `X-Requested-With`.

## 7. External setup (owner): nothing below has been done

| # | Where | What | Notes |
|---|---|---|---|
| 1 | Google reCAPTCHA admin console | Create a **v3** key for `xuancreative.com` and `www.xuancreative.com` (and the preview/local domains you want) | Free. The site key goes to xuan-web, the secret to the API |
| 2 | Resend | Create an account, **verify a sending domain** (DNS records on your domain, e.g. a `mail.` subdomain), create an API key limited to sending | The free tier is enough for a contact form. DNS changes are yours to make |
| 3 | Vercel → xuan-api → Environment Variables (Production) | `RECAPTCHA_SECRET_KEY`, `RECAPTCHA_ALLOWED_HOSTNAMES=xuancreative.com,www.xuancreative.com`, optional `RECAPTCHA_MIN_SCORE` (default 0.5), `RESEND_API_KEY`, `CONTACT_EMAIL_FROM="XuanCreative <contact@<verified-domain>>"`, `CONTACT_NOTIFICATION_TO=business.xuanpham@gmail.com`, `CRON_SECRET` (≥ 16 random characters) | `TRUST_PROXY_HOPS` can stay unset (production default 1). The three email variables go together; leaving all three out keeps notifications pending |
| 4 | Vercel → xuan-web | `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` | Public |
| 5 | xuan-api `vercel.json` (a later, separate change) | `{ "crons": [{ "path": "/internal/contact-notifications/deliver-due", "schedule": "0 1 * * *" }] }` | Hobby allows one run a day; Pro allows more frequent runs. Vercel sends `Authorization: Bearer $CRON_SECRET` itself. **Not committed in this PR**: adding it changes deployment configuration |
| 6 | Neon production (`xuan_staging`) | Run migration `CreateContactSubmissions1793750400000` (§8) **before** the API code that uses it serves traffic | Otherwise `/contact-submissions` and the inbox answer `500` (the table is missing); the rest of the API is unaffected |

**Order for go-live:** 1–4, then 6, then merge `dev` (which deploys to production), then a smoke test, then 5. Before steps 1–3 the deployed form answers `503 CONTACT_FORM_UNAVAILABLE` (reCAPTCHA unconfigured in production, fail closed), which is safe.

## 8. Database approval packet (owner)

Governance: each database operation needs your approval (`development-workflow.md` §3.5, last row). None has been run.

| Step | Target | Command | Effect / rollback |
|---|---|---|---|
| A | `xuan_test` (local Docker, port 5433), positively identified by `test:db-guard` | `NODE_ENV=test yarn test:db-guard` → `NODE_ENV=test yarn migration:run` → `\d+ contact_submissions` → `NODE_ENV=test yarn migration:revert` → `NODE_ENV=test yarn migration:run` → `NODE_ENV=test yarn migration:generate src/database/migrations/Check` (must report no changes) | Creates one table and 4 indexes; revert drops them. Test data only |
| B | `xuan_test` | `yarn test:e2e` (guard → migrations → the whole e2e suite, which truncates every table between tests) | Proves the contact e2e specs and that nothing else regressed |
| C | `xuan_dev` (local Docker) | `yarn migration:run` | Purely additive (one new table, no FK, no change to existing rows). Note: the B1–B4 packet must already be applied there (it is, per the 2026-11-03 handoff) |
| D | Neon `xuan_staging` (production) | The production migration procedure used on 2026-10-31: verified identity, a clean `git archive` of the merged commit, DIRECT URL, `sslmode=verify-full`, a backup branch first | Additive; `down()` drops the table (loses submissions; once there are any, roll forward instead) |

Suggested one-line approval: *"Approved: A and B on xuan_test, provided test:db-guard passes and the only pending migration is CreateContactSubmissions1793750400000; stop on any difference."*

## 9. What is verified, and what isn't

| Item | State |
|---|---|
| Implementation (module, migration file, gateways, retries, cron route, inbox, docs) | Implemented locally |
| Unit tests (schema, reCAPTCHA policy and gateway, Resend gateway, email, schedule, config) | Verified: pass |
| OpenAPI document (read-only build against `xuan_test`, no migration, no reset) | Verified: pass |
| E2E behavior on PostgreSQL (submission, limits, duplicates, inbox, cron, constraints) | **Written, not run.** Needs packet A + B |
| Migration run / revert / empty second generate / `\d+` | **Not run.** Needs packet A |
| Google reCAPTCHA, Resend, Vercel Cron, Neon | **Not configured, not verified.** Steps 1–6 |
| Production | Not deployed, not verified |
