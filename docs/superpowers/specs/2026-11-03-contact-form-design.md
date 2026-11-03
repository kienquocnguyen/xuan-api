# Contact form backend: design

**Status:** implemented on `feat/contact-submissions-and-notifications` (2026-11-03). The owner briefed the scope that day and delegated implementation, verification, the branch and the PR. Merging, deployment and provider setup stay owner actions.
**Revised 2026-11-03 (same day, before any merge or deployment):** the owner simplified notification delivery to **one attempt per submission plus a manual admin retry**. The automatic retry schedule, its backoff, the piggyback sends, the Vercel Cron route and `CRON_SECRET` were removed. CF-1 to CF-9 and CF-14 are unchanged; CF-10 to CF-13 below are the revised decisions.
**Owner module:** `contact` (new, `src/modules/contact/`). **Table:** `contact_submissions` (`database.md` §12).
**Consumer:** xuan-web's existing `/lien-he` page. Its visual design doesn't change; the form posts to this API.

## 1. Scope

| In | Out |
|---|---|
| Public submission with validation, reCAPTCHA v3, abuse limits and duplicate protection | CRM, tags, assignment, replies from the app, marketing automation |
| PostgreSQL persistence | Deleting submissions (none in V1) |
| Admin inbox: list (newest first, filter by status, paginated), detail, mark read, archive | Unarchive, bulk actions, search |
| One notification email per submission to the business inbox, with a durable state and a manual admin retry | Auto-reply to the sender, HTML templates, attachments, scheduled retries, queues, webhooks |

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| CF-1 | A new `contact` module owns `contact_submissions`, its controllers, gateways and errors | One capability, one owner (D1, I1). No other module is involved |
| CF-2 | Subjects are stable machine values `youtube_editing_course`, `channel_kickstart_session`, `youtube_coaching_3_months`, `general`. Their Vietnamese labels (the owner's wording: "Hỏi về khóa học YouTube Editing Workflow", "Hỏi về buổi coaching Channel Kickstart Session", "Hỏi về chương trình 3-Month 1:1 YouTube Coaching", "Liên hệ khác / Hợp tác") live in the backend for the email and are handed to the web | Contract identifiers (I19). Labels aren't on the wire |
| CF-3 | `POST /contact-submissions` is public and CSRF-checked. It answers **`202`** `{ data: { receivedAt } }`: the same for a new submission and for a duplicate of one | "Accepted for processing" is the honest status: the email isn't sent yet when the call returns. No id, status or admin field leaves the API |
| CF-4 | reCAPTCHA v3 is verified server-side through a `RecaptchaVerifier` gateway (C5). A pure policy then checks `success`, action `contact_submit`, a hostname from `RECAPTCHA_ALLOWED_HOSTNAMES`, a score ≥ `RECAPTCHA_MIN_SCORE` (default 0.5) and a `challenge_ts` no older than 180 s. Failure → `403 RECAPTCHA_VERIFICATION_FAILED`; the reason is never on the wire | Google rejects a reused token itself (`timeout-or-duplicate`) and tokens expire after 2 minutes; the age check is defense in depth with clock-skew slack |
| CF-5 | No secret: development and test **bypass** verification. Production is **unconfigured**, and every submission answers `503 CONTACT_FORM_UNAVAILABLE`. Google unreachable → the same `503` | Fail closed in production without taking the whole API down at boot (the rest of the API keeps working). The mode is a validated config value (D19) |
| CF-6 | Abuse limits are stored in the database, not in memory: per sender email **3 accepted submissions an hour**, per client IP **5 an hour** → `429 RATE_LIMITED` with `Retry-After` | Vercel runs many short-lived instances, so an in-memory counter would reset constantly. The rows already exist, so counting them is durable. The IP is stored only as an HMAC (`AUTH_COOKIE_SECRET`, label `contact-client-ip`), never in clear |
| CF-7 | A duplicate is the same email, subject and message within 24 hours. It answers `202` with the original `receivedAt`, writes nothing and sends nothing. The check runs before verification, again after a failed verification (under the per-email lock, so a concurrent first request has committed), and once more under a per-email transaction advisory lock before the insert | A double click sends one token twice; Google refuses the second, which must not turn a successful send into an error. The lock makes check-then-insert safe for concurrent identical requests |
| CF-8 | `trust proxy` = `TRUST_PROXY_HOPS`, default **1 in production** and 0 elsewhere | The per-IP limit needs the real client address behind Vercel's proxy. First resolution of the D23 `trust proxy` gate, for this feature |
| CF-9 | Notification: Resend's HTTP API through a `ContactNotifier` gateway (C5), using `fetch` (no new dependency). `RESEND_API_KEY`, `CONTACT_EMAIL_FROM`, `CONTACT_NOTIFICATION_TO` are all-or-nothing; none → `disabled` | No email infrastructure existed. Resend is a plain HTTPS call that suits Vercel Functions, and it supports idempotency keys |
| CF-10 | Delivery state on the row: `notification_status` `pending` \| `sent` \| `failed`, `attempts`, `attempted_at` (start of the latest attempt), `last_error` (a category, never a provider body), `sent_at`, `provider_message_id`. `pending` = an attempt is running (or was interrupted). `sent` is written **only after the provider returns 2xx with a message id**. `failed` = the attempt failed (`TIMEOUT`, `NETWORK_ERROR`, `PROVIDER_REJECTED`, `PROVIDER_UNAVAILABLE`, `INVALID_RESPONSE`) or no provider is configured (`NOT_CONFIGURED`, 0 attempts) | Durable and visible in the admin inbox. No claim of success before the provider accepts; an unsent email is never `sent` |
| CF-11 | Delivery: **one attempt per new submission.** The insert claims it (`pending`, `attempts = 1`, `attempted_at = now()`) in the same transaction, which commits first. Then the request **awaits** that attempt (8 s timeout) before answering, and records `sent` or `failed`. A failure keeps the submission (`202` all the same). A duplicate (CF-7) inserts nothing and sends nothing. No automatic retry | No detached promise after the response. A provider outage never rolls back or loses a submission. The owner wants a simple, predictable flow; the inbox is the source of truth |
| CF-12 | Ambiguity and interruption: the Resend `Idempotency-Key` is `contact-submission-<id>` on every attempt, so a retry after a lost response (Resend accepted, the answer never came back) returns the first acceptance instead of sending again, within Resend's 24-hour key window. If the request dies after the insert, or the outcome can't be written, the row stays `pending`; after **10 minutes** (`STALE_ATTEMPT_SECONDS`; an attempt lasts at most the 8 s provider timeout plus two writes) it is "stale" and an admin may retry it | Bounded duplicate risk without a queue. Exactly-once delivery isn't promised: after 24 hours the key expires, so a retry of an email that was actually accepted can deliver a second copy |
| CF-13 | Manual retry: `POST /admin/contact-submissions/:id/notification/retry` (admin). One conditional `UPDATE … SET pending, attempts + 1, attempted_at = now() WHERE id = $1 AND (failed OR stale pending) RETURNING …` claims the attempt; if it claims nothing (sent, or an attempt still running), the submission comes back unchanged and nothing is sent. No provider configured → `503 CONTACT_NOTIFICATIONS_UNAVAILABLE`, nothing changes. The DTO's `notification.retryable` tells the web when the action applies | The single-row conditional update is atomic: of two concurrent retries, the second waits on the row lock, then sees `pending` with a fresh `attempted_at` and claims nothing. No `SKIP LOCKED`, no lease column, no cron |
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
      INSERT … notification pending, attempts 1, attempted_at now()   (no provider: failed NOT_CONFIGURED, 0)
  → COMMIT
  → await ONE attempt (Resend, 8 s, Idempotency-Key contact-submission-<id>)
        ── 2xx + id ─► sent (sent_at, provider_message_id)
        ── error ────► failed (last_error = category)
        ── crash ────► stays pending; stale after 10 min → admin may retry
  → 202 { receivedAt }

POST /admin/contact-submissions/:id/notification/retry   (admin; CSRF)
  → no provider ─► 503 CONTACT_NOTIFICATIONS_UNAVAILABLE
  → UPDATE … WHERE failed OR stale pending  ── claimed ─► one attempt ─► sent | failed
                                           └─ nothing ─► unchanged (sent, or attempt running)
  → 200 AdminContactSubmissionDto
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
| `TRUST_PROXY_HOPS` | 0–5; default 1 in production, else 0 |

## 6. Testing

- **Unit (pure logic and gateways with a fake `fetch`):** the request schema, the reCAPTCHA policy, Google's siteverify call, Resend's call and error classification, the email builder, the notification service's one attempt and retry claim, `retryable`, config.
- **E2E (real HTTP + `xuan_test`):** `test/contact-submissions.e2e-spec.ts`, `test/admin-contact-submissions.e2e-spec.ts`, `test/contact-schema.e2e-spec.ts`, and the OpenAPI e2e. Fakes replace Google and Resend in `createTestApp`, so e2e never calls either one and never sends a real email. The fake notifier honours the idempotency key like Resend, and can simulate failures, a lost response after acceptance and slow sends (for concurrency).

## 7. Deferred

- A shared attempt throttle before Google: invalid-token floods are bounded only by Google's own quota and the CSRF/Origin checks.
- Auto-reply to the sender; unarchive; search; retention and deletion policy for old submissions (personal data).
- Automatic retries (a schedule, a cron or a queue). Removed on purpose; revisit only if manual retries become a burden.
- Resend webhooks (delivery, bounce): `sent` means "accepted by Resend", not "delivered to the inbox".
