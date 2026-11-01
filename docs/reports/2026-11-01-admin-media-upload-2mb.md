# Admin media upload: inclusive 2 MiB policy and unresolved historical 503

## Scope and diagnosis

Approved backend policy: one file with bytes <=2097152 on
`POST /admin/media/images`, shared by Blog cover, social sharing and rich-body images.
This is a policy correction, not a demonstrated fix for the historical 503.
Baseline: `0e6bc4997d826fe7ed5c3a936092b815c0173202`.

The full frontend handoff was read as evidence. Browser evidence establishes POST,
503, application/json and `X-Vercel-Error: SERVICE_UNAVAILABLE`, with header
`X-Vercel-Id: hkg1::7259b-1793474682656-10375b690edd`, response Date
`2026-10-31T19:24:44Z`. DevTools could not retrieve the response body; that does not
prove an empty body or an application error code. File approximately 1.4 MB, exact
bytes/format/dimensions and original sample unavailable; approximately 500 KB success
is owner-reported.

Fresh read-only Vercel CLI queries, restricted to the exact identifier and
19:24:00Z-19:26:00Z, reproduced one request record:

- requestId `7259b-1793474682656-10375b690edd`;
- timestamp `2026-10-31T19:24:42.656Z`, method **GET**, status 503;
- path/route/service `/admin/media/images`, edge `hkg1`, WAF allow;
- deployment `dpl_4UgFnoXkdHXsccc46AYbvyEV6jHc`, no pagination/excluded intervals.

The runtime query was rejected as outside Hobby retention. Read-only deployment
inspection reports READY, Node 24, region sin1, source baseline above. Deployment
readiness and configured capacity do not establish historical invocation health.
The browser POST versus platform GET discrepancy remains unresolved. No redirect,
method rewrite or logging defect is established. Provider support would need to
reconcile edge/router and invocation records for that exact identifier, establish
whether application code was entered, and recover any startup/termination/timeout,
Sharp, storage or database diagnostics. Do not reinterpret the GET as a logged POST.

## Request path and implementation

Browser FormData -> Vercel ingress -> Nest auth/role/CSRF guards -> route-scoped
Multer memory parser -> MediaService -> Sharp validation/encode -> storage.put for
all variants -> content_media insert -> explicit DTO and success envelope.

- Previous file limit: 12 MiB. `MAX_IMAGE_BYTES` now defines 2 * 1024 * 1024 in
  image-processing.ts; the controller passes it unchanged to SingleFileUpload.
- Real multipart tests establish 2097152 accepted and 2097153 rejected before the
  service, storage or media insert. Installed Multer 2.4.0 already compensates for
  Busboy's equality limit; no plus-one application workaround was introduced.
- The JSON parsers remain content-type scoped (100 kB / post-write 512 kB); they do
  not cap multipart file bytes. No total-request cap was set to the file maximum.
  Vercel's documented 4.5 MB total-body limit accommodates the new maximum plus
  ordinary multipart framing; it does not explain the reported 1.4 MB 503.
- Magic bytes and decoder agreement remain authoritative, not filename/client MIME.
  JPEG/PNG/WebP/AVIF only; no animation, <=6000 oriented pixels per side, <=36 MP.
  EXIF rotation, metadata stripping, WebP q82, 640/1280/1920 variants without
  enlargement remain unchanged.
- Metadata runs before the encode limiter; two encode pipelines run per process,
  widths sequentially. Waiting requests retain buffers and the queue has no bound
  or deadline. Compressed size does not bound decoded memory. These are inspected
  risks, not proof of queue pressure, OOM or the historical 503. No speculative
  concurrency/quality/timeout change was made.
- R2 uses S3 PutObject, in-memory output buffers and SDK defaults for retry/HTTP
  behavior; no explicit application storage deadline is configured. Storage errors
  propagate to the generic 500 contract. No intentional application 503 mapping
  was found. All variants precede the row insert; partial provider writes or a
  failed insert may leave orphan objects, as already accepted by the design.
- Error contracts unchanged: 413 PAYLOAD_TOO_LARGE; 400 VALIDATION_FAILED for
  invalid images; 401/403 for auth/roles/CSRF; 409 MEDIA_STORAGE_DISABLED before
  image processing (after multipart parsing); unknown/provider failure generic
  500 INTERNAL_ERROR. No new provider-availability contract or response fields.

## Verification evidence

Synthetic boundary PNGs use valid CRC-checked ancillary text chunks to vary file
bytes independently from 800x600 decoded pixels. Each success fixture is fully
decoded by Sharp before HTTP submission, then sent through the actual multipart
parser, Sharp transformation, local storage and real PostgreSQL media insert.
Output WebP is fully decoded and its byte size checked against the persisted row.

Cases: 500 KiB, approximately 1.4 MiB, 2097151 and 2097152 bytes succeed; 2097153
fails with the exact 413 envelope and zero service/storage calls or database rows.
The accepted HTTP Content-Length exceeds file bytes, proving framing is allowed.
Existing and extended tests cover magic bytes, misleading MIME, corruption,
animation, dimensions/pixel limits, EXIF, authorization, disabled storage, provider
failure and no persisted media row on failure. R2 SDK operations are mocked;
actual cloud credentials/provider availability are not exercised.

RED: old behavior produced two focused failures: over-limit file returned 201,
OpenAPI still described 12 MiB (56 other tests passed). After policy/description
change, focused HTTP/OpenAPI tests passed 61/61 before final full verification.
Final checks: 453 unit tests in 33 files and 599 E2E tests in 34 files passed;
formatting, lint (three existing warnings), typecheck and build passed. OpenAPI
document-build tests confirm the updated description and unchanged response codes.
No backend generated snapshot is tracked; the live document is built from source.
No entity or migration changed, so migration generation/revert checks do not apply.

One preceding full run failed the unchanged concurrent-first-Google-sign-in test
(598 others passed); it returned ACCOUNT_CONFLICT for one concurrent callback.
Two isolated runs against an exported baseline tree each passed all 26 auth tests,
then the unchanged full branch suite passed all 599. That failure is retained as an
unresolved intermittent auth verification risk, not an upload defect or a fixed
authentication issue. Auth implementation/tests were not changed. An earlier
multipart measurement assertion incorrectly read Superagent's header cache;
it was corrected to observe the actual Node IncomingMessage Content-Length.
The regression assertions and timeouts were not weakened.

Raw local evidence: OS-temp xuan-media-red.log, xuan-media-boundary-red.log
(the focused passing run), xuan-media-final.log (the auth failure),
xuan-media-baseline-auth.log, xuan-media-baseline-auth-second.log,
xuan-media-verification.log (all 599 passed), and xuan-media-unit.log.
Independent architecture/general review and remote checks are recorded in the PR.

Database safety: a new empty task-owned database
`xuan_media_20261101_incident_test` was created on the existing local PostgreSQL 18
container. Identity and zero initial public tables were checked before migrations.
Only this disposable database is supplied to the unchanged guarded yarn test:e2e
command. Synthetic auth settings and task-specific OS-temp local media are used.
No existing development/test/production database was migrated or cleared. Existing
migrations are applied to this fresh database; no schema/source migration changes.

## Frontend and release handoff

Producer contract/OpenAPI description changes from 12 MiB to inclusive 2 MiB
(2097152 bytes). Endpoint, DTOs, auth, response fields and error identifiers are
unchanged. Frontend client policy is already 2 MiB in PR47; PR48 release remains
owner-controlled. A separately authorized frontend contract-sync PR should pull
the updated /docs-json from an authorized test backend and run yarn api:generate,
committing snapshot and generated output together. Do not hand-edit generated files.

Vercel read-only project inspection still reports backend **Production branch dev**.
Therefore merging the development PR would automatically deploy Production,
contrary to this task's explicit boundary. Prepare/push/open/review the fix PR,
retain the branch and stop before merge. No Vercel/R2 setting changes or manual
deployments are authorized. A main release PR would not by itself reconcile this
actual deployment topology; the owner must decide it separately.

After explicit owner release authorization, verify the deployed backend revision,
frontend PR48 state and a real authorized synthetic upload around 1.4 MiB, exact
2 MiB acceptance, oversized rejection and public image retrieval. Until then the
Production incident is open, and historical 503 root cause remains unknown. Do not
claim that reducing the file limit fixes it or perform an unapproved rollback.
