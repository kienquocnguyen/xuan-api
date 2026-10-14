# Blog posts (CMS/API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (the owner pre-authorized execution on 2026-10-15; native execution, one whole-branch review at the end). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a text-first blog API on branch `feat/build-blog-posts`: public list/read of published posts, editor/admin authoring with ownership, a validated TipTap 3 JSON body, draft/publish lifecycle, SEO fields, pagination, OpenAPI, tests.

**Architecture:** a new business module `src/modules/content/` owns `content_posts` (I1). The author is a real FK to `users` declared with TypeORM's `@ForeignKey('User', …)` string target (no `User` import, I2); author display data comes from the first export of `UsersModule`, a read-only `UserProfilesReader` (B8). Shared HTTP plumbing (pagination, paginated envelope decorator, 50-issue cap, a path-scoped 512 kB JSON parser) lives in `src/http/`.

**Tech Stack:** NestJS 12 ESM, TypeORM 1.1.2, PostgreSQL 18, Zod 4, Vitest + supertest. New direct dependency: `express@5.2.1` (already installed transitively at that exact version by `@nestjs/platform-express`), for `express.json` in the post write parser (B15).

**Spec:** `docs/superpowers/specs/2026-10-15-blog-posts-design.md` (approved 2026-10-15; B1–B19 and §12 acceptance criteria are binding).

**Mode:** delegated (owner authorization 2026-10-15). Every task is `[delegate]`. Database mutations remain owner-only.

## Global Constraints

- Only `src/config/` reads `process.env` (I4). Entities never reach the wire (I10); DTO mapping in `toXDto` functions next to each DTO (D5).
- Business failures throw `AppError` (I14). New codes (kind `conflict`, 409) in `src/modules/content/content.errors.ts`: `POST_SLUG_TAKEN`, `POST_SLUG_LOCKED`, `POST_BODY_EMPTY`. All other errors are baseline.
- Every endpoint documents every code it can return (I18): authoring routes list 401 and 403; `@ApiErrorResponses(VALIDATION_FAILED, …)` adds 413 automatically.
- Request components (I19): `SavePostDto`, `PostsPageQuery`, `AdminPostsQuery`, `PostIdParam`, `PostBodyDocument`, `PostBodyNode`, `PostBodyMark`. Response DTOs: `PostAuthorDto`, `PostSummaryDto`, `PostDto`, `AdminPostAuthorDto`, `AdminPostSummaryDto`, `AdminPostDto`, `PageInfoDto`.
- Schema only by migration (I7); names per D25; `timestamptz` (D28); writes via explicit `insert`/`update`/QueryBuilder, never `save` (D36); no request object passed wholesale (I9).
- Body v1 allow-list exactly spec §4.1: nodes `doc, paragraph, heading (level 2|3), bulletList, orderedList, listItem, blockquote, text, hardBreak`; marks `bold, italic, link`; no images.
- Limits: body ≤ 256 KiB (UTF-8 bytes of `JSON.stringify`), ≤ 5 000 nodes, depth ≤ 12, text ≤ 10 000 chars, ≤ 50 reported field errors; JSON request ≤ 512 kB on `POST /admin/posts` and `PUT /admin/posts/:id`, 100 kB elsewhere.
- **Owner-only (never run without explicit approval):** `migration:run`, `migration:revert` (any database), seeds, `yarn test:e2e`, any e2e file that calls `resetDatabase` or inserts rows. Allowed without approval: `migration:generate` (reads the schema only), lint, typecheck, unit tests, build, and e2e files that never write (`test/openapi.e2e-spec.ts`, `test/http-contract.e2e-spec.ts`, `test/post-body-limit.e2e-spec.ts`), each after `NODE_ENV=test yarn test:db-guard`.
- Never delete branches; no force-push; PR targets `dev`.

## Review Focus

1. **A deeply nested or huge body** (20 000 levels inside 512 kB) must answer 400, never 500 (stack overflow). Test: Task 2 (e2e, runnable now) and Task 5 (unit).
2. **TipTap's real default output** (`link` with `target/rel/class/title`, `orderedList` with `attrs: { start: 1, type: null }`, empty paragraphs without `content`) must be accepted and canonicalized, or the editor can't save. Test: Task 5.
3. **Whitespace-only content** (`" "`, `" "`, only `hardBreak`s) must not count as publishable. Test: Task 5 (unit) and Task 8 (e2e).
4. **A post unpublished after publication** must keep its slug locked and its original `publishedAt`. Test: Task 8.
5. **Pagination edges**: `page` beyond the last page → 200 with empty `items`; `pageSize=0`/`51`/`abc`/unknown keys → 400. Test: Task 8.

## File map

| File | Responsibility |
|---|---|
| `package.json` | `express@5.2.1` direct dependency |
| `src/http/configure-app.ts` | path-scoped 512 kB JSON parser before the global 100 kB one |
| `src/http/to-field-errors.ts` (+ spec) | cap at 50 field errors |
| `src/http/pagination/page.ts` (+ spec) | `pageQueryFields`, `Page<T>`, `PageInfoDto`, `toPageInfo` |
| `src/http/openapi/api-paginated-envelope-response.ts` | `@ApiPaginatedEnvelopeResponse(Dto)` |
| `src/modules/users/user-profiles.reader.ts`, `users.module.ts` | `UserProfilesReader` + first export |
| `src/modules/content/post.entity.ts` | `Post` entity, constraints, FK metadata |
| `src/modules/content/body/post-body-limits.ts` (+ spec) | iterative limits pass |
| `src/modules/content/body/post-body-links.ts` (+ spec) | `isSafeLinkHref` |
| `src/modules/content/body/post-body.schema.ts` (+ spec) | recursive v1 schema, `postBodyInputSchema`, types |
| `src/modules/content/body/post-body-content.ts` (+ spec) | `hasMeaningfulText`, `canonicalizePostBody` |
| `src/modules/content/content.errors.ts` | the three module codes |
| `src/modules/content/dto/save-post.dto.ts` | `savePostSchema` (`SavePostDto`) |
| `src/modules/content/dto/post-queries.dto.ts` | `postsPageQuerySchema`, `adminPostsQuerySchema`, `postIdParamSchema` |
| `src/modules/content/dto/post.dto.ts` | public DTOs + mappers |
| `src/modules/content/dto/admin-post.dto.ts` | authoring DTOs + mappers |
| `src/modules/content/posts.service.ts` | use cases |
| `src/modules/content/posts.controller.ts` | public routes |
| `src/modules/content/admin-posts.controller.ts` | authoring routes |
| `src/modules/content/content.module.ts`, `src/app.module.ts` | wiring |
| `src/database/migrations/<ts>-CreateContentPosts.ts` | generated migration |
| `test/post-body-limit.e2e-spec.ts` | parser behavior (non-mutating) |
| `test/content-posts-schema.e2e-spec.ts` | constraints (mutating: owner approval to run) |
| `test/posts.e2e-spec.ts` | public routes (mutating) |
| `test/admin-posts.e2e-spec.ts` | authoring routes (mutating) |
| `test/openapi.e2e-spec.ts` | document assertions (non-mutating) |
| docs | spec §10 list |

---

### Task 1: Spike B7, author FK metadata survives `migration:generate`

**Files:** Create `src/modules/content/post.entity.ts` (final form, used by every later task).

- [ ] **Step 1: Write the entity**

```ts
import {
  Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn, Unique, UpdateDateColumn,
} from 'typeorm';
import type { PostBodyDocument } from './body/post-body.schema.js';

export const POST_STATUSES = ['draft', 'published'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];
export const POST_LANGUAGE = 'vi';

/** `content_posts` (database.md §12). Author FK by entity name: no import of the users module's entity (B7, I2). */
@Entity('content_posts')
@Unique('uq_content_posts_language_slug', ['language', 'slug'])
@Index('ix_content_posts_language_status_published_at_id', ['language', 'status', 'publishedAt', 'id'])
@Index('ix_content_posts_author_id_updated_at_id', ['authorId', 'updatedAt', 'id'])
@Check('ck_content_posts_language', `"language" IN ('vi')`)
@Check('ck_content_posts_slug_format', `"slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)
@Check('ck_content_posts_title_not_blank', `btrim("title") <> ''`)
@Check('ck_content_posts_excerpt_not_blank', `"excerpt" IS NULL OR btrim("excerpt") <> ''`)
@Check('ck_content_posts_seo_title_not_blank', `"seo_title" IS NULL OR btrim("seo_title") <> ''`)
@Check('ck_content_posts_seo_description_not_blank', `"seo_description" IS NULL OR btrim("seo_description") <> ''`)
@Check('ck_content_posts_body_is_doc', `jsonb_typeof("body") = 'object' AND "body"->>'type' = 'doc'`)
@Check('ck_content_posts_body_version', `"body_version" IN (1)`)
@Check('ck_content_posts_status', `"status" IN ('draft', 'published')`)
@Check('ck_content_posts_published_has_date', `"status" <> 'published' OR "published_at" IS NOT NULL`)
export class Post {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()', primaryKeyConstraintName: 'pk_content_posts' })
  id!: string;

  @Column({ name: 'author_id', type: 'uuid' })
  @ForeignKey('User', { name: 'fk_content_posts_author_id', onDelete: 'RESTRICT' })
  authorId!: string;

  @Column({ type: 'varchar', length: 16, default: POST_LANGUAGE }) language!: string;
  @Column({ type: 'varchar', length: 160 }) slug!: string;
  @Column({ type: 'varchar', length: 200 }) title!: string;
  @Column({ type: 'varchar', length: 400, nullable: true }) excerpt!: string | null;
  @Column({ type: 'jsonb' }) body!: PostBodyDocument;
  @Column({ name: 'body_version', type: 'smallint', default: 1 }) bodyVersion!: number;
  @Column({ type: 'varchar', length: 16, default: 'draft' }) status!: PostStatus;
  @Column({ name: 'published_at', type: 'timestamptz', nullable: true }) publishedAt!: Date | null;
  @Column({ name: 'seo_title', type: 'varchar', length: 200, nullable: true }) seoTitle!: string | null;
  @Column({ name: 'seo_description', type: 'varchar', length: 400, nullable: true }) seoDescription!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
```

The `PostBodyDocument` type comes from Task 5; until then use `Record<string, unknown>` and switch the import in Task 5. Index note: PostgreSQL scans an ascending B-tree backwards for `ORDER BY … DESC, id DESC`, so ascending indexes serve both lists (the spec's `DESC` index wording is satisfied by the backward scan; names follow D25 `ix_<table>_<cols>`).

- [ ] **Step 2: Generate (reads `xuan_dev`'s schema only, no writes)**

Run: `yarn migration:generate src/database/migrations/CreateContentPosts`
Expected: one file `src/database/migrations/<ts>-CreateContentPosts.ts`.

- [ ] **Step 3: Read the SQL against spec §3.2**

Check: `CREATE TABLE "content_posts"` with every column/type/default; `CONSTRAINT "pk_content_posts"`; `"uq_content_posts_language_slug"`; all ten `ck_content_posts_*`; both `ix_*`; `ALTER TABLE "content_posts" ADD CONSTRAINT "fk_content_posts_author_id" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`; nothing touches other tables; `down()` drops FK, indexes and table.
**Stop rule:** if the FK is missing, unnamed, not `RESTRICT`, or the string target fails to resolve, stop and report (the owner's approval is conditional on this spike).

- [ ] **Step 4: Metadata evidence for "second generate stays empty"**

Load the CLI data source and print the FK metadata TypeORM compares against the live table:
`node --no-warnings --loader ts-node/esm -e "const {default: ds} = await import('./src/database/data-source.ts'); await ds.initialize(); console.log(ds.getMetadata('content_posts').foreignKeys.map(f => [f.name, f.onDelete, f.referencedTablePath])); await ds.destroy();"`
Expected: `[ [ 'fk_content_posts_author_id', 'RESTRICT', 'users' ] ]`. TypeORM's `dropOldForeignKeys` keeps a table FK whose name exists in this metadata, so the post-run generate has nothing to drop. The empirical second generate needs the migration applied: **owner approval** (Task 11).

- [ ] **Step 5: Commit** `feat(content): add the post entity and its generated migration`.

### Task 2: Spike B15, a 512 kB parser for post writes only

**Files:** `package.json`, `src/http/configure-app.ts`, Test `test/post-body-limit.e2e-spec.ts`.

- [ ] **Step 1: Failing e2e (non-mutating: every request is rejected before any database write)**

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { XHR } from './support/auth.js';
import { createTestApp } from './support/create-test-app.js';

const tooLarge = { data: null, error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.', details: {} } };
const unauthenticated = { data: null, error: { code: 'UNAUTHENTICATED', message: 'You need to sign in.', details: {} } };
const json = (bytes: number) => JSON.stringify({ title: 'x'.repeat(bytes) });

describe('post write body limit (B15)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  const send = (method: 'post' | 'put', path: string, body: string) =>
    request(app.getHttpServer())[method](path).set(XHR).set('Content-Type', 'application/json').send(body);

  it.each([
    ['post', '/admin/posts'],
    ['put', '/admin/posts/01900000-0000-7000-8000-000000000000'],
  ] as const)('%s %s parses up to 512 kB (reaches the guard: 401)', async (method, path) => {
    const res = await send(method, path, json(400_000));
    expect(res.status).toBe(401);
    expect(res.body).toEqual(unauthenticated);
  });

  it.each([
    ['post', '/admin/posts'],
    ['put', '/admin/posts/01900000-0000-7000-8000-000000000000'],
  ] as const)('%s %s rejects over 512 kB with 413', async (method, path) => {
    const res = await send(method, path, json(600_000));
    expect(res.status).toBe(413);
    expect(res.body).toEqual(tooLarge);
  });

  it.each([
    ['post', '/admin/posts/01900000-0000-7000-8000-000000000000/publish'],
    ['post', '/auth/logout'],
  ] as const)('%s %s keeps the 100 kB limit', async (method, path) => {
    const res = await send(method, path, json(200_000));
    expect(res.status).toBe(413);
    expect(res.body).toEqual(tooLarge);
  });

  it('keeps the invalid-JSON message on post writes', async () => {
    const res = await send('post', '/admin/posts', '{"title":');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('The request body is not valid JSON.');
  });

  it('answers a 20 000-level document with 400 or 401, never 500', async () => {
    let deep = '{"type":"paragraph"}';
    for (let i = 0; i < 20_000; i++) deep = `{"type":"blockquote","content":[${deep}]}`;
    const res = await send('post', '/admin/posts', `{"body":{"type":"doc","content":[${deep}]}}`);
    expect([400, 401]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run, expect the 400 kB cases to fail with 413:** `NODE_ENV=test yarn test:db-guard && NODE_ENV=test npx vitest run --config vitest.config.e2e.ts test/post-body-limit.e2e-spec.ts`

- [ ] **Step 3: Add the dependency** `yarn add express@5.2.1`, then in `configure-app.ts` before `app.useBodyParser(...)`:

```ts
import express from 'express';

const POST_WRITE_JSON_LIMIT = '512kb'; // B15: long TipTap documents; every other route keeps 100kb (D21)
const postWriteJson = express.json({ limit: POST_WRITE_JSON_LIMIT });
const isPostWrite = (req: Request) =>
  (req.method === 'POST' && req.path === '/admin/posts') ||
  (req.method === 'PUT' && /^\/admin\/posts\/[^/]+$/.test(req.path));

// inside configureApp, before the global parser (which skips a body already parsed here):
app.use((req: Request, res: Response, next: NextFunction) =>
  isPostWrite(req) ? postWriteJson(req, res, next) : next(),
);
```

- [ ] **Step 4: Re-run Step 2 and `test/http-contract.e2e-spec.ts`; expect all green.** **Stop rule:** if any case fails in a way the mechanism can't satisfy, stop and report.

- [ ] **Step 5: Commit** `feat(http): accept 512 kB JSON bodies on post writes only`.

### Task 3: Docs first (spec §10)

**Files:** `docs/data-model.md`, `docs/database.md` §12, `docs/architecture.md` (§3, §10, §13 AD14, §14, §15, §16, §17), `docs/code-rules.md` (C12, D17, D21), `docs/api-contract.md` (endpoints, DTOs, codes, pagination, xuan-web deltas), `CLAUDE.md` status line, and the spec's §3.2 index names (`ix_content_posts_language_status_published_at_id`, `ix_content_posts_author_id_updated_at_id`).

- [ ] **Step 1:** write each section from the spec (decisions B1–B19, §3.2 map with status *decided*, §5 contract). No behavior beyond the spec.
- [ ] **Step 2:** `git diff --stat` review; commit `docs(content): document the blog posts slice`.

### Task 4: Shared plumbing: pagination, paginated envelope, 50-issue cap

**Files:** Create `src/http/pagination/page.ts`, `page.spec.ts`, `src/http/openapi/api-paginated-envelope-response.ts`; Modify `src/http/to-field-errors.ts`, `to-field-errors.spec.ts`.

- [ ] **Step 1: Failing unit tests**

```ts
// page.spec.ts
import { toPageInfo } from './page.js';
describe('toPageInfo', () => {
  it.each([
    [1, 12, 0, { page: 1, pageSize: 12, totalItems: 0, totalPages: 0 }],
    [1, 12, 12, { page: 1, pageSize: 12, totalItems: 12, totalPages: 1 }],
    [2, 12, 13, { page: 2, pageSize: 12, totalItems: 13, totalPages: 2 }],
    [9, 50, 3, { page: 9, pageSize: 50, totalItems: 3, totalPages: 1 }],
  ])('page %i size %i of %i', (page, size, total, expected) => {
    expect(toPageInfo(page, size, total)).toEqual(expected);
  });
});
// to-field-errors.spec.ts (added case)
it('reports at most 50 field errors', () => {
  const issues = Array.from({ length: 80 }, (_, i) => ({ message: 'x', path: ['f', i], code: 'custom' }));
  expect(toFieldErrors(issues)).toHaveLength(50);
});
```

- [ ] **Step 2:** run `yarn test src/http`, expect FAIL.
- [ ] **Step 3: Implement**

```ts
// src/http/pagination/page.ts
import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

/** Offset pagination query fields (api-contract.md §3); spread into a module's named query schema. */
export const pageQueryFields = {
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
};

export class PageInfoDto {
  @ApiProperty({ example: 1 }) page!: number;
  @ApiProperty({ example: 12 }) pageSize!: number;
  @ApiProperty({ example: 134 }) totalItems!: number;
  @ApiProperty({ example: 12 }) totalPages!: number;
}

export type Page<T> = { items: T[]; pageInfo: PageInfoDto };

export function toPageInfo(page: number, pageSize: number, totalItems: number): PageInfoDto {
  return { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) };
}
```

```ts
// src/http/openapi/api-paginated-envelope-response.ts
import { applyDecorators, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { PageInfoDto } from '../pagination/page.js';

/** Documents { data: { items: Dto[], pageInfo } } (D14), matching the success interceptor (I11). */
export function ApiPaginatedEnvelopeResponse(dto: Type<unknown>) {
  return applyDecorators(
    ApiExtraModels(dto, PageInfoDto),
    ApiResponse({
      status: 200,
      schema: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'object',
            required: ['items', 'pageInfo'],
            properties: {
              items: { type: 'array', items: { $ref: getSchemaPath(dto) } },
              pageInfo: { $ref: getSchemaPath(PageInfoDto) },
            },
          },
          message: { type: 'string' },
          code: { type: 'string' },
        },
      },
    }),
  );
}
```

`to-field-errors.ts`: `const MAX_FIELD_ERRORS = 50;` and `return issues.flatMap(...).slice(0, MAX_FIELD_ERRORS);`.

- [ ] **Step 4:** run `yarn test src/http`, expect PASS. **Step 5:** commit `feat(http): add pagination helpers and cap field errors at 50`.

### Task 5: The body document: limits, links, schema, content rules

**Files:** Create under `src/modules/content/body/`: `post-body-limits.ts`, `post-body-links.ts`, `post-body.schema.ts`, `post-body-content.ts` and a `.spec.ts` for each.

- [ ] **Step 1: Failing unit tests (table-driven).** Fixtures shared in the schema spec:

```ts
const text = (t: string, marks?: unknown[]) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const p = (...content: unknown[]) => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' });
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const tiptapLink = (href: string) => ({ type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow', class: null, title: null } });
```

Accept (`postBodyInputSchema.safeParse(x).success === true`): `doc()`; `doc(p())`; `doc(p(text('a', [{ type: 'bold' }, { type: 'italic' }, tiptapLink('https://x.vn')])))`; heading `{ type: 'heading', attrs: { level: 2 }, content: [text('a')] }` and level 3; `bulletList` and `orderedList` with `attrs: { start: 1, type: null }` and without attrs, each `[{ type: 'listItem', content: [p(text('a')), { type: 'bulletList', content: [{ type: 'listItem', content: [p()] }] }] }]`; `blockquote` with `[p(text('q'))]`; `hardBreak` with and without `marks`; links `http://x`, `mailto:a@b.vn`, `HTTPS://X.VN`.

Reject (`success === false`, with the path where noted): heading level 1 and 4; `image` node; unknown node `codeBlock`; unknown mark `underline`; extra key on any node (`{ type: 'paragraph', attrs: {} }`); link hrefs `javascript:alert(1)`, `JAVASCRIPT:x`, `data:text/html,x`, `vbscript:x`, `/relative`, `//evil.example`, `#top`, `https://user:pw@x.vn`, `https://x.vn/a b`, `https://x.vn/\u0000`, a 2 049-char URL; link with `target: '_self'`, `rel: 'noopener'`, `class: 'x'`, extra `attrs.foo`; duplicate mark `[{ type: 'bold' }, { type: 'bold' }]`; empty text `text('')`; text with `\u0000`; text of 10 001 chars; `listItem` whose first child is a heading; `bulletList` with `content: []`; `blockquote` with `content: []`; `orderedList` `start: 0`; `doc` missing `content`; a non-object body (`'x'`, `[]`, `null`).

Limits (`checkPostBodyLimits`): depth 12 accepted / 13 rejected; 5 000 nodes accepted / 5 001 rejected; 256 KiB accepted / one byte more rejected (built with multi-byte `"ă"` text so UTF-8 ≠ UTF-16 length); a 20 000-level document returns an issue without throwing; non-objects return `[]`.

Content rules: `hasMeaningfulText` false for `doc()`, `doc(p())`, `doc(p(text(' ')))`, `doc(p(text(' \t\n')))`, `doc(p({ type: 'hardBreak' }))`; true for `doc(p(text(' a ')))` and text nested in a list inside a blockquote. `canonicalizePostBody(doc(p(text('a', [tiptapLink('https://x.vn')]))))` equals `doc(p(text('a', [{ type: 'link', attrs: { href: 'https://x.vn' } }])))` and leaves every other node untouched.

- [ ] **Step 2:** `yarn test src/modules/content`, expect FAIL.

- [ ] **Step 3: Implement**

```ts
// post-body-links.ts
const ALLOWED_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);
const UNSAFE_CHARACTERS = /[\s\u0000-\u001f\u007f]/u;

/** Absolute https/http/mailto URL without credentials (spec §4.1 link rule). */
export function isSafeLinkHref(href: string): boolean {
  if (UNSAFE_CHARACTERS.test(href)) return false;
  let url: URL;
  try {
    url = new URL(href); // relative, protocol-relative and fragment-only hrefs throw without a base
  } catch {
    return false;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return false;
  return url.username === '' && url.password === '';
}
```

```ts
// post-body-limits.ts
export const POST_BODY_LIMITS = { maxBytes: 256 * 1024, maxNodes: 5_000, maxDepth: 12 } as const;
export type LimitIssue = { message: string };

/**
 * Iterative (never recursive) size/depth/node checks, run before the recursive schema so a pathological
 * document can't overflow the stack (spec §4.3). Only `content` arrays are walked; shape errors are the
 * schema's job.
 */
export function checkPostBodyLimits(value: unknown): LimitIssue[] {
  if (typeof value !== 'object' || value === null) return [];
  let nodes = 0;
  const stack: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (depth > POST_BODY_LIMITS.maxDepth) return [{ message: 'The document is nested too deeply.' }];
    if (typeof node !== 'object' || node === null) continue;
    nodes += 1;
    if (nodes > POST_BODY_LIMITS.maxNodes) return [{ message: 'The document has too many nodes.' }];
    const content = (node as { content?: unknown }).content;
    if (Array.isArray(content)) for (const child of content) stack.push({ node: child, depth: depth + 1 });
  }
  // Safe now: depth is bounded, so JSON.stringify can't recurse deeply.
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > POST_BODY_LIMITS.maxBytes) {
    return [{ message: 'The document is too large.' }];
  }
  return [];
}
```

```ts
// post-body.schema.ts — recursion via getters (Zod 4); explicit types keep TypeScript's inference finite.
import { z } from 'zod';
import { checkPostBodyLimits } from './post-body-limits.js';
import { isSafeLinkHref } from './post-body-links.js';

export type PostBodyMark =
  | { type: 'bold' } | { type: 'italic' }
  | { type: 'link'; attrs: { href: string; target?: '_blank' | null; rel?: 'noopener noreferrer nofollow' | null; class?: null; title?: null } };
export type PostBodyInline =
  | { type: 'text'; text: string; marks?: PostBodyMark[] }
  | { type: 'hardBreak'; marks?: PostBodyMark[] };
export type PostBodyListItem = { type: 'listItem'; content: PostBodyNode[] };
export type PostBodyNode =
  | { type: 'paragraph'; content?: PostBodyInline[] }
  | { type: 'heading'; attrs: { level: 2 | 3 }; content?: PostBodyInline[] }
  | { type: 'bulletList'; content: PostBodyListItem[] }
  | { type: 'orderedList'; attrs?: { start: number; type?: null }; content: PostBodyListItem[] }
  | { type: 'blockquote'; content: PostBodyNode[] };
export type PostBodyDocument = { type: 'doc'; content: PostBodyNode[] };

const NUL_FREE = (value: string) => !value.includes('\u0000');

const markSchema = z
  .discriminatedUnion('type', [
    z.strictObject({ type: z.literal('bold') }),
    z.strictObject({ type: z.literal('italic') }),
    z.strictObject({
      type: z.literal('link'),
      attrs: z.strictObject({
        href: z.string().max(2048).refine(isSafeLinkHref, 'Links must be absolute https, http or mailto URLs.'),
        target: z.literal('_blank').nullable().optional(),
        rel: z.literal('noopener noreferrer nofollow').nullable().optional(),
        class: z.null().optional(),
        title: z.null().optional(),
      }),
    }),
  ])
  .meta({ id: 'PostBodyMark' });

const marksSchema = z
  .array(markSchema)
  .max(3)
  .refine((marks) => new Set(marks.map((m) => m.type)).size === marks.length, 'Each mark may appear only once.');

const inlineSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('text'),
    text: z.string().min(1).max(10_000).refine(NUL_FREE, 'Text must not contain NUL characters.'),
    marks: marksSchema.optional(),
  }),
  z.strictObject({ type: z.literal('hardBreak'), marks: marksSchema.optional() }),
]);

const paragraphSchema = z.strictObject({ type: z.literal('paragraph'), content: z.array(inlineSchema).optional() });

const listItemSchema = z.strictObject({
  type: z.literal('listItem'),
  get content(): z.ZodType<PostBodyNode[]> {
    return z
      .array(postBodyNodeSchema)
      .min(1)
      .refine((nodes) => nodes[0]?.type === 'paragraph', 'A list item starts with a paragraph.');
  },
});

export const postBodyNodeSchema: z.ZodType<PostBodyNode> = z
  .discriminatedUnion('type', [
    paragraphSchema,
    z.strictObject({
      type: z.literal('heading'),
      attrs: z.strictObject({ level: z.union([z.literal(2), z.literal(3)]) }),
      content: z.array(inlineSchema).optional(),
    }),
    z.strictObject({ type: z.literal('bulletList'), content: z.array(listItemSchema).min(1) }),
    z.strictObject({
      type: z.literal('orderedList'),
      attrs: z.strictObject({ start: z.number().int().min(1).max(100_000), type: z.null().optional() }).optional(),
      content: z.array(listItemSchema).min(1),
    }),
    z.strictObject({
      type: z.literal('blockquote'),
      get content(): z.ZodType<PostBodyNode[]> {
        return z.array(postBodyNodeSchema).min(1);
      },
    }),
  ])
  .meta({ id: 'PostBodyNode' });

export const postBodyDocumentSchema = z
  .strictObject({ type: z.literal('doc'), content: z.array(postBodyNodeSchema) })
  .meta({ id: 'PostBodyDocument' });

/** The request field: limits first (iterative), then the recursive schema, which Zod skips if limits failed. */
export const postBodyInputSchema = z.preprocess((value, ctx) => {
  for (const issue of checkPostBodyLimits(value)) ctx.addIssue({ code: 'custom', message: issue.message });
  return value;
}, postBodyDocumentSchema);
```

If TypeScript rejects the annotated `z.ZodType<…>` getters or `discriminatedUnion` with annotated members, fall back to `z.union` for the node union (keeping the `PostBodyNode` id) and record it in the PR Notes; the accepted/rejected tables must still pass unchanged.

```ts
// post-body-content.ts
import type { PostBodyDocument, PostBodyMark, PostBodyNode } from './post-body.schema.js';

const HAS_VISIBLE_CHARACTER = /\S/u;

/** B18: true if any text node, at any depth, has a non-whitespace character. Iterative. */
export function hasMeaningfulText(doc: PostBodyDocument): boolean {
  const stack: unknown[] = [...doc.content];
  while (stack.length > 0) {
    const node = stack.pop() as { type: string; text?: string; content?: unknown[] };
    if (node.type === 'text' && HAS_VISIBLE_CHARACTER.test(node.text ?? '')) return true;
    if (Array.isArray(node.content)) stack.push(...node.content);
  }
  return false;
}

/** Spec §4.1 canonical storage: link marks keep only `href`; nothing else changes. */
export function canonicalizePostBody(doc: PostBodyDocument): PostBodyDocument {
  return { type: 'doc', content: doc.content.map(canonicalNode) as PostBodyNode[] };
}

function canonicalNode(node: unknown): unknown {
  const n = node as { content?: unknown[]; marks?: PostBodyMark[] } & Record<string, unknown>;
  const out: Record<string, unknown> = { ...n };
  if (Array.isArray(n.content)) out.content = n.content.map(canonicalNode);
  if (Array.isArray(n.marks)) {
    out.marks = n.marks.map((m) => (m.type === 'link' ? { type: 'link', attrs: { href: m.attrs.href } } : m));
  }
  return out;
}
```

- [ ] **Step 4:** `yarn test src/modules/content`, expect PASS; switch the entity's body type import to `PostBodyDocument`; `yarn typecheck`.
- [ ] **Step 5:** commit `feat(content): validate post bodies against the version-1 allow-list`.

### Task 6: `UserProfilesReader`, the users module's first export

**Files:** Create `src/modules/users/user-profiles.reader.ts`; Modify `src/modules/users/users.module.ts` (`providers` + `exports: [UserProfilesReader]`).

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, type Repository } from 'typeorm';
import { User } from './user.entity.js';

export type PublicProfile = Readonly<{ id: string; displayName: string; avatarUrl: string | null }>;

/** Read-only public profile data for other modules (B8). No email, no role. */
@Injectable()
export class UserProfilesReader {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  async findPublicProfiles(ids: readonly string[]): Promise<PublicProfile[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const rows = await this.users.find({
      select: { id: true, displayName: true, avatarUrl: true },
      where: { id: In(unique) },
    });
    return rows.map(({ id, displayName, avatarUrl }) => ({ id, displayName, avatarUrl }));
  }
}
```

Proven by the authoring/public e2e (author blocks), per D40 (no mocked-repository unit test). Commit with Task 8.

### Task 7: Content module: errors, request schemas, DTOs

**Files:** Create `content.errors.ts`, `dto/save-post.dto.ts`, `dto/post-queries.dto.ts`, `dto/post.dto.ts`, `dto/admin-post.dto.ts`.

```ts
// content.errors.ts
import type { ErrorDefinition } from '../../errors/app-error.js';
export const contentErrors = {
  POST_SLUG_TAKEN: { code: 'POST_SLUG_TAKEN', kind: 'conflict', message: 'Another post already uses this slug.' },
  POST_SLUG_LOCKED: { code: 'POST_SLUG_LOCKED', kind: 'conflict', message: 'A published post keeps its slug.' },
  POST_BODY_EMPTY: { code: 'POST_BODY_EMPTY', kind: 'conflict', message: 'A published post needs some content.' },
} as const satisfies Record<string, ErrorDefinition>;
```

```ts
// dto/save-post.dto.ts
import { z } from 'zod';
import { postBodyInputSchema } from '../body/post-body.schema.js';

export const POST_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/; // same rule as ck_content_posts_slug_format
const NUL_FREE = (value: string) => !value.includes('\u0000');
const NUL_MESSAGE = 'Text must not contain NUL characters.';
const optionalText = (max: number) =>
  z.string().trim().max(max).refine(NUL_FREE, NUL_MESSAGE).optional().transform((v) => (v ? v : null));

/** Create and full-replacement update (spec §5.3). Author, status, dates and language are never input (I9). */
export const savePostSchema = z
  .strictObject({
    slug: z.string().max(160).regex(POST_SLUG_PATTERN),
    title: z.string().trim().min(1).max(200).refine(NUL_FREE, NUL_MESSAGE),
    body: postBodyInputSchema,
    excerpt: optionalText(400),
    seoTitle: optionalText(200),
    seoDescription: optionalText(400),
  })
  .meta({ id: 'SavePostDto' });
export type SavePostInput = z.infer<typeof savePostSchema>;
```

```ts
// dto/post-queries.dto.ts
import { z } from 'zod';
import { pageQueryFields } from '../../../http/pagination/page.js';
import { POST_STATUSES } from '../post.entity.js';

export const postsPageQuerySchema = z.strictObject({ ...pageQueryFields }).meta({ id: 'PostsPageQuery' });
export const adminPostsQuerySchema = z
  .strictObject({ status: z.enum(POST_STATUSES).optional(), ...pageQueryFields })
  .meta({ id: 'AdminPostsQuery' });
export const postIdParamSchema = z.strictObject({ id: z.uuid() }).meta({ id: 'PostIdParam' });
```

**Import rule (verified against `architecture.md` §4 and `.oxlintrc.json`):** a module may use another module "only through that module's exported providers (by importing its Nest module)". `ContentModule` imports `UsersModule` and injects the exported `UserProfilesReader` class; it may import that class and its `PublicProfile` type, and nothing else from `modules/users/` (no entity, repository or private provider). The lint has no module-to-module rule, so review enforces this.

Public DTO classes (`PostAuthorDto { displayName; avatarUrl: string | null }`, `PostSummaryDto { id; slug; title; excerpt: string | null; publishedAt; author }`, `PostDto` extends summary with `language; body; bodyVersion; seoTitle; seoDescription; updatedAt`), with `body` documented as `@ApiProperty({ allOf: [{ $ref: getSchemaPath('PostBodyDocument') }] })` (spec §4.4) and mappers `toPostSummaryDto(post, author)` / `toPostDto(post, author)` that build plain objects with ISO strings (`publishedAt!.toISOString()`). Authoring DTOs analogously (`AdminPostAuthorDto` adds `id`; `AdminPostSummaryDto`: `id, slug, title, status, publishedAt: string | null, updatedAt, author`; `AdminPostDto` adds `language, excerpt, body, bodyVersion, seoTitle, seoDescription, createdAt`) with `toAdminPostSummaryDto` / `toAdminPostDto`.

Commit with Task 8.

### Task 8: Service, controllers, module, e2e tests

**Files:** Create `posts.service.ts`, `posts.controller.ts`, `admin-posts.controller.ts`, `content.module.ts`; Modify `src/app.module.ts`; Test `test/posts.e2e-spec.ts`, `test/admin-posts.e2e-spec.ts`, `test/content-posts-schema.e2e-spec.ts`.

- [ ] **Step 1: Write the e2e files first (they can't run until the owner approves the migration and mutating suite; they're the RED specification).** Helpers per file: `createTestApp()`, `resetDatabase` in `beforeEach`, `signInAs(app, { role })`, `XHR`, exact `envelope(code, message, details)` bodies as in `test/admin-users.e2e-spec.ts`, and `const body = (t = 'Xin chào') => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })`; `const save = (o = {}) => ({ slug: 'bai-viet', title: 'Bài viết', body: body(), ...o })`.

  `test/admin-posts.e2e-spec.ts` cases (exact bodies, `ISO` regex for instants):
  1. editor `POST /admin/posts` → 201 `AdminPostDto` (`status: 'draft'`, `publishedAt: null`, `language: 'vi'`, `bodyVersion: 1`, `excerpt/seoTitle/seoDescription: null`, `author: { id, displayName, avatarUrl: null }`).
  2. same slug again → 409 `POST_SLUG_TAKEN`; slug `Bai-Viet` → 400 `INVALID_FORMAT` at `slug`; heading level 1 → 400 at `body.content.0.attrs.level`; `javascript:` link → 400; `\u0000` in title → 400 `INVALID`; unknown key `authorId` → 400 `UNKNOWN_FIELD`.
  3. without `X-Requested-With` → 403; guest → 401; `user` → 403.
  4. TipTap default link attrs round-trip: create with `target/rel/class/title`, `GET /admin/posts/:id` returns `attrs: { href }` only.
  5. `PUT` full replacement: omitted `excerpt` becomes `null`; whitespace `seoTitle` becomes `null`.
  6. other editor: `GET/PUT/publish/unpublish` someone else's post → 403 `FORBIDDEN`; admin → 200.
  7. editor list shows only own posts; admin list shows all; `?status=draft` filters; order `updatedAt` desc; `pageInfo` exact.
  8. draft slug change → 200; publish → `publishedAt` set; `PUT` with another slug → 409 `POST_SLUG_LOCKED`; same slug → 200; unpublish → slug still locked, `publishedAt` unchanged; republish → `publishedAt` unchanged (`toBe` the first value).
  9. publish with `doc()`, `doc(p())`, only spaces/no-break spaces, only `hardBreak` → 409 `POST_BODY_EMPTY`; `PUT` a published post with an empty body → 409; `PUT` a draft with an empty body → 200.
  10. publish twice / unpublish twice → 200 and `updatedAt` unchanged on the second call.
  11. malformed `:id` → 400 `INVALID_FORMAT` at `id`; unknown id → 404.
  12. `PUT` → 404 for an unknown id; a 300 kB valid body (long text across many paragraphs, < 5 000 nodes) → 201; a 600 kB request → 413.

  `test/posts.e2e-spec.ts` cases:
  1. list returns only published posts, newest `publishedAt` first, `PostSummaryDto` exact (author `{ displayName, avatarUrl }`, **no id/email**), `pageInfo` exact; `?page=2&pageSize=1`; page beyond last → 200 empty `items`; `pageSize=0|51|abc`, `page=0`, `foo=1` → 400.
  2. `GET /posts/:slug` published → `PostDto` exact; draft → 404; unknown → 404; `UPPER` and `%00` → 404.
  3. an unpublished (previously published) post disappears from both routes.

  `test/content-posts-schema.e2e-spec.ts` (raw SQL, `constraintOf` helper as in `users-schema`): defaults (`uuidv7`, `vi`, `draft`, `body_version 1`, timestamps); each `ck_content_posts_*` rejects (`slug 'A'`, `language 'en'`, `title '  '`, `excerpt ''`, `seo_title ' '`, `seo_description ''`, `body '[]'::jsonb`, `body '{"type":"x"}'`, `body_version 2`, `status 'archived'`, `status 'published'` with null `published_at`); `uq_content_posts_language_slug`; `fk_content_posts_author_id` rejects an unknown author and `DELETE FROM users` of an author fails with `fk_content_posts_author_id` (RESTRICT).

- [ ] **Step 2: Implement the service**

```ts
// posts.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { isUniqueViolation } from '../../database/postgres-errors.js';
import { AppError } from '../../errors/app-error.js';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { assertCanManageOwnedResource } from '../../http/auth/ownership.js';
import type { AuthenticatedUser } from '../../http/auth/role.js';
import { type PublicProfile, UserProfilesReader } from '../users/user-profiles.reader.js';
import { canonicalizePostBody, hasMeaningfulText } from './body/post-body-content.js';
import { contentErrors } from './content.errors.js';
import type { SavePostInput } from './dto/save-post.dto.js';
import { POST_LANGUAGE, Post, type PostStatus } from './post.entity.js';
import { POST_SLUG_PATTERN } from './dto/save-post.dto.js';

export type AuthorProfile = PublicProfile;
export type AuthoredPost = Readonly<{ post: Post; author: AuthorProfile }>;
export type PostPage = Readonly<{ items: AuthoredPost[]; totalItems: number }>;
type Paging = Readonly<{ page: number; pageSize: number }>;

/** Blog posts use cases (spec §6). */
@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(Post) private readonly posts: Repository<Post>,
    private readonly profiles: UserProfilesReader,
  ) {}

  async listPublished({ page, pageSize }: Paging): Promise<PostPage> {
    const [rows, totalItems] = await this.posts.findAndCount({
      where: { language: POST_LANGUAGE, status: 'published' },
      order: { publishedAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items: await this.withAuthors(rows), totalItems };
  }

  async getPublishedBySlug(slug: string): Promise<AuthoredPost> {
    // An impossible slug can't exist (ck_content_posts_slug_format); skip the query (NUL would make Postgres throw).
    if (slug.length > 160 || !POST_SLUG_PATTERN.test(slug)) throw new AppError(baselineErrors.NOT_FOUND);
    const post = await this.posts.findOneBy({ language: POST_LANGUAGE, slug, status: 'published' });
    if (!post) throw new AppError(baselineErrors.NOT_FOUND);
    return (await this.withAuthors([post]))[0];
  }

  async listForActor(actor: AuthenticatedUser, status: PostStatus | undefined, { page, pageSize }: Paging): Promise<PostPage> {
    const [rows, totalItems] = await this.posts.findAndCount({
      where: {
        ...(actor.role === 'admin' ? {} : { authorId: actor.id }), // B12: editors see only their own
        ...(status ? { status } : {}),
      },
      order: { updatedAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items: await this.withAuthors(rows), totalItems };
  }

  async getForActor(actor: AuthenticatedUser, id: string): Promise<AuthoredPost> {
    return (await this.withAuthors([await this.loadManageable(actor, id)]))[0];
  }

  async create(actor: AuthenticatedUser, input: SavePostInput): Promise<AuthoredPost> {
    try {
      const result = await this.posts.insert({
        authorId: actor.id,
        slug: input.slug,
        title: input.title,
        excerpt: input.excerpt,
        body: canonicalizePostBody(input.body),
        seoTitle: input.seoTitle,
        seoDescription: input.seoDescription,
      });
      return this.getForActor(actor, (result.identifiers[0] as { id: string }).id);
    } catch (error) {
      throw this.translate(error);
    }
  }

  async update(actor: AuthenticatedUser, id: string, input: SavePostInput): Promise<AuthoredPost> {
    const post = await this.loadManageable(actor, id);
    if (post.publishedAt !== null && input.slug !== post.slug) throw new AppError(contentErrors.POST_SLUG_LOCKED);
    if (post.status === 'published' && !hasMeaningfulText(input.body)) throw new AppError(contentErrors.POST_BODY_EMPTY);
    try {
      await this.posts.update(
        { id },
        {
          slug: input.slug,
          title: input.title,
          excerpt: input.excerpt,
          body: canonicalizePostBody(input.body),
          seoTitle: input.seoTitle,
          seoDescription: input.seoDescription,
        },
      );
    } catch (error) {
      throw this.translate(error);
    }
    return this.getForActor(actor, id);
  }

  async publish(actor: AuthenticatedUser, id: string): Promise<AuthoredPost> {
    const post = await this.loadManageable(actor, id);
    if (post.status === 'published') return (await this.withAuthors([post]))[0]; // idempotent, no write
    if (!hasMeaningfulText(post.body)) throw new AppError(contentErrors.POST_BODY_EMPTY);
    await this.posts
      .createQueryBuilder()
      .update(Post)
      .set({ status: 'published', publishedAt: () => 'COALESCE("published_at", now())' })
      .where('id = :id AND status = :draft', { id, draft: 'draft' })
      .execute();
    return this.getForActor(actor, id);
  }

  async unpublish(actor: AuthenticatedUser, id: string): Promise<AuthoredPost> {
    const post = await this.loadManageable(actor, id);
    if (post.status === 'draft') return (await this.withAuthors([post]))[0];
    await this.posts
      .createQueryBuilder()
      .update(Post)
      .set({ status: 'draft' })
      .where('id = :id AND status = :published', { id, published: 'published' })
      .execute();
    return this.getForActor(actor, id);
  }

  private async loadManageable(actor: AuthenticatedUser, id: string): Promise<Post> {
    const post = await this.posts.findOneBy({ id });
    if (!post) throw new AppError(baselineErrors.NOT_FOUND);
    assertCanManageOwnedResource(actor, post.authorId); // 403 for other editors, reads included (B12)
    return post;
  }

  private async withAuthors(rows: Post[]): Promise<AuthoredPost[]> {
    const profiles = new Map(
      (await this.profiles.findPublicProfiles(rows.map((p) => p.authorId))).map((a) => [a.id, a]),
    );
    return rows.map((post) => {
      const author = profiles.get(post.authorId);
      if (!author) throw new Error('Post author missing despite fk_content_posts_author_id.');
      return { post, author };
    });
  }

  private translate(error: unknown): unknown {
    return isUniqueViolation(error, 'uq_content_posts_language_slug')
      ? new AppError(contentErrors.POST_SLUG_TAKEN)
      : error;
  }
}
```

(`UpdateDateColumn` makes TypeORM set `updated_at` in every `update`, and idempotent calls never reach an `update` — spec §6.)

- [ ] **Step 3: Controllers and module**

```ts
// posts.controller.ts
@Public()
@ApiTags('posts')
@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  @ApiSchemaParameters('query', postsPageQuerySchema)
  @ApiPaginatedEnvelopeResponse(PostSummaryDto)
  @ApiErrorResponses(baselineErrors.VALIDATION_FAILED)
  async list(@Query({ schema: postsPageQuerySchema }) q: z.infer<typeof postsPageQuerySchema>): Promise<Page<PostSummaryDto>> {
    const { items, totalItems } = await this.posts.listPublished(q);
    return { items: items.map(toPostSummaryDto), pageInfo: toPageInfo(q.page, q.pageSize, totalItems) };
  }

  @Get(':slug')
  @ApiEnvelopeResponse(PostDto)
  @ApiErrorResponses(baselineErrors.NOT_FOUND)
  async getBySlug(@Param('slug') slug: string): Promise<PostDto> {
    // D7 deviation (spec §5.1): the slug is an opaque lookup key; an impossible slug is simply not found.
    return toPostDto(await this.posts.getPublishedBySlug(slug));
  }
}
```

```ts
// admin-posts.controller.ts
const { VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND } = baselineErrors;
const { POST_SLUG_TAKEN, POST_SLUG_LOCKED, POST_BODY_EMPTY } = contentErrors;

@Roles('editor', 'admin')
@ApiTags('admin')
@Controller('admin/posts')
export class AdminPostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  @ApiSchemaParameters('query', adminPostsQuerySchema)
  @ApiPaginatedEnvelopeResponse(AdminPostSummaryDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN)
  async list(@CurrentUser() actor: AuthenticatedUser, @Query({ schema: adminPostsQuerySchema }) q: z.infer<typeof adminPostsQuerySchema>): Promise<Page<AdminPostSummaryDto>> {
    const { items, totalItems } = await this.posts.listForActor(actor, q.status, q);
    return { items: items.map(toAdminPostSummaryDto), pageInfo: toPageInfo(q.page, q.pageSize, totalItems) };
  }

  @Get(':id')
  @ApiSchemaParameters('path', postIdParamSchema)
  @ApiEnvelopeResponse(AdminPostDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  async get(@CurrentUser() actor: AuthenticatedUser, @Param({ schema: postIdParamSchema }) p: z.infer<typeof postIdParamSchema>): Promise<AdminPostDto> {
    return toAdminPostDto(await this.posts.getForActor(actor, p.id));
  }

  @Post()
  @ApiEnvelopeResponse(AdminPostDto, { status: 201 })
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, POST_SLUG_TAKEN)
  async create(@CurrentUser() actor: AuthenticatedUser, @Body({ schema: savePostSchema }) input: SavePostInput): Promise<AdminPostDto> {
    return toAdminPostDto(await this.posts.create(actor, input));
  }

  @Put(':id')
  @ApiSchemaParameters('path', postIdParamSchema)
  @ApiEnvelopeResponse(AdminPostDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, POST_SLUG_TAKEN, POST_SLUG_LOCKED, POST_BODY_EMPTY)
  async update(@CurrentUser() actor: AuthenticatedUser, @Param({ schema: postIdParamSchema }) p: z.infer<typeof postIdParamSchema>, @Body({ schema: savePostSchema }) input: SavePostInput): Promise<AdminPostDto> {
    return toAdminPostDto(await this.posts.update(actor, p.id, input));
  }

  @Post(':id/publish')
  @HttpCode(200)
  @ApiSchemaParameters('path', postIdParamSchema)
  @ApiEnvelopeResponse(AdminPostDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, POST_BODY_EMPTY)
  async publish(@CurrentUser() actor: AuthenticatedUser, @Param({ schema: postIdParamSchema }) p: z.infer<typeof postIdParamSchema>): Promise<AdminPostDto> {
    return toAdminPostDto(await this.posts.publish(actor, p.id));
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @ApiSchemaParameters('path', postIdParamSchema)
  @ApiEnvelopeResponse(AdminPostDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  async unpublish(@CurrentUser() actor: AuthenticatedUser, @Param({ schema: postIdParamSchema }) p: z.infer<typeof postIdParamSchema>): Promise<AdminPostDto> {
    return toAdminPostDto(await this.posts.unpublish(actor, p.id));
  }
}
```

```ts
// content.module.ts
@Module({
  imports: [TypeOrmModule.forFeature([Post]), UsersModule], // Post: the only registration (I1); UsersModule for UserProfilesReader
  controllers: [PostsController, AdminPostsController],
  providers: [PostsService],
})
export class ContentModule {}
```

`app.module.ts`: add `ContentModule` to `imports`.

- [ ] **Step 4:** `yarn lint && yarn typecheck && yarn test && yarn build`; expect green. (I2 lint verifies the content → users import is allowed; see Task 7's import rule.)
- [ ] **Step 5:** commit `feat(content): add public and authoring post endpoints` (with Tasks 6–7).

### Task 9: OpenAPI e2e (non-mutating, runnable now)

**Files:** Modify `test/openapi.e2e-spec.ts` (and its `publicOperations` set: add `get /posts`, `get /posts/{slug}`).

- [ ] **Step 1: Add the cases**

```ts
it('documents the blog components and parameters', () => {
  const doc = createOpenApiDocument(app);
  const schemas = doc.components?.schemas ?? {};
  expect(Object.keys(schemas)).toEqual(expect.arrayContaining([
    'SavePostDto', 'PostsPageQuery', 'AdminPostsQuery', 'PostIdParam', 'PostBodyDocument', 'PostBodyNode',
    'PostBodyMark', 'PostAuthorDto', 'PostSummaryDto', 'PostDto', 'AdminPostAuthorDto', 'AdminPostSummaryDto',
    'AdminPostDto', 'PageInfoDto',
  ]));
  const params = (path: string, method: 'get' | 'put' | 'post') =>
    ((doc.paths[path][method]?.parameters ?? []) as { name: string; in: string; required?: boolean }[])
      .map((p) => `${p.in}:${p.name}:${p.required === true}`).sort();
  expect(params('/posts', 'get')).toEqual(['query:page:false', 'query:pageSize:false']);
  expect(params('/admin/posts', 'get')).toEqual(['query:page:false', 'query:pageSize:false', 'query:status:false']);
  for (const [path, method] of [['/admin/posts/{id}', 'get'], ['/admin/posts/{id}', 'put'], ['/admin/posts/{id}/publish', 'post'], ['/admin/posts/{id}/unpublish', 'post']] as const) {
    expect(params(path, method)).toEqual(['path:id:true']);
  }
  expect(JSON.stringify(doc.paths['/admin/posts'].post?.requestBody)).toContain('#/components/schemas/SavePostDto');
  expect(JSON.stringify(schemas.PostDto)).toContain('#/components/schemas/PostBodyDocument');
  expect(JSON.stringify(schemas.PostBodyNode)).toContain('#/components/schemas/PostBodyNode'); // recursion via $ref
});

it('documents every post error code (I18)', () => {
  const doc = createOpenApiDocument(app);
  const codes = (path: string, method: 'get' | 'put' | 'post') => JSON.stringify(doc.paths[path][method]?.responses);
  expect(codes('/admin/posts', 'post')).toContain('POST_SLUG_TAKEN');
  for (const code of ['POST_SLUG_TAKEN', 'POST_SLUG_LOCKED', 'POST_BODY_EMPTY', 'NOT_FOUND']) {
    expect(codes('/admin/posts/{id}', 'put')).toContain(code);
  }
  expect(codes('/admin/posts/{id}/publish', 'post')).toContain('POST_BODY_EMPTY');
  expect(codes('/posts/{slug}', 'get')).toContain('NOT_FOUND');
  expect(JSON.stringify(doc.paths['/posts'].get?.responses['200'])).toContain('#/components/schemas/PageInfoDto');
});
```

- [ ] **Step 2:** `NODE_ENV=test yarn test:db-guard && NODE_ENV=test npx vitest run --config vitest.config.e2e.ts test/openapi.e2e-spec.ts`; expect green (fix decorators/schemas if not; never loosen the assertions). Also check the coerced query fields document a numeric type; if they document `{}`, give `pageQueryFields` an explicit `.meta({ type: 'integer' })`-equivalent fix and re-run.
- [ ] **Step 3:** commit `test(content): pin the blog OpenAPI contract`.

### Task 10: Reviews and the PR

- [ ] `superpowers:verification-before-completion`: fresh `yarn lint`, `yarn typecheck`, `yarn test`, `yarn build`, the three non-mutating e2e files; `npx prettier --check` on changed `src/`/`test/` files.
- [ ] `xuan-api-architecture-review` over `dev...HEAD`.
- [ ] Independent whole-branch review (fresh reviewer, most capable model); fix findings within scope.
- [ ] Push; open the PR to `dev` with the §9.3 template (Verification boxes ticked only for observed checks; Database section lists only observed steps; Notes: the `express` dependency, D7 slug deviation, D17 `$ref` clarification, the index-direction note, deferred ODs).
- [ ] **Do not merge** while the owner-approval steps of Task 11 are outstanding. Never delete the branch.

### Task 11: Owner-approved database steps (blocked until approval)

Requested together, each shown with target, operation, state change, rollback and guard:

1. `xuan_test`: `NODE_ENV=test yarn test:db-guard && NODE_ENV=test yarn migration:run` → creates `content_posts`; rollback `NODE_ENV=test yarn migration:revert`.
2. `xuan_test`: `\d+ content_posts` (read), `migration:revert` then `migration:run` again (D34 check), then `NODE_ENV=test yarn migration:generate src/database/migrations/Probe` must report no changes (B7 spike completion).
3. `xuan_test`: `yarn test:e2e` (guard + migration:run + full suite; truncates application tables between tests).
4. `xuan_dev`: `yarn migration:run` (creates the empty `content_posts` table; existing users/services untouched); rollback `yarn migration:revert`.

After approval: run them, observe output, tick the PR boxes, complete the reviews' remaining items, and merge per the delegation conditions (branch kept locally and remotely).
