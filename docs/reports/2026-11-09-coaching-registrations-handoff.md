# Coaching registrations: frontend handoff and owner steps

**For:** the xuan-web implementer (sections 1–3) and the owner (sections 4–5).
**Backend:** branch `feat/coaching-registrations`. Design: `docs/superpowers/specs/2026-11-09-coaching-registrations-design.md` (CR-1…CR-11). Contract: `docs/api-contract.md`, "Coaching registrations". The OpenAPI document is authoritative; this page explains it.

## 1. What exists

| Piece | Detail |
|---|---|
| Public submit | `POST /coaching-registrations`, no session, CSRF-checked (`X-Requested-With: XMLHttpRequest`), `202 { data: { receivedAt } }` |
| Request | `CreateCoachingRegistrationDto`: a union on `program` (`channel_kickstart_session` → `CreateChannelKickstartRegistrationDto`, `youtube_coaching_3_months` → `CreateThreeMonthCoachingRegistrationDto`). Strict: unknown fields are refused |
| Admin inbox | `GET /admin/coaching-registrations?status&program&page&pageSize`, `GET …/:registrationId`, `POST …/:registrationId/contacted`, `POST …/:registrationId/archive`. Admin only |
| Statuses | `new` → `contacted`; `archived` from any other. No approve or reject |
| Notification | None. Xuan learns about registrations by opening the admin page |
| Duplicates | Same email, program and every answer within 24 hours answers `202` with the first `receivedAt` and writes nothing. A corrected answer is a new registration |
| Limits | 3 an hour per email and 5 per client IP: `429 RATE_LIMITED` with `Retry-After` |

Answers are machine values (goals, challenges, `youtubeStage`, `practiceCommitment`); xuan-web owns the Vietnamese labels. The value lists are in the contract and in the OpenAPI enums.

## 2. How the frontend integrates

1. Pull the OpenAPI document and regenerate the types (as for the contact form). Branch the form on `program`; send only the fields of that program (`desiredOutcome` and `practiceCommitment` belong to the 3-month form).
2. reCAPTCHA v3: call `grecaptcha.execute(SITE_KEY, { action: 'coaching_registration_submit' })` at submit time, after client validation. The action must be exactly `coaching_registration_submit`. A token works once and expires after 2 minutes: get a new one for every attempt. The site key is the one the contact form already uses.
3. Hostnames: the token's hostname must be in the API's `RECAPTCHA_ALLOWED_HOSTNAMES`, shared with the contact form. The page that hosts the form must run on an already allowed hostname.
4. Disable the button while sending. Treat the duplicate `202` exactly like success.
5. Errors: `VALIDATION_FAILED` with `details.fields[]` (a missing enum, literal or `program` is `INVALID`; a missing string is `REQUIRED`), `RECAPTCHA_VERIFICATION_FAILED` (403, get a new token), `RATE_LIMITED` (429, read `Retry-After`), `COACHING_REGISTRATION_UNAVAILABLE` (503, show "temporarily unavailable").
6. Admin page: list with `status` and `program` filters, a detail view, and the two actions. Render all text as escaped plain text with newlines kept.

## 3. Field rules to mirror in the form

- `name` 1–100 on one line; `email` valid, ≤ 254; `expertise` 1–5 000; `favoriteCreators` optional ≤ 2 000.
- `goals` and `challenges`: at least one, each once. Challenges come from the program's own list.
- `challengeOther` only when `other` is chosen; required on the 3-month form, optional on Kickstart.
- `youtubeChannelUrl` optional, only with `has_channel`, on `youtube.com`, `*.youtube.com` or `youtu.be` (a missing scheme gets `https://`).
- 3-month only: `desiredOutcome` 1–5 000 and `practiceCommitment`.
- `consent` must be `true`.

## 4. Owner steps

| Step | Detail |
|---|---|
| `xuan_dev` migration | Run `CreateCoachingRegistrations1794218387446` on `xuan_dev` after approving the packet (not run by the delegation) |
| Neon migration | Run the same migration on Production's Neon database **before** the release that deploys these routes |
| Environment | No new variables. The existing `RECAPTCHA_*` and `AUTH_COOKIE_SECRET` apply. Add nothing to Vercel |
| Frontend | Make sure the host page's hostname is already in `RECAPTCHA_ALLOWED_HOSTNAMES` |

## 5. Decided by Claude; owner to confirm

- CR-1: the code lives in `src/modules/contact/coaching/`, reusing the reCAPTCHA gateway.
- CR-4: no notification email in V1; adding one later needs a migration and the existing notifier.
- CR-5: statuses `new`, `contacted`, `archived`, with no approve or reject state.
- CR-7: 3 per email and 5 per client IP per rolling hour.
- CR-8: a duplicate needs every answer identical; a corrected answer is a new row.
- CR-10: field requirements follow each PDF literally (the 3-month "share more" is required, Kickstart's is optional, the channel link is optional on both); text lengths are assumptions.

Not done: email to Xuan or the registrant, replying from the app, scheduling, payment, deletion and retention policy.
