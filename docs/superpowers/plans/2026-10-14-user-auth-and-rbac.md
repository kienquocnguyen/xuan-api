# User, Google auth and RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google-only sign-in with server-side sessions, `GET /auth/me`, three roles, a default-deny guard, an ownership policy primitive and admin editor management, all on branch `feat/build-user-auth-and-rbac`.

**Architecture:** One business module, `src/modules/users/`, owns `users`, `auth_identities` and `sessions`, the auth controller, the admin users controller and the global `AccessGuard`. Reusable auth metadata (`@Public`, `@Roles`, `@CurrentUser`, `Role`, ownership policy, CSRF guard) lives in `src/http/auth/` so any module can use it (I2). Google is reached through a gateway (C5) that e2e tests replace with a fake.

**Tech Stack:** NestJS 12 ESM, TypeORM 1.x, PostgreSQL 18, Zod 4, Vitest + supertest; new: `google-auth-library`, `cookie-parser` (+ `@types/cookie-parser`).

**Spec:** `docs/superpowers/specs/2026-10-14-user-auth-and-rbac-design.md` (decisions A1–A14 are binding).

## Global Constraints

- Only `src/config/` reads `process.env` (I4); config errors name variables only (I5).
- Entities never reach the wire (I10); controllers map with `toXDto` next to the DTO (D5).
- Business failures throw `AppError` (I14); new codes: baseline `UNAUTHENTICATED` (401) and `FORBIDDEN` (403) in `src/errors/baseline-errors.ts`, and `ADMIN_ROLE_LOCKED` (409) in `src/modules/users/users.errors.ts` (D10).
- Every endpoint documents every code it can return (I18): non-public → 401; state-changing → 403.
- Schema changes only by migration (I7); constraint names per D25; `timestamptz` (D28); writes via explicit `insert`/`update`, not `save` (D36).
- Inside the sign-in transaction, use only the transaction's manager (I8).
- No Google tokens, session tokens, cookie values or secrets in responses or logs (I16, I17).
- E2E never contacts Google: `createTestApp` always overrides `GOOGLE_IDENTITY_GATEWAY` with `FakeGoogleIdentityGateway`.
- Every database mutation (migration run/revert, e2e runs that TRUNCATE) needs owner approval; `xuan_test` migrations run as `NODE_ENV=test yarn test:db-guard && NODE_ENV=test yarn migration:run`.
- Cookie names: `xc_session` (session), `xc_oauth` (signed OAuth state). Session token: 32 random bytes, base64url; stored as SHA-256 hex.

## Review Focus

1. **A garbage, truncated or expired `xc_session` cookie** must give 401 `UNAUTHENTICATED`, never 500. Test: Task 4.
2. **A callback replayed or forged**: missing/unsigned/expired `xc_oauth`, a mismatched `state`, a reused state cookie → redirect with `GOOGLE_SIGN_IN_FAILED`, no session. Test: Task 5.
3. **`returnTo` open-redirect variants** (`//evil.example`, `/\evil`, `https://evil.example`, ` /x`, a 600-char path) → 400 at start. Test: Task 5 (unit + e2e).
4. **Demoted editor keeps an old session**: the next request must already be denied editor routes. Test: Task 7.
5. **Admin targets an admin (including themself)** through promote or demote → 409 `ADMIN_ROLE_LOCKED`, role unchanged. Test: Task 7.

## File map

| File | Responsibility |
|---|---|
| `src/config/env.schema.ts`, `load-config.ts` | auth variables, refinements, `AppConfig.auth` |
| `src/errors/baseline-errors.ts` | `UNAUTHENTICATED`, `FORBIDDEN` |
| `src/http/auth/role.ts` | `ROLES`, `Role`, `AuthenticatedUser`, `MANAGEMENT_ROLES` |
| `src/http/auth/auth.decorators.ts` | `@Public()`, `@Roles(...)`, `@CurrentUser()`, metadata keys |
| `src/http/auth/ownership.ts` | `canManageOwnedResource`, `assertCanManageOwnedResource` |
| `src/http/auth/csrf.guard.ts` | header + `Origin` check on state-changing methods |
| `src/http/http-contract.module.ts` | registers `CsrfGuard` as `APP_GUARD` |
| `src/http/configure-app.ts` | `cookie-parser` with `config.auth.cookieSecret` |
| `src/database/postgres-errors.ts` | `isUniqueViolation(error, constraint)` (D11 helper) |
| `src/modules/users/user.entity.ts`, `auth-identity.entity.ts`, `session.entity.ts` | tables (spec §3) |
| `src/database/migrations/<ts>-CreateUsersAndAuth.ts` | generated migration |
| `src/modules/users/sessions.service.ts` | create / resolve / revoke sessions |
| `src/modules/users/access.guard.ts` | global session + role guard |
| `src/modules/users/google/google-identity.gateway.ts` | gateway interface, token, `GoogleIdentity` |
| `src/modules/users/google/google-oauth.gateway.ts` | `google-auth-library` adapter |
| `src/modules/users/oauth-state.ts` | state cookie payload + `returnTo` rule + PKCE helpers |
| `src/modules/users/users.service.ts` | `signInWithGoogle`, `findById`, `listUsers`, `grantEditor`, `revokeEditor` |
| `src/modules/users/auth.controller.ts` | `/auth/google`, `/auth/google/callback`, `/auth/me`, `/auth/logout` |
| `src/modules/users/admin-users.controller.ts` | `/admin/users`, `/admin/editors/:userId` |
| `src/modules/users/dto/*.ts` | `CurrentUserDto`, `AdminUserDto` + mappers |
| `src/modules/users/users.errors.ts` | `ADMIN_ROLE_LOCKED`; callback codes |
| `test/support/fake-google-identity.gateway.ts`, `test/support/auth.ts` | test double, `signInAs`, `googleSignIn` helpers |
| `test/fixtures/fixture.module.ts` | `@Public` fixture + role-area and owned-post fixtures |

---

### Task 1: Auth configuration

**Files:** Modify `src/config/env.schema.ts`, `src/config/load-config.ts`, `src/config/load-config.spec.ts`, `.env.example`; local (git-ignored) `.env`, `.env.test`.

**Produces:** `AppConfig.auth = { google: { clientId, clientSecret, callbackUrl }, webUrl, cookieSecret, cookieSecure, sessionTtlDays, adminEmails: readonly string[] }`.

- [ ] Step 1: failing unit tests in `load-config.spec.ts`:
  - a full valid source → `auth` normalized (`adminEmails` lowercased and trimmed; `webUrl` origin);
  - missing `GOOGLE_CLIENT_ID` → `ConfigError` naming `GOOGLE_CLIENT_ID`, never the value;
  - `AUTH_COOKIE_SECRET` shorter than 32 → error naming it;
  - `AUTH_WEB_URL` not in `CORS_ORIGINS` → error naming `AUTH_WEB_URL`;
  - `AUTH_WEB_URL` with a path → error;
  - production with `AUTH_COOKIE_SECURE=false` → error naming `AUTH_COOKIE_SECURE`;
  - production with an `http:` `GOOGLE_CALLBACK_URL` → error;
  - an invalid email in `AUTH_ADMIN_EMAILS` → error;
  - defaults: `AUTH_COOKIE_SECURE` true, TTL 14, admin list empty.
- [ ] Step 2: `yarn test src/config` → FAIL.
- [ ] Step 3: add the variables to `envSchema` with a `superRefine` for cross-field rules (path = the variable name, so `ConfigError` names it); map them in `loadConfig`.
- [ ] Step 4: `yarn test src/config` → PASS; add placeholders to `.env.example` (no real values) and local values to `.env`/`.env.test`.
- [ ] Step 5: commit `feat(config): add google sign-in and session settings`.

### Task 2: Users, identities and sessions schema

**REQUIRED SUB-SKILL:** `xuan-database-change`.

**Files:** create the three entities, the `UsersModule` (forFeature only), the migration and `test/users-schema.e2e-spec.ts`; modify `src/app.module.ts`, `docs/database.md` §12.

**Produces:** `User { id, email, displayName, avatarUrl: string | null, role: Role, createdAt, updatedAt }`, `AuthIdentity { id, userId, provider: 'google', providerUserId, createdAt }`, `Session { id, userId, tokenHash, expiresAt, createdAt }`.

- [ ] Step 1: write the `database.md` §12 map (spec §3) with status *decided*.
- [ ] Step 2: entities with named constraints; `@ManyToOne(() => User, { onDelete: 'CASCADE' })` + `@JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'fk_…' })` inside the module only.
- [ ] Step 3: `NODE_ENV=test yarn migration:generate src/database/migrations/CreateUsersAndAuth` (read-only diff against `xuan_test`); **read the SQL** against the map; fix entities and regenerate if any hashed name or `TIMESTAMP` without time zone appears.
- [ ] Step 4: ⛔ **owner checkpoint**: approval for the guarded `migration:run`, the revert round trip and e2e runs on `xuan_test`.
- [ ] Step 5: run, inspect `\d+` for all three tables, revert, re-run, second generate empty.
- [ ] Step 6: schema e2e: defaults (uuid v7, role `user`, timestamps), `uq_users_email`, `ck_users_email_lowercase`, `ck_users_role`, `ck_users_display_name_not_blank`, `uq_auth_identities_provider_provider_user_id`, `uq_auth_identities_user_id_provider`, `ck_auth_identities_provider`, `uq_sessions_token_hash`, FK rejects an unknown user, deleting a user cascades identities and sessions.
- [ ] Step 7: map status *implemented*; commit `feat(user): add users, auth identities and sessions tables`.

### Task 3: HTTP auth primitives and CSRF

**Files:** create `src/http/auth/{role,auth.decorators,ownership,csrf.guard}.ts`, `src/http/auth/ownership.spec.ts`; modify `src/errors/baseline-errors.ts`, `src/http/http-contract.module.ts`, `src/http/configure-app.ts`, `src/modules/services/services.controller.ts` (`@Public()`), `test/fixtures/fixture.module.ts` (`@Public()` + header on fixture POSTs), `test/http-contract.e2e-spec.ts`, `test/cors-and-body.e2e-spec.ts`, new `test/csrf.e2e-spec.ts`.

**Produces:**
```ts
export const ROLES = ['user', 'editor', 'admin'] as const;
export type Role = (typeof ROLES)[number];
export const MANAGEMENT_ROLES = ['editor', 'admin'] as const satisfies readonly Role[];
export type AuthenticatedUser = Readonly<{ id: string; role: Role }>;
export const IS_PUBLIC = 'auth:isPublic'; export const REQUIRED_ROLES = 'auth:roles';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);
export const CurrentUser = createParamDecorator(…) // request.user, typed AuthenticatedUser
export function canManageOwnedResource(actor: AuthenticatedUser, ownerId: string): boolean;
export function assertCanManageOwnedResource(actor: AuthenticatedUser, ownerId: string): void; // AppError(FORBIDDEN)
```

- [ ] Step 1: ownership unit tests (admin any → true; editor own → true; editor other → false; user own → false; assert throws `FORBIDDEN`) → RED → implement → GREEN.
- [ ] Step 2: CSRF e2e (`test/csrf.e2e-spec.ts` on the fixture `POST /__fixture/no-content`): no header → 403 `FORBIDDEN` exact envelope; header + foreign `Origin` → 403; header + allowed `Origin` → 204; header without `Origin` → 204; GET without header → 200 → RED.
- [ ] Step 3: `CsrfGuard` (`APP_GUARD` in `HttpContractModule`), baseline errors, `cookie-parser` in `configureApp`; `@Public()` on Services and the fixture controller; fixture tests send `X-Requested-With`. → GREEN with the whole e2e suite.
- [ ] Step 4: commit `feat(http): add auth decorators, ownership policy and csrf guard`.

### Task 4: Sessions, access guard, `/auth/me`, logout

**Files:** create `sessions.service.ts`, `access.guard.ts`, `dto/current-user.dto.ts`, `auth.controller.ts` (me + logout), `test/support/auth.ts`, `test/auth-session.e2e-spec.ts`; modify `users.module.ts`.

**Produces:**
```ts
class SessionsService {
  create(userId: string): Promise<string>;                     // returns the raw token
  resolve(token: string | undefined): Promise<User | null>;    // null for missing/unknown/expired (expired row deleted)
  revoke(token: string | undefined): Promise<void>;
}
export const SESSION_COOKIE = 'xc_session';
export function sessionCookieOptions(config: AppConfig): CookieOptions; // httpOnly, sameSite 'lax', path '/', secure, maxAge
// test/support/auth.ts
export async function signInAs(app, overrides?: Partial<{ email; displayName; role: Role }>): Promise<{ user: User; cookie: string }>;
```

- [ ] Step 1: e2e RED:
  - `/auth/me` without a cookie → 401 exact `UNAUTHENTICATED` envelope;
  - with garbage (`xc_session=abc`), an unknown token or an expired session → 401;
  - a valid session → 200 `{ data: { id, email, displayName, avatarUrl, role } }` exactly;
  - logout with a session → 204, `Set-Cookie` clears `xc_session`, and `/auth/me` with the old cookie → 401;
  - logout without a session → 204;
  - logout without `X-Requested-With` → 403.
- [ ] Step 2: implement `SessionsService` (hash with `createHash('sha256')`), `AccessGuard` (`APP_GUARD`; `IS_PUBLIC` via `Reflector.getAllAndOverride([handler, class])`; roles → 403), `AuthController.me/logout`, `toCurrentUserDto`. → GREEN.
- [ ] Step 3: commit `feat(auth): add sessions, access guard, current user and logout`.

### Task 5: Google sign-in

**Files:** create `google/google-identity.gateway.ts`, `google/google-oauth.gateway.ts` (+ `.spec.ts` for the authorization URL, no network), `oauth-state.ts` (+ `.spec.ts`), `users.service.ts` (`signInWithGoogle`), `users.errors.ts`, `src/database/postgres-errors.ts`, `test/support/fake-google-identity.gateway.ts`, `test/auth-google.e2e-spec.ts`; modify `auth.controller.ts`, `users.module.ts`, `test/support/create-test-app.ts` (always override the gateway).

**Produces:**
```ts
export type GoogleIdentity = Readonly<{ subject: string; email: string; emailVerified: boolean; name?: string; picture?: string }>;
export const GOOGLE_IDENTITY_GATEWAY = Symbol('GOOGLE_IDENTITY_GATEWAY');
export interface GoogleIdentityGateway {
  authorizationUrl(input: { state: string; codeChallenge: string; nonce: string }): string;
  exchangeCode(input: { code: string; codeVerifier: string; nonce: string }): Promise<GoogleIdentity>; // throws on any failure
}
export const returnToSchema; // z.string().max(512).regex(/^\/(?![/\\])[^\s\\]*$/)
export type OAuthState = { state: string; nonce: string; verifier: string; returnTo: string; exp: number };
class UsersService { signInWithGoogle(identity: GoogleIdentity): Promise<User>; } // throws SignInError(code)
```

- [ ] Step 1: unit RED → GREEN:
  - the `returnTo` rule: accepts `/`, `/services/x?y=1`; rejects `//evil.example`, `/\evil`, `https://evil.example`, `/ x`, `''`, a 600-char path;
  - PKCE challenge = base64url(sha256(verifier));
  - `parseOAuthState` rejects malformed JSON or an expired `exp`;
  - adapter URL contains `client_id`, `redirect_uri`, `response_type=code`, the scopes, `state`, `nonce`, `code_challenge`, `code_challenge_method=S256`.
- [ ] Step 2: e2e RED (fake gateway):
  - **Start:** `GET /auth/google` → 302 to the fake's URL, setting a signed `xc_oauth` cookie; a bad `returnTo` → 400 `VALIDATION_FAILED`.
  - **New identity:** the callback creates the user (role `user`) and identity, sets `xc_session`, and redirects to `AUTH_WEB_URL + returnTo`. `/auth/me` matches the Google profile.
  - **Returning identity:** reuses the same user id and syncs the name, avatar and email.
  - **Allowlisted email:** gets `admin`, both on creation and on a later login of an existing `user`.
  - **Rejected sign-ins** redirect to `/login?authError=…` with no session:
    - an unverified email → `EMAIL_NOT_VERIFIED`;
    - the same email under another Google subject → `ACCOUNT_CONFLICT`;
    - a missing cookie, a mismatched state, a tampered cookie, a reused state, `?error=access_denied` or a failing exchange → `GOOGLE_SIGN_IN_FAILED`.
  - **Session fixation:** the old `xc_session` row is deleted after a new sign-in.
  - **No leaks:** neither the callback redirect `Location` nor any body contains the code, a token or the secret.
- [ ] Step 3: implement (transaction via `DataSource.transaction`, manager-only queries; translate unique violations with `isUniqueViolation`, retry once as a lookup). → GREEN.
- [ ] Step 4: commit `feat(auth): add google sign-in with pkce, state and nonce`.

### Task 6: Role matrix and ownership through fixtures

**Files:** modify `test/fixtures/fixture.module.ts` (`FixtureAccessController`: `GET /__fixture/editor-area` `@Roles('editor','admin')`, `GET /__fixture/admin-area` `@Roles('admin')`; `FixturePostsController`: in-memory owned posts with create/edit/publish/delete using `assertCanManageOwnedResource`); create `test/rbac.e2e-spec.ts`.

- [ ] Step 1: e2e:
  - **Role areas:** a user is 403 on both; an editor gets the editor area 200 and the admin area 403; an admin gets both 200; no session → 401.
  - **Owned posts:** an editor creates, edits, publishes, unpublishes and deletes their own post; another editor → 403 on each; an admin → 200 on another author's post; a user → 403 on create.
  - The fixture is exercised RED by asserting before the decorators are applied, then GREEN.
- [ ] Step 2: commit `test(auth): prove role matrix and ownership policy`.

### Task 7: Admin editor management

**Files:** create `admin-users.controller.ts`, `dto/admin-user.dto.ts`, `test/admin-users.e2e-spec.ts`; modify `users.service.ts`, `users.errors.ts`, `users.module.ts`.

**Produces:** `listUsers(role?: Role): Promise<User[]>`, `grantEditor(userId): Promise<User>`, `revokeEditor(userId): Promise<void>`; both run a conditional `UPDATE … WHERE id = $1 AND role <> 'admin' RETURNING *`, then distinguish not-found vs admin with a lookup.

- [ ] Step 1: e2e RED:
  - `GET /admin/users` (admin) lists exact `AdminUserDto`s ordered by `createdAt`, `id`; `?role=editor` filters; `?role=owner` → 400;
  - `PUT /admin/editors/:id` promotes a user → 200 with role `editor`; it's idempotent on an editor;
  - `DELETE` demotes an editor → 204 and the role is `user`; it's idempotent on a user;
  - an admin target (including self) → 409 `ADMIN_ROLE_LOCKED` with the role unchanged;
  - an unknown id → 404; a malformed id → 400 `INVALID_FORMAT`;
  - an editor or user caller → 403; no session → 401; a missing CSRF header → 403;
  - a demoted editor's existing session is denied the editor area at once.
- [ ] Step 2: implement. → GREEN. Commit `feat(user): add admin editor management`.

### Task 8: OpenAPI coverage and living docs

**Files:** modify `test/openapi.e2e-spec.ts`, `docs/architecture.md`, `docs/api-contract.md`, `docs/data-model.md`, `docs/database.md`, `docs/development-workflow.md` (§5 commands unchanged unless new ones), `CLAUDE.md` (status), `README` untouched.

- [ ] Step 1: OpenAPI test:
  - `CurrentUserDto` and `AdminUserDto` property sets are exact;
  - every operation outside the public allowlist (`GET /services`, `GET /services/{slug}`, `GET /auth/google`, `POST /auth/logout`, fixture routes) documents 401;
  - every non-GET documents 403;
  - the `/admin/editors/{userId}` operations document 404 and 409;
  - `/auth/google/callback` is absent.
- [ ] Step 2: docs:
  - `architecture.md`: the auth section, AD13, and removing the auth rows from §15;
  - `api-contract.md`: §4 adds `ADMIN_ROLE_LOCKED`; §7 is rewritten as implemented; §8 CSRF is now implemented; §11 lists the endpoints; §12 deltas cover `/auth/me` and dropping refresh;
  - `data-model.md` §4: roles decided, the publish question settled, future FKs;
  - `database.md` §12: implemented.
- [ ] Step 3: commit `docs(auth): record auth architecture, contract and schema`.

### Task 9: Close

- [ ] `yarn lint`, `typecheck`, `format:check`, `test`, `build`, guarded `yarn test:e2e`.
- [ ] `xuan-api-architecture-review`; fresh whole-branch review (most capable model) with this Review Focus; one fix pass with RED→GREEN per Critical/Important.
- [ ] Push; PR to `dev` (§9.3 body with Database, API Contract and Security sections); merge when the delegated conditions hold; update `dev`; delete the branch.
