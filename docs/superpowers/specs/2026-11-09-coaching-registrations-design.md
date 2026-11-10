# Coaching registrations design

Status: delegated slice, 2026-11-09. Source forms: `local-docs/XuanCreative_Channel_Kickstart_Registration_Form_Final_2026-11-05.pdf` and `local-docs/XuanCreative_3_Month_Coaching_Registration_Form_Final_2026-11-05.pdf`.

Decisions marked **(call)** were decided by Claude; owner to confirm.

**Revised 2026-11-10:** the owner asked for a notification email per new registration. CR-12 replaces CR-4; the rest is unchanged.

| # | Decision |
|---|---|
| CR-1 | **(call)** Lives in `src/modules/contact/coaching/`, table `coaching_registrations`. Reuses the reCAPTCHA gateway without changing the dependency table (I1, I2). |
| CR-2 | `POST /coaching-registrations`, public, CSRF-checked, answers `202 { data: { receivedAt } }`, same answer for a duplicate. No payment, no account. |
| CR-3 | Body is a union on `program`: `channel_kickstart_session` or `youtube_coaching_3_months` (the machine values `contact` already uses, CF-2). Answers are stored as stable machine values; xuan-web owns the Vietnamese labels. |
| CR-4 | ~~No notification email in V1.~~ **Superseded by CR-12** (owner, 2026-11-10). |
| CR-5 | **(call)** Status: `new` (waiting for Xuan's review, per the form notes) → `contacted`; `archived` from any other status. No approve/reject state: the forms say approval, scheduling and payment will be decided separately. Reading never changes status. |
| CR-6 | reCAPTCHA v3, action `coaching_registration_submit`, same policy and config as contact. Failure → `403 RECAPTCHA_VERIFICATION_FAILED`; Google down or production unconfigured → new `503 COACHING_REGISTRATION_UNAVAILABLE`. No new env vars. |
| CR-7 | **(call)** Limits from this table's own rows: 3 per email and 5 per client IP per rolling hour → `429 RATE_LIMITED` + `Retry-After`. IP stored only as HMAC, label `coaching-client-ip`. |
| CR-8 | **(call)** Duplicate = same email, program and **every answer identical** within 24 hours → `202` with the first `receivedAt`, nothing written. A person correcting an answer creates a new row and is not silently dropped. Together with a disabled button, this covers spam clicks. |
| CR-9 | Consent must be `true`; the server stores `consented_at = now()`. |
| CR-10 | **(call)** Follows each PDF literally: "share more" is required on the 3-month form (marked `*`, confirmed in its notes) and optional on Kickstart (no `*`). Channel link is optional on both (no `*`). Lengths are Claude's assumption and change without a migration only if lowered. |
| CR-11 | Admin only (`@Roles('admin')`), editors `403`, like the contact inbox. |
| CR-12 | **Notification email** (owner, 2026-11-10). After a **new** registration commits, one email goes to the business inbox through the contact form's notifier, Resend setup and rules (CF-10 to CF-13): one awaited attempt, delivery state on the row (migration `AddCoachingRegistrationNotifications`), idempotency key `coaching-registration-<id>`, logs with the id and error category only, and a manual admin retry (`POST /admin/coaching-registrations/:registrationId/notification/retry`) with the state in `AdminCoachingRegistrationDto.notification`. A duplicate sends nothing; a provider failure, timeout or missing configuration never changes the `202`. Recipient: `CONTACT_NOTIFICATION_TO`, already the business inbox, so no new variable. The email is plain text in Vietnamese: subject `Đăng ký mới: <program> - <name>`, every answer under its question with the form's labels (held in `coaching-labels.ts` for the email only; the API still answers machine values), the received time in Asia/Ho_Chi_Minh, a link to `<AUTH_WEB_URL>/admin/coaching`, and Reply-To the registrant. **(call)** Registrations stored before the migration become `failed` / `NOT_CONFIGURED` with 0 attempts, so an admin can send them. |

**Out of scope:** email to the registrant (auto-reply), replying from the app, approve/reject, scheduling, payment, deletion and retention policy (personal data, deferred like the contact form).

## Request fields

| Field | Program | Rule |
|---|---|---|
| `program` | both | discriminator |
| `name` | both | as contact: trimmed, 1-100 code points, one line |
| `email` | both | as contact: trimmed, lowercased, ≤ 254 |
| `youtubeStage` | both | `not_started` \| `has_channel` |
| `youtubeChannelUrl` | both | optional, only with `has_channel`, ≤ 500; no scheme → `https://` added; `http(s)` only; host `youtube.com`, `*.youtube.com` or `youtu.be` |
| `expertise` | both | required text, 1-5 000 |
| `goals` | both | ≥ 1, unique, from `GOALS` |
| `challenges` | both | ≥ 1, unique, from that program's list |
| `challengeOther` | both | only when `challenges` has `other`; ≤ 5 000; required on 3-month, optional on Kickstart |
| `desiredOutcome` | 3-month | required text, 1-5 000 |
| `practiceCommitment` | 3-month | `can_commit` \| `needs_arranging` \| `unsure` |
| `favoriteCreators` | both | optional, ≤ 2 000 |
| `consent` | both | literal `true`, not stored as such |
| `recaptchaToken` | both | 1-4 096 |

```ts
GOALS = ['share_knowledge', 'be_known_for_expertise', 'connect_with_community', 'build_client_trust', 'grow_business', 'still_exploring']
KICKSTART_CHALLENGES = ['dont_know_where_to_start', 'too_many_topics', 'unclear_identity', 'cant_turn_knowledge_into_ideas', 'videos_dont_show_value', 'other']
THREE_MONTH_CHALLENGES = ['unclear_direction', 'too_many_topics', 'cant_turn_knowledge_into_ideas', 'not_confident_on_camera', 'production_difficulty', 'dont_know_how_to_improve', 'hard_to_stay_consistent', 'other']
```

Text fields normalize like the contact `message` (CRLF → LF, trim, code-point length, visible text, storable text). An optional field that is blank is stored as `NULL`, in the service.
