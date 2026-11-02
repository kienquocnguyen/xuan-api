# Contact form backend: design

**Status:** implemented on `feat/contact-submissions-and-notifications` (2026-11-03). The owner briefed the scope that day and delegated implementation, verification, the branch and the PR. Merging, database runs and provider setup stay owner actions.
**Owner module:** `contact` (new, `src/modules/contact/`). **Table:** `contact_submissions` (`database.md` §12).
**Consumer:** xuan-web's existing `/lien-he` page. Its visual design doesn't change; the form posts to this API.

## 1. Scope

| In | Out |
|---|---|
| Public submission with validation, reCAPTCHA v3, abuse limits and duplicate protection | CRM, tags, assignment, replies from the app, marketing automation |
| PostgreSQL persistence | Deleting submissions (none in V1) |
| Admin inbox: list (newest first, filter by status, paginated), detail, mark read, archive | Unarchive, bulk actions, search |
| One notification email per submission to the business inbox, with a durable state and bounded retries | Auto-reply to the sender, HTML templates, attachments |

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| CF-1 | A new `contact` module owns `contact_submissions`, its controllers, gateways and errors | One capability, one owner (D1, I1). No other module is involved |
| CF-2 | Subjects are stable machine values `youtube_editing_course`, `channel_kickstart_session`, `youtube_coaching_3_months`, `general`. Their Vietnamese labels live in the backend (they're used for the email) and are handed to the web | Contract identifiers (I19). Labels aren't on the wire |
| CF-3 | `POST /contact-submissions` is public and CSRF-checked. It answers **`202`** `{ data: { receivedAt } }`: the same for a new submission and for a duplicate of one | "Accepted for processing" is the honest status: the email isn't sent yet when the call returns. No id, status or admin field leaves the API |
| CF-4 | reCAPTCHA v3 is verified server-side through a `RecaptchaVerifier` gateway (C5). A pure policy then checks `success`, action `contact_submit`, a hostname from `RECAPTCHA_ALLOWED_HOSTNAMES`, a score ≥ `RECAPTCHA_MIN_SCORE` (default 0.5) and a `challenge_ts` no older than 180 s. Failure → `403 RECAPTCHA_VERIFICATION_FAILED`; the reason is never on the wire | Google rejects a reused token itself (`timeout-or-duplicate`) and tokens expire after 2 minutes; the age check is defense in depth with clock-skew slack |
| CF-5 | No secret: development and test **bypass** verification. Production is **unconfigured**, and every submission answers `503 CONTACT_FORM_UNAVAILABLE`. Google unreachable → the same `503` | Fail closed in production without taking the whole API down at boot (the rest of the API keeps working). The mode is a validated config value (D19) |
| CF-6 | Abuse limits are stored in the database, not in memory: per sender email **3 accepted submissions an hour**, per client IP **5 an hour** → `429 RATE_LIMITED` with `Retry-After` | Vercel runs many short-lived instances, so an in-memory counter would reset constantly. The rows already exist, so counting them is durable. The IP is stored only as an HMAC (`AUTH_COOKIE_SECRET`, label `contact-client-ip`), never in clear |
| CF-7 | A duplicate is the same email, subject and message within 24 hours. It answers `202` with the original `receivedAt`, writes nothing and sends nothing. The check runs before verification, again after a failed verification, and once more under a per-email transaction advisory lock before the insert | A double click sends one token twice; Google refuses the second, which must not turn a successful send into an error. The lock makes check-then-insert safe for concurrent identical requests |
| CF-8 | `trust proxy` = `TRUST_PROXY_HOPS`, default **1 in production** and 0 elsewhere | The per-IP limit needs the real client address behind Vercel's proxy. First resolution of the D23 `trust proxy` gate, for this feature |
| CF-9 | Notification: Resend's HTTP API through a `ContactNotifier` gateway (C5), using `fetch` (no new dependency). `RESEND_API_KEY`, `CONTACT_EMAIL_FROM`, `CONTACT_NOTIFICATION_TO` are all-or-nothing; none → `disabled` | No email infrastructure existed. Resend is a plain HTTPS call that suits Vercel Functions, and it supports idempotency keys |
| CF-10 | Delivery state on the row: `notification_status` `pending` → `sent` \| `failed`, `attempts`, `next_attempt_at`, `last_error` (a category, never a provider body), `sent_at`, `provider_message_id`. `sent` is written **only after the provider returns 2xx with a message id** | Durable and visible in the admin inbox. No claim of success before the provider accepts |
| CF-11 | Delivery: the submission commits first. Then the request **awaits** one attempt (8 s timeout) before answering. A failure keeps the submission (`202` all the same) and schedules a retry | No detached promise after the response. A provider outage never rolls back or loses a submission |
| CF-12 | Claiming: one `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING` increments `attempts` and pushes `next_attempt_at` 2 minutes ahead (a lease). Retries after attempt n: +1 min, +5 min, +30 min, +2 h. After **5** automatic attempts → `failed`. The Resend `Idempotency-Key` is `contact-submission-<id>` | No double sends from concurrent sweeps. A crashed attempt becomes due again when its lease expires. The idempotency key covers a lost response inside Resend's 24-hour window |
| CF-13 | Recovery triggers: (a) after a successful inline send, up to 2 other due notifications are sent in the same request; (b) `GET /internal/contact-notifications/deliver-due` with `Authorization: Bearer <CRON_SECRET>` (Vercel Cron's own convention) sends up to 20; (c) an admin's `POST /admin/contact-submissions/:id/notification/retry` makes one attempt now, also for a `failed` one | Needs no Redis, broker or long-running worker. Vercel Cron only issues GET, so the cron route is a documented exception to "safe methods never mutate": it reads no cookie and is authorized by a bearer secret that a browser can't send cross-site (`api-contract.md` §8). Without `CRON_SECRET` it's `404` |
| CF-14 | Inbox status: `new` → `read` → `archived`. Mark read only changes `new`; archive changes anything not archived. Both are idempotent and write nothing when nothing changes. Admin only (editors `403`) | Minimal. Reading the detail never marks it read, so GET stays safe |
| CF-15 | The admin DTO carries everything the admin needs, the notification state included. It never carries the IP hash | Data minimization |

## 3. Request flow

```
POST /contact-submissions  (CsrfGuard: X-Requested-With + allowed Origin; JSON ≤ 100 kB)
  → Zod CreateContactSubmissionDto (trim, lowercase email, CRLF → LF, limits)
  → duplicate? ──yes──► 202 { receivedAt: original }
  → limits (email 3/h, IP 5/h)? ──over──► 429 RATE_LIMITED + Retry-After
  → reCAPTCHA (mode verify) ──fails──► duplicate now? ─yes─► 202 original │ no ─► 403
                           ──Google down / production unconfigured──► 503 CONTACT_FORM_UNAVAILABLE
  → transaction { pg_advisory_xact_lock(email) · duplicate? · limits? · INSERT }  (I8: manager only)
  → await deliver(this submission)  ── sent ─► + up to 2 other due notifications
                                    └─ failed ─► pending + next_attempt_at (or failed after 5)
  → 202 { receivedAt }
```

## 4. Validation (`CreateContactSubmissionDto`, strict)

| Field | Rule |
|---|---|
| `name` | trimmed, 1–100 code points, no control characters (no line breaks), storable text |
| `email` | trimmed, lowercased, valid email, ≤ 254 |
| `subject` | one of the four enum values |
| `message` | CRLF/CR → LF, trimmed, 10–5 000 code points, at least one non-space character, storable text |
| `recaptchaToken` | string, 1–4 096 characters (not trimmed). Required in every mode, so the web never ships a form without it |

The 10-character minimum for `message` is an assumption made for this slice; it can change without a migration (the database only checks for "not blank").

## 5. Configuration

| Variable | Notes |
|---|---|
| `RECAPTCHA_SECRET_KEY` | Secret. Without it: bypass outside production, `503` in production |
| `RECAPTCHA_ALLOWED_HOSTNAMES` | Comma-separated hostnames, lowercased. Required with the secret, refused without it |
| `RECAPTCHA_MIN_SCORE` | 0–1, default 0.5 |
| `RESEND_API_KEY` | Secret |
| `CONTACT_EMAIL_FROM` | `Name <address>` or `address`, on a domain verified in Resend |
| `CONTACT_NOTIFICATION_TO` | One address (the business inbox, `business.xuanpham@gmail.com`) |
| `CRON_SECRET` | ≥ 16 characters. Enables the cron route |
| `TRUST_PROXY_HOPS` | 0–5; default 1 in production, else 0 |

## 6. Testing

- **Unit (pure logic and gateways with a fake `fetch`):** the request schema, the reCAPTCHA policy, Google's siteverify call, Resend's call and error classification, the email builder, the retry schedule, config.
- **E2E (real HTTP + `xuan_test`):** `test/contact-submissions.e2e-spec.ts`, `test/admin-contact-submissions.e2e-spec.ts`, `test/contact-notifications.e2e-spec.ts`, `test/contact-schema.e2e-spec.ts`, and the OpenAPI e2e. Fakes replace Google and Resend in `createTestApp`, so e2e never calls either one and never sends a real email.

## 7. Deferred

- A shared attempt throttle before Google: invalid-token floods are bounded only by Google's own quota and the CSRF/Origin checks.
- Auto-reply to the sender; unarchive; search; retention and deletion policy for old submissions (personal data).
- A more frequent cron (Vercel Hobby allows one run a day), or an external scheduler.
